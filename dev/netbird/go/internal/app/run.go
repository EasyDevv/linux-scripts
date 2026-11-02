// run.go is main() from the original: parse, dispatch, and map AppError to
// `error: <msg>` with exit 1 (130 for a picker abort).
package app

import (
	"errors"
	"fmt"
	"io"
	"os"

	"netbird-setup/internal/ui"
)

// Run executes one command line and returns the process exit code.
func Run(argv []string) int {
	return run(argv, os.Stdout, os.Stderr, os.Getenv, nil)
}

// run is Run with injectable streams and environment for tests.
func run(argv []string, stdout, stderr io.Writer, getenv func(string) string, stdin io.Reader) int {
	parsed := Parse(argv, stdout, stderr)
	if parsed.Handled {
		return parsed.Exit
	}
	if stdin == nil {
		stdin = os.Stdin
	}
	if getenv == nil {
		getenv = os.Getenv
	}
	paths := defaultPaths(getenv)
	app := &App{
		Paths:  paths,
		In:     stdin,
		Out:    stdout,
		Err:    stderr,
		InTTY:  ui.IsTerminalReader(stdin),
		ErrTTY: ui.IsTerminalWriter(stderr),
		Getenv: getenv,
	}
	var err error
	switch parsed.Args.Command {
	case "issue":
		err = app.Issue(parsed.Args.Name, parsed.Args.Replace)
	case "usb":
		err = app.USB(parsed.Args.Dest)
	case "list":
		err = app.List()
	case "employees":
		err = app.Employees(parsed.Args.Roster, parsed.Args.AutoGroup, parsed.Args.Apply)
	default:
		err = newError("no command")
	}
	if err == nil {
		return 0
	}
	var appErr *AppError
	message := err.Error()
	code := 1
	if errors.As(err, &appErr) {
		message = appErr.Msg
		if appErr.Code != 0 {
			code = appErr.Code
		}
	}
	fmt.Fprintf(stderr, "error: %s\n", message)
	return code
}
