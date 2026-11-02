// run.go ports the top-level flow of ship.ts: parse, help, positional rules,
// the repo subcommand, db:snapshot, commit, unpushed detection, the no-remote
// prompt, and the push with its no-upstream fallback.
//
// Exit codes: 0 ok, 1 fatal, 2 bad arguments, 130 abort (build-terminal rule;
// the TS picker aborted with 1).
package app

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

// ctx is the script's process state: the parsed flags, the invocation
// directory, the shared streams, and what the GitHub step needs.
type ctx struct {
	opts        Options
	cwd         string
	root        string
	interactive bool
	color       bool
	stdin       io.Reader
	stdout      io.Writer
	stderr      io.Writer
	reader      *bufio.Reader
	nameArg     string
	visibility  string
}

type fatalError struct {
	msg  string
	code int
}

func (e fatalError) Error() string { return e.msg }

// exitError exits with a code and prints nothing extra.
type exitError struct{ code int }

func (e exitError) Error() string { return fmt.Sprintf("exit %d", e.code) }

func fatal(msg string) error { return fatalError{msg: msg, code: 1} }

func fatalCode(code int, msg string) error { return fatalError{msg: msg, code: code} }

func exitCode(code int) error { return exitError{code: code} }

// Run is the script's top level. args are os.Args[1:].
func Run(args []string) int {
	opts, err := Parse(args)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s%s%s %s(see ship --help)%s\n", Red(), err.Error(), NC(), Dim(), NC())
		return 2
	}
	c := &ctx{
		opts:   opts,
		color:  colorEnabled,
		stdin:  os.Stdin,
		stdout: os.Stdout,
		stderr: os.Stderr,
		reader: bufio.NewReader(os.Stdin),
	}
	if opts.Help {
		fmt.Fprintln(c.stdout, Help(c.color))
		return 0
	}
	if err := c.main(); err != nil {
		return c.report(err)
	}
	return 0
}

func (c *ctx) report(err error) int {
	var fe fatalError
	if errors.As(err, &fe) {
		c.eprintf("%sfatal: %s%s\n", Red(), fe.msg, NC())
		return fe.code
	}
	var ee exitError
	if errors.As(err, &ee) {
		return ee.code
	}
	c.eprintf("%sfatal: %s%s\n", Red(), err.Error(), NC())
	return 1
}

func (c *ctx) printf(format string, a ...any)  { fmt.Fprintf(c.stdout, format, a...) }
func (c *ctx) eprintf(format string, a ...any) { fmt.Fprintf(c.stderr, format, a...) }

func (c *ctx) main() error {
	if c.opts.Public && c.opts.Private {
		return fatal("--public and --private are exclusive")
	}

	// `ship repo [name]` takes the name as its second positional; `ship --repo
	// [name]` as its only one.
	positionals := c.opts.Positionals
	subcommand := "ship"
	if len(positionals) > 0 && positionals[0] == "repo" {
		subcommand = "repo"
	}
	switch {
	case subcommand == "repo" && len(positionals) > 1:
		c.nameArg = positionals[1]
	case subcommand != "repo" && len(positionals) > 0:
		c.nameArg = positionals[0]
	}
	limit := 0
	if subcommand == "repo" {
		limit = 2
	} else if c.opts.Repo {
		limit = 1
	}
	if len(positionals) > limit {
		return fatal(fmt.Sprintf("unexpected argument: %s (see ship --help)", strings.Join(positionals, " ")))
	}
	switch {
	case c.opts.Public:
		c.visibility = "public"
	case c.opts.Private:
		c.visibility = "private"
	}

	cwd, err := os.Getwd()
	if err != nil {
		return fatal(err.Error())
	}
	c.cwd = cwd
	c.interactive = stdinIsTerminal()

	if !c.isRepo() {
		return fatal("not a git repository")
	}
	root, err := c.topLevel()
	if err != nil {
		return fatal(err.Error())
	}
	c.root = root

	if subcommand == "repo" {
		return c.setupAndPush()
	}

	if err := c.dbSnapshot(); err != nil {
		return err
	}
	committed, err := c.commitChanges()
	if err != nil {
		return err
	}
	if c.opts.NoPush {
		return nil
	}
	known := c.remotes()
	// A clean tree still ships commits made earlier (an agent, a manual
	// commit); --repo still connects and pushes what is already committed.
	if !committed && !c.opts.Repo {
		ahead := 0
		if len(known) > 0 {
			ahead = c.unpushed()
		}
		if ahead == 0 {
			return nil
		}
		plural := "s"
		if ahead == 1 {
			plural = ""
		}
		c.printf("%s%d unpushed commit%s%s\n", Cyan(), ahead, plural, NC())
	}

	if len(known) == 0 {
		setup := c.opts.Repo
		if !setup && c.interactive {
			answer, err := c.ask(fmt.Sprintf("%sNo remote configured. Create a GitHub repository? [Y/n] %s", Yellow(), NC()))
			if err != nil {
				return fatal(err.Error())
			}
			setup = answer == "" || strings.HasPrefix(strings.ToLower(answer), "y")
		}
		if !setup {
			c.eprintf("%sno remote configured; skipping push (run: ship repo)%s\n", Yellow(), NC())
			return nil
		}
		return c.setupAndPush()
	}

	res, err := c.git(false, "push")
	if err != nil {
		return fatal(err.Error())
	}
	if res.Code != 0 {
		if strings.Contains(res.Stderr, "no upstream branch") {
			remote := known[0]
			for _, name := range known {
				if name == "origin" {
					remote = "origin"
				}
			}
			if !c.pushUpstream(remote) {
				return exitCode(1)
			}
		} else {
			c.printf("%s\n", res.Stdout)
			c.eprintf("%s\n", res.Stderr)
			return exitCode(1)
		}
	}
	return nil
}

// ask is readline's question() with a trimmed answer. Prompts go to stdout,
// as the original's readline output did.
func (c *ctx) ask(prompt string) (string, error) {
	c.printf("%s", prompt)
	line, err := c.reader.ReadString('\n')
	if err != nil && line == "" {
		return "", err
	}
	return strings.TrimSpace(line), nil
}
