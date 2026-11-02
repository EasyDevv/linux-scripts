// git.go ports the git commands of ship.ts (rev-parse, remote, push, add,
// diff --cached --numstat, rev-list).
//
// Every external command runs as an argument array, like Bun's `$` tagged
// templates did. A command the original did not mark `.quiet()` inherits the
// terminal: its output is echoed while still being captured, because the
// original read `result.stdout`/`result.stderr` after echoing too.
package app

import (
	"bytes"
	"errors"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// cmdResult mirrors Bun's ShellOutput: an exit code plus captured streams.
type cmdResult struct {
	Code   int
	Stdout string
	Stderr string
}

// exec runs name with args in dir. echo writes the child's streams through to
// the process streams as they arrive (Bun's default, non-quiet behavior).
// A non-zero exit is data (Code), not an error; the error return is reserved
// for a command that could not start.
func (c *ctx) exec(dir string, echo bool, name string, args ...string) (cmdResult, error) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	var out, errBuf bytes.Buffer
	if echo {
		cmd.Stdout = io.MultiWriter(&out, c.stdout)
		cmd.Stderr = io.MultiWriter(&errBuf, c.stderr)
	} else {
		cmd.Stdout = &out
		cmd.Stderr = &errBuf
	}
	err := cmd.Run()
	res := cmdResult{Stdout: out.String(), Stderr: errBuf.String()}
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			res.Code = exitErr.ExitCode()
			return res, nil
		}
		return res, err
	}
	return res, nil
}

// git runs git in the invocation directory, as every git call in ship.ts did.
func (c *ctx) git(quiet bool, args ...string) (cmdResult, error) {
	return c.exec(c.cwd, !quiet, "git", args...)
}

// isRepo is `git rev-parse --git-dir` in a quiet try/catch.
func (c *ctx) isRepo() bool {
	res, err := c.git(true, "rev-parse", "--git-dir")
	return err == nil && res.Code == 0
}

// topLevel is `git rev-parse --show-toplevel`, trimmed.
func (c *ctx) topLevel() (string, error) {
	res, err := c.git(true, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(res.Stdout), nil
}

// remotes lists configured remotes, one per line, trimmed and non-empty.
func (c *ctx) remotes() []string {
	res, err := c.git(true, "remote")
	if err != nil {
		return nil
	}
	var names []string
	for _, line := range strings.Split(res.Stdout, "\n") {
		if name := strings.TrimSpace(line); name != "" {
			names = append(names, name)
		}
	}
	return names
}

// branch is `git rev-parse --abbrev-ref HEAD`, trimmed.
func (c *ctx) branch() (string, error) {
	res, err := c.git(true, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(res.Stdout), nil
}

// pushUpstream is pushUpstream(remote) from ship.ts: announce, then
// `git push -u <remote> <branch>` with inherited output.
func (c *ctx) pushUpstream(remote string) bool {
	branch, err := c.branch()
	if err != nil {
		return false
	}
	c.printf("%sPushing %s to %s...%s\n", Cyan(), branch, remote, NC())
	res, err := c.git(false, "push", "-u", remote, branch)
	return err == nil && res.Code == 0
}

// unpushed counts commits on HEAD that no remote branch has yet.
func (c *ctx) unpushed() int {
	res, err := c.git(true, "rev-list", "--count", "HEAD", "--not", "--remotes")
	if err != nil || res.Code != 0 {
		return 0
	}
	n, err := strconv.Atoi(strings.TrimSpace(res.Stdout))
	if err != nil {
		return 0
	}
	return n
}

// onPath is Bun.which.
func onPath(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

// stdinIsTerminal and stderrIsTerminal are the TTY probes behind
// `process.stdin.isTTY` and canPick().
func stdinIsTerminal() bool { return isTerminal(os.Stdin) }

func stderrIsTerminal() bool { return isTerminal(os.Stderr) }
