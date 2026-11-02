// run.go ports the top-level flow of set-rules.py: resolve the project path,
// build the item list and the rule modes, run the picker when there is a
// terminal, then apply the selection and print the summary.
//
// Exit codes: 0 ok, 1 fatal (the original's SystemExit text), 130 abort. The
// original also exited 1 from SystemExit("Cancelled.") by returning 130; the
// codes are unchanged here.
package app

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// app is the script's process state: the two source roots, the project, the
// inventory, the picker's selection and modes, and the streams.
type app struct {
	ruleRoot     string
	skillRoot    string
	projectRoot  string
	items        []ManagedItem
	selection    map[ManagedItem]bool
	modes        map[ManagedItem]string
	entries      []entry
	displayIndex map[ManagedItem]int
	message      string
	color        bool
	stdout       io.Writer
	stderr       io.Writer
}

// Run is the script's top level. argv is os.Args, so argv[0]'s base name is
// the usage name, as in the original.
func Run(argv []string) int {
	projectRoot, code, done := resolveProjectRoot(argv)
	if done {
		return code
	}

	a := &app{
		ruleRoot:    ruleSourceRoot(),
		skillRoot:   skillSourceRoot(),
		projectRoot: projectRoot,
		message:     defaultMessage,
		color:       colorEnabled(),
		stdout:      os.Stdout,
		stderr:      os.Stderr,
	}
	if err := a.run(); err != nil {
		var coded exitError
		if errors.As(err, &coded) {
			return coded.code
		}
		fmt.Fprintln(a.stderr, err)
		return 1
	}
	return 0
}

func (a *app) run() error {
	rawItems, err := listInstructionItems(a.ruleRoot, a.skillRoot)
	if err != nil {
		return err
	}
	a.items = groupInstructionItems(rawItems)
	a.modes = a.initialRuleModes(a.projectRoot, a.items)
	a.selection = a.buildSelection(a.projectRoot, a.items, a.modes)
	a.entries, a.displayIndex = buildDisplayEntries(a.items)

	chosen, confirmed, err := a.choose()
	if err != nil {
		return err
	}
	if !confirmed {
		fmt.Fprintln(a.stdout, "Cancelled.")
		return exitError{code: 130}
	}

	linked, moved, removed, unchanged, err := a.applySelection(a.projectRoot, a.items, chosen, a.modes)
	if err != nil {
		return err
	}
	a.printSummary(a.projectRoot, linked, moved, removed, unchanged)
	return nil
}

// exitError carries a code without printing another message.
type exitError struct{ code int }

func (e exitError) Error() string { return fmt.Sprintf("exit %d", e.code) }

// ExitCode maps an error to the process status: 130 for the abort, else 1.
func ExitCode(err error) int {
	if coded, ok := err.(exitError); ok {
		return coded.code
	}
	return 1
}

// resolveProjectRoot is resolve_project_root(): help wins, more than one
// argument is a usage error, and the path must exist.
func resolveProjectRoot(argv []string) (projectRoot string, code int, done bool) {
	name := filepath.Base(argv[0])
	usage := fmt.Sprintf("Usage: %s [PROJECT_PATH]", name)
	if len(argv) == 2 && (argv[1] == "-h" || argv[1] == "--help") {
		fmt.Fprintln(os.Stdout, usage)
		return "", 0, true
	}
	if len(argv) > 2 {
		fmt.Fprintln(os.Stderr, usage)
		return "", 1, true
	}
	if len(argv) == 2 {
		projectRoot = resolvePath(expandUser(argv[1]))
	} else {
		cwd, err := os.Getwd()
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return "", 1, true
		}
		projectRoot = resolvePath(cwd)
	}
	if !pathExists(projectRoot) {
		fmt.Fprintf(os.Stderr, "Project path does not exist: %s\n", projectRoot)
		return "", 1, true
	}
	return projectRoot, 0, false
}
