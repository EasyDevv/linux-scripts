// picker.go replaces the original's termios reader with a Bubble Tea model: an
// inline list (no alt-screen) drawn on stderr. The key meanings, title, rows,
// empty lines, and footer text are the original's; the escape-sequence parser
// and cursor arithmetic are Bubble Tea's.
package ui

import (
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/term"
)

// Row colors: the original's Choice.color values.
const (
	ColorCyan  = "36"
	ColorGreen = "32"
	ColorRed   = "31"
	ColorDim   = "2"
)

// Choice is one picker row.
type Choice struct {
	ID     string
	Label  string
	Detail string
	Color  string
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
	choices []Choice
	index   int
	color   bool
	width   int
	chosen  bool
	aborted bool
}

// NewModel builds the picker model. Exported for tests in other packages.
func NewModel(title string, choices []Choice, color bool) model {
	return model{title: title, choices: choices, color: color, width: 80}
}

func (m model) Init() tea.Cmd { return nil }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
	case tea.KeyPressMsg:
		switch keyAction(msg) {
		case actionUp:
			m.index = move(m.index, actionUp, len(m.choices))
		case actionDown:
			m.index = move(m.index, actionDown, len(m.choices))
		case actionFirst:
			m.index = move(m.index, actionFirst, len(m.choices))
		case actionLast:
			m.index = move(m.index, actionLast, len(m.choices))
		case actionSelect:
			m.chosen = true
			return m, tea.Quit
		case actionAbort:
			m.aborted = true
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m model) View() tea.View { return tea.NewView(m.Frame()) }

// Frame is the drawn text: bold title, blank line, one row per choice, a blank
// line, then the dim footer. Rows are cut to the terminal width minus one, as
// the original did.
func (m model) Frame() string {
	sgr := func(codes ...string) string {
		if !m.color || len(codes) == 0 {
			return ""
		}
		return "\x1b[" + strings.Join(codes, ";") + "m"
	}
	nc := sgr("0")
	limit := m.width - 1
	if limit < 1 {
		limit = 1
	}
	lines := make([]string, 0, len(m.choices)+4)
	lines = append(lines, sgr("1")+m.title+nc, "")
	for i, choice := range m.choices {
		marker := " "
		if i == m.index {
			marker = ">"
		}
		body := choice.Label
		if choice.Detail != "" {
			body += "  " + choice.Detail
		}
		styles := []string{choice.Color}
		if i == m.index {
			styles = append([]string{"1"}, styles...)
		}
		line := marker + " " + sgr(styles...) + body + nc
		lines = append(lines, truncate(line, limit))
	}
	lines = append(lines, "", sgr("2")+"↑/↓ move  enter select  q abort"+nc)
	return strings.Join(lines, "\n")
}

// truncate cuts text to width cells; color codes count as zero cells.
func truncate(text string, width int) string {
	if lipgloss.Width(text) <= width {
		return text
	}
	runes := []rune(text)
	for len(runes) > 1 {
		runes = runes[:len(runes)-1]
		if lipgloss.Width(string(runes)) <= width {
			return string(runes)
		}
	}
	return string(runes)
}

// keyAction reads the key event, not its rendered name, so a shifted G keeps
// working. Alt chords are ignored: KWin owns Alt on this desktop.
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

// move clamps at both ends (the original wrapped; see the README Changelog).
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

// Pick runs the picker until Enter (chosen) or q/Esc/Ctrl-C (not chosen).
func Pick(title string, choices []Choice, color bool, in io.Reader, out io.Writer) (Choice, bool, error) {
	if len(choices) == 0 {
		return Choice{}, false, errors.New("ui: nothing to select")
	}
	final, err := tea.NewProgram(NewModel(title, choices, color),
		tea.WithInput(in), tea.WithOutput(out)).Run()
	got, ok := final.(model)
	if !ok {
		if err != nil {
			return Choice{}, false, err
		}
		return Choice{}, false, fmt.Errorf("ui: program returned an unexpected model")
	}
	if errors.Is(err, tea.ErrInterrupted) || got.aborted || !got.chosen {
		return Choice{}, false, nil
	}
	if err != nil {
		return Choice{}, false, err
	}
	return choices[got.index], true, nil
}

// ColorEnabled is the original's color_enabled(): the stream is a terminal and
// NO_COLOR is absent (the original tested presence, so an empty NO_COLOR still
// disables color), plus the build-terminal TERM=dumb rule (README Changelog).
func ColorEnabled(stream io.Writer) bool {
	if _, present := os.LookupEnv("NO_COLOR"); present {
		return false
	}
	if os.Getenv("TERM") == "dumb" {
		return false
	}
	return isTerminalWriter(stream)
}

func isTerminalWriter(stream io.Writer) bool {
	file, ok := stream.(*os.File)
	return ok && term.IsTerminal(file.Fd())
}

// IsTerminalWriter reports whether a stream is a terminal.
func IsTerminalWriter(stream io.Writer) bool { return isTerminalWriter(stream) }

// IsTerminalReader reports whether an input stream is a terminal.
func IsTerminalReader(stream io.Reader) bool {
	file, ok := stream.(*os.File)
	return ok && term.IsTerminal(file.Fd())
}
