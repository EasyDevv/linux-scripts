// Package ui is the inline script picker.
//
// It is a summon-and-exit list, not an alt-screen app: rows are drawn on
// stderr, the chosen id is returned to the caller, and the caller then runs
// the script in the same terminal. Non-TTY behavior and exit codes belong to
// the app package; Run only reports ErrNotTTY.
package ui

import (
	"errors"

	tea "charm.land/bubbletea/v2"
)

// Item is one row. ID is what Run returns. Group names a header; rows keep
// the order the caller supplied and are grouped in first-appearance order.
// Detail is the dim note after the label (script command, use count).
type Item struct {
	ID     string
	Label  string
	Group  string
	Detail string
}

// Options configures one Run.
type Options struct {
	Title    string
	Subtitle string
	// Color forces ANSI on or off. Nil detects: off when NO_COLOR is set
	// (even if empty) or stderr is not a terminal.
	Color *bool
}

// Result is a finished selection.
type Result struct {
	ID string
}

var (
	// ErrNotTTY means stdin or stderr is not an interactive terminal.
	ErrNotTTY = errors.New("ui: interactive terminal required")
	// ErrEmpty means the caller passed no items.
	ErrEmpty = errors.New("ui: list is empty")
	// ErrAborted means the user cancelled (q, Esc, Ctrl+C) or a signal stopped the program.
	ErrAborted = errors.New("ui: aborted")
)

// keys is the picker's key catalog. The footer hints and the handler read it.
var keys = struct {
	move   string
	reach  string
	accept string
	abort  string
}{
	move:   "↑/↓ j/k",
	reach:  "g/G",
	accept: "enter",
	abort:  "q",
}

// model is the picker state. Update is the only place it changes.
type model struct {
	title    string
	subtitle string
	rows     []Item
	sections []section
	current  int
	width    int
	height   int
	color    bool
	done     bool
	aborted  bool
}

type section struct {
	title string
	from  int
	to    int
}

func newModel(items []Item, opts Options) model {
	rows, sects := arrange(items)
	return model{
		title:    opts.Title,
		subtitle: opts.Subtitle,
		rows:     rows,
		sections: sects,
		color:    colorsEnabled(opts.Color),
	}
}

// arrange groups rows by Group, preserving first-appearance order.
// Section indexes refer to the returned slice. An ungrouped row becomes
// the headerless bucket, which keeps a plain list working.
func arrange(items []Item) ([]Item, []section) {
	var order []string
	buckets := map[string][]Item{}
	for _, it := range items {
		if _, seen := buckets[it.Group]; !seen {
			order = append(order, it.Group)
		}
		buckets[it.Group] = append(buckets[it.Group], it)
	}
	rows := make([]Item, 0, len(items))
	var sects []section
	for _, group := range order {
		bucket := buckets[group]
		from := len(rows)
		rows = append(rows, bucket...)
		sects = append(sects, section{title: group, from: from, to: len(rows)})
	}
	return rows, sects
}

func (m model) Init() tea.Cmd { return nil }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	case tea.KeyPressMsg:
		return m.applyKey(msg)
	default:
		return m, nil
	}
}

func (m model) applyKey(k tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	// Alt is reserved by KWin/Wayland. Never bind it; ignore the chord.
	if k.Mod.Contains(tea.ModAlt) || k.Mod.Contains(tea.ModMeta) || k.Mod.Contains(tea.ModSuper) {
		return m, nil
	}
	if k.Mod.Contains(tea.ModCtrl) && !isLineFeed(k) {
		if k.Code == 'c' || k.Keystroke() == "ctrl+c" {
			m.aborted = true
			return m, tea.Interrupt
		}
		return m, nil
	}
	switch k.String() {
	case "q", "esc":
		m.aborted = true
		return m, tea.Quit
	case "up", "k":
		if m.current > 0 {
			m.current--
		}
	case "down", "j":
		if n := len(m.rows); n > 0 && m.current < n-1 {
			m.current++
		}
	case "g", "home":
		m.current = 0
	case "G", "end":
		if n := len(m.rows); n > 0 {
			m.current = n - 1
		}
	case "enter":
		if len(m.rows) == 0 {
			return m, nil
		}
		m.done = true
		return m, tea.Quit
	}
	if isEnter(k) {
		if len(m.rows) == 0 {
			return m, nil
		}
		m.done = true
		return m, tea.Quit
	}
	return m, nil
}

// isEnter covers the KeyPressMsg shapes that mean accept: named enter,
// KpEnter, and the raw CR/LF bytes.
func isEnter(k tea.KeyPressMsg) bool {
	if k.Code == tea.KeyEnter || k.Code == tea.KeyKpEnter {
		return true
	}
	return isLineFeed(k) || k.Text == "\r"
}

// isLineFeed reports the LF byte. Bubble Tea's legacy table encodes it as ctrl+j.
func isLineFeed(k tea.KeyPressMsg) bool {
	if k.Text == "\n" || k.Keystroke() == "ctrl+j" {
		return true
	}
	return k.Mod.Contains(tea.ModCtrl) && k.Code == 'j'
}

func (m model) result() Result {
	if len(m.rows) == 0 {
		return Result{}
	}
	return Result{ID: m.rows[m.current].ID}
}
