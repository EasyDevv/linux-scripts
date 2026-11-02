// picker.go is choose_files() without the raw-mode loop: the app builds the
// frame, this model owns the cursor, the scroll offset, and the keys. The key
// meanings and texts are the original's (j/k/arrows move, Space toggles, a
// toggles all, m switches the mode, Enter applies, q/Esc/Ctrl-C abort).
package app

import (
	"fmt"
	"os"

	"set-rules/internal/ui"
)

// choose is choose_files(): a terminal is required, conflicts start
// deselected, and the picker returns the selected items in list order.
func (a *app) choose() ([]ManagedItem, bool, error) {
	if !isTerminal(os.Stdin) || !isTerminal(os.Stdout) {
		return nil, false, fmt.Errorf("This script must run in an interactive terminal.")
	}
	states := a.inspectStates(a.projectRoot, a.items, a.modes)
	normalizeSelection(a.selection, a.items, states, ManagedItem{}, false)
	for _, item := range a.items {
		if states[item].state == "conflict" {
			a.selection[item] = false
		}
	}

	picked, aborted, err := ui.Pick(a, os.Stdin, os.Stderr)
	if err != nil {
		return nil, false, err
	}
	if aborted || !picked {
		return nil, false, nil
	}

	var chosen []ManagedItem
	for _, item := range a.items {
		if a.selection[item] {
			chosen = append(chosen, item)
		}
	}
	return chosen, true, nil
}
