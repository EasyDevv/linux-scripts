// picker.go replaces the original's termios raw-mode reader with a Bubble Tea
// model: an inline list (no alt-screen) drawn on stderr. The app owns the
// frame text, so this model owns only the cursor, the scroll offset, and the
// key meanings; the escape-sequence parser and the repaint are Bubble Tea's.
package ui

import (
	"errors"
	"fmt"
	"io"
	"strings"

	tea "charm.land/bubbletea/v2"
)

// Screen is the app side of the picker: the rows, the rendered frame, and the
// product actions. The picker never sees rules, skills, or symlinks.
type Screen interface {
	Len() int
	DisplayIndex(index int) int
	ListHeight(height int) int
	Frame(width, height, index, offset int) []string
	Toggle(index int)
	ToggleAll()
	ToggleMode(index int)
	ResetMessage()
	UnknownKey()
}

type action int

const (
	actionNone action = iota
	actionUp
	actionDown
	actionToggle
	actionToggleAll
	actionToggleMode
	actionSelect
	actionAbort
)

type model struct {
	screen  Screen
	index   int
	offset  int
	width   int
	height  int
	picked  bool
	aborted bool
}

func newModel(screen Screen) model {
	return model{screen: screen, width: 100, height: 24}
}

func (m model) Init() tea.Cmd { return nil }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m = m.scrolled()
	case tea.KeyPressMsg:
		switch classify(msg) {
		case actionUp:
			if m.index > 0 {
				m.index--
			}
			m.screen.ResetMessage()
			m = m.scrolled()
		case actionDown:
			if m.index < m.screen.Len()-1 {
				m.index++
			}
			m.screen.ResetMessage()
			m = m.scrolled()
		case actionToggle:
			m.screen.Toggle(m.index)
			m.screen.ResetMessage()
			m = m.scrolled()
		case actionToggleAll:
			m.screen.ToggleAll()
			m.screen.ResetMessage()
			m = m.scrolled()
		case actionToggleMode:
			// toggle_rule_mode sets its own message, so it is not reset here.
			m.screen.ToggleMode(m.index)
			m = m.scrolled()
		case actionSelect:
			m.picked = true
			return m, tea.Quit
		case actionAbort:
			m.aborted = true
			return m, tea.Quit
		case actionNone:
			m.screen.UnknownKey()
		}
	}
	return m, nil
}

func (m model) View() tea.View {
	return tea.NewView(strings.Join(m.screen.Frame(m.width, m.height, m.index, m.offset), "\n"))
}

// scrolled is render_lines' offset clamp: keep the cursor row inside the
// list window, scrolling by the entries (spacers and headers included).
func (m model) scrolled() model {
	if m.screen.Len() == 0 {
		m.offset = 0
		return m
	}
	display := m.screen.DisplayIndex(m.index)
	height := m.screen.ListHeight(m.height)
	if display < m.offset {
		m.offset = display
	} else if display >= m.offset+height {
		m.offset = display - height + 1
	}
	if m.offset < 0 {
		m.offset = 0
	}
	return m
}

// classify maps one key press onto an action. Alt chords are not bound. The
// original read single bytes, so it accepted both letter cases and the
// control bytes Ctrl-C and Esc.
func classify(key tea.KeyPressMsg) action {
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
	case tea.KeyEnter:
		return actionSelect
	case tea.KeyEscape:
		return actionAbort
	case tea.KeySpace:
		return actionToggle
	}
	switch key.Text {
	case "j", "J":
		return actionDown
	case "k", "K":
		return actionUp
	case "a", "A":
		return actionToggleAll
	case "m", "M":
		return actionToggleMode
	case "q", "Q":
		return actionAbort
	case " ":
		return actionToggle
	}
	switch key.Code {
	case 'j', 'J':
		return actionDown
	case 'k', 'K':
		return actionUp
	case 'a', 'A':
		return actionToggleAll
	case 'm', 'M':
		return actionToggleMode
	case 'q', 'Q':
		return actionAbort
	case ' ':
		return actionToggle
	}
	return actionNone
}

// Pick runs the inline picker until Enter (picked) or q/Esc/Ctrl-C (aborted).
// in and out are the terminal handles; set-rules passes os.Stdin and
// os.Stderr, so the chosen result stays on stdout.
func Pick(screen Screen, in io.Reader, out io.Writer) (picked, aborted bool, err error) {
	program := tea.NewProgram(newModel(screen), tea.WithInput(in), tea.WithOutput(out))
	final, runErr := program.Run()
	got, ok := final.(model)
	if !ok {
		if pointer, isPointer := final.(*model); isPointer && pointer != nil {
			got, ok = *pointer, true
		}
	}
	if !ok {
		if runErr != nil {
			return false, false, runErr
		}
		return false, false, fmt.Errorf("ui: program returned an unexpected model")
	}
	if errors.Is(runErr, tea.ErrInterrupted) || got.aborted {
		return false, true, nil
	}
	if runErr != nil {
		return false, false, runErr
	}
	return got.picked, false, nil
}
