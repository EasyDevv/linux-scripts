// picker.go replaces picker.ts's raw-mode reader with a Bubble Tea model: an
// inline list (no alt-screen), drawn on stderr. The key meanings and the texts
// are the original's; the escape-sequence parser and cursor math are Bubble
// Tea's now.
package ui

import (
	"errors"
	"fmt"
	"io"
	"strings"

	tea "charm.land/bubbletea/v2"
)

// Item is a picker row: label plus an optional dim hint.
type Item struct {
	Label string
	Hint  string
}

type action int

const (
	actionNone action = iota
	actionUp
	actionDown
	actionFirst
	actionLast
	actionSelect
	actionAbort
)

type model struct {
	title   string
	items   []Item
	index   int
	color   bool
	width   int
	aborted bool
}

func newModel(title string, items []Item, initial int, color bool) model {
	if initial < 0 || initial >= len(items) {
		initial = 0
	}
	return model{title: title, items: items, index: initial, color: color}
}

func (m model) Init() tea.Cmd { return nil }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
	case tea.KeyPressMsg:
		switch keyAction(msg) {
		case actionUp:
			m.index = move(m.index, actionUp, len(m.items))
		case actionDown:
			m.index = move(m.index, actionDown, len(m.items))
		case actionFirst:
			m.index = move(m.index, actionFirst, len(m.items))
		case actionLast:
			m.index = move(m.index, actionLast, len(m.items))
		case actionSelect:
			return m, tea.Quit
		case actionAbort:
			m.aborted = true
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m model) View() tea.View { return tea.NewView(m.Frame()) }

// Frame is the list text: bold title, one row per item, dim footer. The
// selected row is bold cyan with a `>` marker; hints stay dim.
func (m model) Frame() string {
	sgr := func(code string) string {
		if !m.color {
			return ""
		}
		return "\x1b[" + code + "m"
	}
	nc := sgr("0")
	lines := make([]string, 0, len(m.items)+2)
	lines = append(lines, sgr("1")+m.title+nc)
	for i, item := range m.items {
		hint := ""
		if item.Hint != "" {
			hint = " " + sgr("2") + item.Hint + nc
		}
		if i == m.index {
			lines = append(lines, sgr("1;36")+"> "+item.Label+nc+hint)
		} else {
			lines = append(lines, "  "+item.Label+hint)
		}
	}
	lines = append(lines, sgr("2")+"↑/↓ move  enter select  q abort"+nc)
	return strings.Join(lines, "\n")
}

// keyAction is classifyKey(): arrows and vim keys move, g/G jump, Enter
// selects, q/Esc/Ctrl-C abort. Everything else, including Alt chords, is
// actionNone. It reads the key event itself, not its rendered name, so a
// shifted G keeps working under the Kitty keyboard protocol.
func keyAction(key tea.KeyPressMsg) action {
	if key.Mod.Contains(tea.ModCtrl) {
		if key.Code == 'c' || key.Code == 3 {
			return actionAbort
		}
		return actionNone
	}
	if key.Mod.Contains(tea.ModAlt) || key.Mod.Contains(tea.ModMeta) ||
		key.Mod.Contains(tea.ModHyper) || key.Mod.Contains(tea.ModSuper) {
		return actionNone
	}
	switch key.Code {
	case tea.KeyUp:
		return actionUp
	case tea.KeyDown:
		return actionDown
	case tea.KeyHome:
		return actionFirst
	case tea.KeyEnd:
		return actionLast
	case tea.KeyEnter:
		return actionSelect
	case tea.KeyEscape:
		return actionAbort
	}
	switch key.Text {
	case "k":
		return actionUp
	case "j":
		return actionDown
	case "g":
		return actionFirst
	case "G":
		return actionLast
	case "q":
		return actionAbort
	}
	return actionNone
}

// move is move() from picker.ts: clamps at both ends.
func move(index int, a action, count int) int {
	switch a {
	case actionUp:
		if index > 0 {
			return index - 1
		}
		return 0
	case actionDown:
		if index < count-1 {
			return index + 1
		}
		return count - 1
	case actionFirst:
		return 0
	case actionLast:
		return count - 1
	}
	return index
}

// Pick runs the inline picker until Enter (chosen index), or q/Esc/Ctrl-C
// (aborted). in and out are the terminal handles; ship passes os.Stdin and
// os.Stderr.
func Pick(title string, items []Item, initial int, color bool, in io.Reader, out io.Writer) (index int, aborted bool, err error) {
	if len(items) == 0 {
		return 0, false, errors.New("ui: no items to pick from")
	}
	program := tea.NewProgram(newModel(title, items, initial, color), tea.WithInput(in), tea.WithOutput(out))
	final, runErr := program.Run()
	got, ok := final.(model)
	if !ok {
		if pointer, isPointer := final.(*model); isPointer && pointer != nil {
			got, ok = *pointer, true
		}
	}
	if !ok {
		if runErr != nil {
			return 0, false, runErr
		}
		return 0, false, fmt.Errorf("ui: program returned an unexpected model")
	}
	if errors.Is(runErr, tea.ErrInterrupted) || got.aborted {
		return 0, true, nil
	}
	if runErr != nil {
		return 0, false, runErr
	}
	return got.index, false, nil
}
