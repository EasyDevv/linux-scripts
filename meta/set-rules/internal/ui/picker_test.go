// picker_test.go drives the model with tea.KeyPressMsg values and asserts the
// frame text: the picker's cursor, keys, and scroll window.
package ui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
)

// fakeScreen is the picker's app side for these tests.
type fakeScreen struct {
	rows    []string
	lastKey int
	toggled int
	message string
}

func (f *fakeScreen) Len() int                   { return len(f.rows) }
func (f *fakeScreen) DisplayIndex(index int) int { return index }
func (f *fakeScreen) ListHeight(height int) int  { return max(1, height-8) }
func (f *fakeScreen) Frame(width, height, index, offset int) []string {
	lines := make([]string, 0, len(f.rows)+1)
	for i, row := range f.rows {
		if i == index {
			lines = append(lines, "> "+row)
		} else {
			lines = append(lines, "  "+row)
		}
	}
	lines = append(lines, f.message)
	return lines
}
func (f *fakeScreen) Toggle(index int)     { f.toggled = index }
func (f *fakeScreen) ToggleAll()           { f.toggled = -1 }
func (f *fakeScreen) ToggleMode(index int) { f.toggled = index * 10 }
func (f *fakeScreen) ResetMessage()        { f.message = "Press Enter to apply the current selection." }
func (f *fakeScreen) UnknownKey()          { f.message = "Use arrows/jk, Space, a, m, Enter, or q." }

func press(code rune, text string) tea.KeyPressMsg {
	return tea.KeyPressMsg{Code: code, Text: text}
}

func send(m model, msg tea.Msg) (model, tea.Cmd) {
	next, cmd := m.Update(msg)
	return next.(model), cmd
}

func viewText(m model) string {
	return strings.Join(m.screen.Frame(m.width, m.height, m.index, m.offset), "\n")
}

func TestKeysMoveCursorAndToggle(t *testing.T) {
	screen := &fakeScreen{rows: []string{"bun", "stack-svelte", "write-doc"}}
	m := newModel(screen)

	if got := viewText(m); !strings.HasPrefix(got, "> bun\n") || !strings.Contains(got, "\n  stack-svelte\n") {
		t.Fatalf("initial view = %q", got)
	}

	m, _ = send(m, press('j', "j"))
	if m.index != 1 || !strings.Contains(viewText(m), "\n> stack-svelte\n") {
		t.Fatalf("j: index=%d view=%q", m.index, viewText(m))
	}
	m, _ = send(m, press('k', "k"))
	if m.index != 0 {
		t.Fatalf("k index = %d", m.index)
	}
	m, _ = send(m, tea.KeyPressMsg{Code: tea.KeyDown})
	m, _ = send(m, tea.KeyPressMsg{Code: tea.KeyUp})
	if m.index != 0 {
		t.Fatalf("arrow index = %d", m.index)
	}
	for i := 0; i < 6; i++ {
		m, _ = send(m, press('j', "j"))
	}
	if m.index != 2 {
		t.Fatalf("down clamp index = %d", m.index)
	}

	m, _ = send(m, press('x', "x"))
	if screen.message != "Use arrows/jk, Space, a, m, Enter, or q." {
		t.Fatalf("unknown key message = %q", screen.message)
	}
	m, _ = send(m, press(' ', " "))
	if screen.toggled != 2 {
		t.Fatalf("space toggled %d", screen.toggled)
	}
	if screen.message != "Press Enter to apply the current selection." {
		t.Fatalf("space message = %q", screen.message)
	}
	m, _ = send(m, press('a', "a"))
	if screen.toggled != -1 {
		t.Fatalf("a toggled %d", screen.toggled)
	}
	m, _ = send(m, press('m', "m"))
	if screen.toggled != 20 {
		t.Fatalf("m toggled %d", screen.toggled)
	}
	if screen.message != "Press Enter to apply the current selection." {
		t.Fatalf("mode message must be the screen's own, got %q", screen.message)
	}
}

func TestAbortAndSelect(t *testing.T) {
	screen := &fakeScreen{rows: []string{"a", "b"}}

	m := newModel(screen)
	m, cmd := send(m, press('q', "q"))
	if !m.aborted || cmd == nil {
		t.Fatalf("q aborted=%v cmd=%v", m.aborted, cmd)
	}

	m = newModel(screen)
	m, _ = send(m, tea.KeyPressMsg{Code: tea.KeyEscape})
	if !m.aborted {
		t.Fatal("esc did not abort")
	}

	m = newModel(screen)
	m, _ = send(m, tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl})
	if !m.aborted {
		t.Fatal("ctrl+c did not abort")
	}

	m = newModel(screen)
	m, _ = send(m, tea.KeyPressMsg{Code: tea.KeyEnter})
	if !m.picked || m.aborted {
		t.Fatalf("enter picked=%v aborted=%v", m.picked, m.aborted)
	}

	// Alt chords are not bound.
	screen.rows = []string{"a", "b", "c"}
	m = newModel(screen)
	m, _ = send(m, tea.KeyPressMsg{Code: 'j', Mod: tea.ModAlt})
	if m.index != 0 {
		t.Fatalf("alt+j moved to %d", m.index)
	}
}

func TestScrollWindowFollowsCursor(t *testing.T) {
	screen := &fakeScreen{}
	for i := 0; i < 20; i++ {
		screen.rows = append(screen.rows, "row")
	}
	m := newModel(screen)
	m, _ = send(m, tea.WindowSizeMsg{Width: 60, Height: 10})
	for i := 0; i < 15; i++ {
		m, _ = send(m, press('j', "j"))
	}
	if m.offset != 14 {
		t.Fatalf("offset = %d, want 14", m.offset)
	}
	for i := 0; i < 15; i++ {
		m, _ = send(m, press('k', "k"))
	}
	if m.offset != 0 {
		t.Fatalf("offset after going up = %d", m.offset)
	}
}
