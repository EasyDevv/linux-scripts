package ui

import (
	"errors"
	"os"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/term"
)

// stdinIsTerminal and stderrIsTerminal are seams so tests can force ErrNotTTY
// without a pty. Run still assumes a real terminal in production.
var (
	stdinIsTerminal  = func() bool { return term.IsTerminal(os.Stdin.Fd()) }
	stderrIsTerminal = func() bool { return term.IsTerminal(os.Stderr.Fd()) }
)

func interactive() bool {
	return stdinIsTerminal() && stderrIsTerminal()
}

func colorsEnabled(override *bool) bool {
	if override != nil {
		return *override
	}
	if _, set := os.LookupEnv("NO_COLOR"); set {
		return false
	}
	if os.Getenv("TERM") == "dumb" {
		return false
	}
	return stderrIsTerminal()
}

// Run draws the picker on stderr and blocks until the user accepts or
// cancels. A non-terminal stdin or stderr returns ErrNotTTY. An empty list
// returns ErrEmpty before any terminal check. q, Esc and Ctrl+C return
// ErrAborted after Bubble Tea restores the terminal.
func Run(items []Item, opts Options) (Result, error) {
	if len(items) == 0 {
		return Result{}, ErrEmpty
	}
	if !interactive() {
		return Result{}, ErrNotTTY
	}
	m := newModel(items, opts)
	prog := tea.NewProgram(m, tea.WithInput(os.Stdin), tea.WithOutput(os.Stderr))
	final, err := prog.Run()
	got, ok := final.(model)
	if !ok && final != nil {
		if p, isPtr := final.(*model); isPtr && p != nil {
			got = *p
			ok = true
		}
	}
	if errors.Is(err, tea.ErrInterrupted) || (ok && got.aborted) {
		return Result{}, ErrAborted
	}
	if err != nil {
		return Result{}, err
	}
	if !ok {
		return Result{}, errors.New("ui: program returned unexpected model")
	}
	if !got.done {
		return Result{}, ErrAborted
	}
	return got.result(), nil
}
