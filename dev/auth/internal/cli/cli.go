// Package cli is the `auth` command line.
package cli

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"auth/internal/auth"
	"auth/internal/oauth"
	"auth/internal/store"
)

// Env is everything the commands touch outside their arguments, so tests can fake it.
type Env struct {
	Service auth.Service
	Stdin   io.Reader
	Stdout  io.Writer
	Stderr  io.Writer
	Home    string
	// Secret reads a key without echoing it. Nil means a plain line from Stdin.
	Secret func(prompt string) (string, error)
}

const usage = `usage: auth <command>

  list [--json]                       providers and whether each is signed in
  get <provider> [--json]             print the token (refreshing OAuth if expired)
  set <provider>                      store an API key (hidden prompt, or one line on stdin)
  login <provider>                    OAuth device login, or set for key providers
  logout <provider>                   remove the stored credential
  refresh <provider>                  renew an expired OAuth token (consumers call this)
  import --from-pi [file] [--include-oauth] [--overwrite]
  import --from-env-file [file] [--overwrite]
  path                                the credential file
`

// Run executes one command and returns the process exit code.
func Run(ctx context.Context, args []string, env Env) int {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" || args[0] == "help" {
		fmt.Fprint(env.Stdout, usage)
		if len(args) == 0 {
			return 1
		}
		return 0
	}
	cmd, rest := args[0], args[1:]
	var err error
	switch cmd {
	case "list":
		err = list(env, rest)
	case "get":
		err = get(ctx, env, rest)
	case "set":
		err = set(env, rest)
	case "login":
		err = login(ctx, env, rest)
	case "logout":
		err = logout(env, rest)
	case "refresh":
		err = refresh(ctx, env, rest)
	case "import":
		err = importCmd(env, rest)
	case "path":
		fmt.Fprintln(env.Stdout, env.Service.Store.Path)
	default:
		fmt.Fprintf(env.Stderr, "auth: unknown command %q\n\n%s", cmd, usage)
		return 1
	}
	if err != nil {
		fmt.Fprintf(env.Stderr, "auth: %v\n", err)
		if errors.Is(err, auth.ErrNotSignedIn) {
			return 3
		}
		return 1
	}
	return 0
}

func flags(name string, env Env) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(env.Stderr)
	return fs
}

// providerArg parses `[flags] <provider>` in either order.
func providerArg(fs *flag.FlagSet, args []string) (string, error) {
	var positional []string
	for len(args) > 0 {
		if err := fs.Parse(args); err != nil {
			return "", err
		}
		if fs.NArg() == 0 {
			break
		}
		positional = append(positional, fs.Arg(0))
		args = fs.Args()[1:]
	}
	if len(positional) != 1 {
		return "", errors.New("expected exactly one provider")
	}
	if !store.ValidID(positional[0]) {
		return "", fmt.Errorf("invalid provider id %q", positional[0])
	}
	return positional[0], nil
}

func list(env Env, args []string) error {
	fs := flags("list", env)
	asJSON := fs.Bool("json", false, "JSON output")
	if err := fs.Parse(args); err != nil {
		return err
	}
	rows, err := env.Service.List()
	if err != nil {
		return err
	}
	if *asJSON {
		enc := json.NewEncoder(env.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(rows)
	}
	for _, r := range rows {
		state := "-"
		if r.Type != "" {
			state = r.Type + " (" + r.Source + ")"
			if r.Expired {
				state += " expired"
			}
		}
		fmt.Fprintf(env.Stdout, "%-14s %s\n", r.ID, state)
	}
	return nil
}

func get(ctx context.Context, env Env, args []string) error {
	fs := flags("get", env)
	asJSON := fs.Bool("json", false, "JSON output")
	id, err := providerArg(fs, args)
	if err != nil {
		return err
	}
	c, err := env.Service.Get(ctx, id)
	if err != nil {
		return err
	}
	if *asJSON {
		return json.NewEncoder(env.Stdout).Encode(c)
	}
	token := c.Key
	if c.Type == store.TypeOAuth {
		token = c.Access
	}
	fmt.Fprintln(env.Stdout, token)
	return nil
}

func readKey(env Env, id string) (string, error) {
	if env.Secret != nil {
		return env.Secret("API key for " + id + ": ")
	}
	line, err := bufio.NewReader(env.Stdin).ReadString('\n')
	if err != nil && !(errors.Is(err, io.EOF) && line != "") {
		return "", errors.New("no key on stdin")
	}
	return strings.TrimSpace(line), nil
}

func set(env Env, args []string) error {
	id, err := providerArg(flags("set", env), args)
	if err != nil {
		return err
	}
	key, err := readKey(env, id)
	if err != nil {
		return err
	}
	if err := env.Service.SetKey(id, key); err != nil {
		return err
	}
	fmt.Fprintf(env.Stdout, "%s: key saved\n", id)
	return nil
}

func login(ctx context.Context, env Env, args []string) error {
	id, err := providerArg(flags("login", env), args)
	if err != nil {
		return err
	}
	if p, _ := auth.Lookup(id); p.OAuth == "" {
		return set(env, args)
	}
	err = env.Service.Login(ctx, id, func(d oauth.Device) {
		fmt.Fprintf(env.Stdout, "Open %s\nEnter the code: %s\nWaiting for approval (up to %d min)...\n", d.VerificationURI, d.UserCode, int(d.ExpiresIn.Minutes()))
	})
	if err != nil {
		return err
	}
	fmt.Fprintf(env.Stdout, "%s: signed in\n", id)
	return nil
}

func logout(env Env, args []string) error {
	id, err := providerArg(flags("logout", env), args)
	if err != nil {
		return err
	}
	if err := env.Service.Store.Delete(id); err != nil {
		return err
	}
	fmt.Fprintf(env.Stdout, "%s: removed from the store (the provider-side grant is not revoked)\n", id)
	return nil
}

func refresh(ctx context.Context, env Env, args []string) error {
	id, err := providerArg(flags("refresh", env), args)
	if err != nil {
		return err
	}
	c, ok, err := env.Service.Store.Read(id)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("%s: %w; run `auth login %s`", id, auth.ErrNotSignedIn, id)
	}
	if c.Type != store.TypeOAuth {
		return nil
	}
	_, err = env.Service.Refresh(ctx, id)
	return err
}

func importCmd(env Env, args []string) error {
	fs := flags("import", env)
	fromPi := fs.Bool("from-pi", false, "copy API keys from pi's auth.json")
	fromEnv := fs.Bool("from-env-file", false, "copy known provider keys from a NAME=value file")
	includeOAuth := fs.Bool("include-oauth", false, "also copy pi's OAuth entries (shares refresh tokens with pi)")
	overwrite := fs.Bool("overwrite", false, "replace entries already in the store")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *fromPi == *fromEnv {
		return errors.New("choose one of --from-pi or --from-env-file")
	}
	var rep auth.ImportReport
	var err error
	if *fromPi {
		path := filepath.Join(env.Home, ".pi", "agent", "auth.json")
		if fs.NArg() > 0 {
			path = fs.Arg(0)
		}
		rep, err = env.Service.FromPi(path, *includeOAuth, *overwrite)
	} else {
		path := filepath.Join(env.Home, ".config", "fish", ".env")
		if fs.NArg() > 0 {
			path = fs.Arg(0)
		}
		rep, err = env.Service.FromEnvFile(path, *overwrite)
	}
	if err != nil {
		return err
	}
	fmt.Fprintf(env.Stdout, "imported: %s\n", orNone(rep.Imported))
	fmt.Fprintf(env.Stdout, "already present (kept): %s\n", orNone(rep.Skipped))
	if len(rep.Ignored) > 0 {
		fmt.Fprintf(env.Stdout, "not imported: %s\n", strings.Join(rep.Ignored, ", "))
	}
	return nil
}

func orNone(ids []string) string {
	if len(ids) == 0 {
		return "none"
	}
	return strings.Join(ids, ", ")
}

// TTYSecret reads a line from the terminal with echo off (via stty, so no dependency).
func TTYSecret(prompt string) (string, error) {
	tty, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		return "", errors.New("no terminal; pipe the key on stdin")
	}
	defer tty.Close()
	fmt.Fprint(tty, prompt)
	off := exec.Command("stty", "-echo")
	off.Stdin = tty
	if err := off.Run(); err != nil {
		return "", errors.New("could not turn echo off; pipe the key on stdin")
	}
	defer func() {
		on := exec.Command("stty", "echo")
		on.Stdin = tty
		_ = on.Run()
		fmt.Fprintln(tty)
	}()
	line, err := bufio.NewReader(tty).ReadString('\n')
	if err != nil && line == "" {
		return "", err
	}
	return strings.TrimSpace(line), nil
}
