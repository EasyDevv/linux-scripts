package ui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

func testItems() []Item {
	return []Item{
		{ID: "dev", Label: "dev", Group: "Recent (1)", Detail: "×3  vite dev"},
		{ID: "build", Label: "build", Group: "Scripts (2)", Detail: "vite build"},
		{ID: "lint", Label: "lint", Group: "Scripts (2)", Detail: "eslint ."},
	}
}

func press(m model, k tea.KeyPressMsg) model {
	next, _ := m.Update(k)
	return next.(model)
}

func keyPress(code rune, text string) tea.KeyPressMsg {
	return tea.KeyPressMsg{Code: code, Text: text}
}

func TestArrangeKeepsFirstAppearanceOrder(t *testing.T) {
	rows, sections := arrange(testItems())
	if len(rows) != 3 || len(sections) != 2 {
		t.Fatalf("rows = %d, sections = %d", len(rows), len(sections))
	}
	if sections[0].title != "Recent (1)" || sections[0].from != 0 || sections[0].to != 1 {
		t.Fatalf("first section = %+v", sections[0])
	}
	if sections[1].title != "Scripts (2)" || sections[1].from != 1 || sections[1].to != 3 {
		t.Fatalf("second section = %+v", sections[1])
	}
}

func TestUpdateMovesAndWrapsAtEdges(t *testing.T) {
	m := newModel(testItems(), Options{})
	if m.current != 0 {
		t.Fatalf("current = %d", m.current)
	}
	m = press(m, tea.KeyPressMsg{Code: 'k', Text: "k"})
	if m.current != 0 {
		t.Fatalf("up at the top moved to %d", m.current)
	}
	m = press(m, tea.KeyPressMsg{Code: tea.KeyDown})
	if m.current != 1 {
		t.Fatalf("down = %d", m.current)
	}
	m = press(m, tea.KeyPressMsg{Code: 'j', Text: "j"})
	m = press(m, tea.KeyPressMsg{Code: 'j', Text: "j"})
	if m.current != 2 {
		t.Fatalf("down past the end = %d", m.current)
	}
	m = press(m, tea.KeyPressMsg{Code: 'g', Text: "g"})
	if m.current != 0 {
		t.Fatalf("g = %d", m.current)
	}
	m = press(m, tea.KeyPressMsg{Code: 'G', Text: "G"})
	if m.current != 2 {
		t.Fatalf("G = %d", m.current)
	}
}

func TestUpdateAcceptsWithEnter(t *testing.T) {
	m := newModel(testItems(), Options{})
	m = press(m, tea.KeyPressMsg{Code: tea.KeyDown})
	m = press(m, tea.KeyPressMsg{Code: tea.KeyEnter})
	if !m.done || m.aborted {
		t.Fatalf("done = %v, aborted = %v", m.done, m.aborted)
	}
	if got := m.result().ID; got != "build" {
		t.Fatalf("result = %q", got)
	}
}

// Enter also arrives as the CR byte from a legacy buffer.
func TestUpdateAcceptsWithCarriageReturn(t *testing.T) {
	m := newModel(testItems(), Options{})
	m = press(m, tea.KeyPressMsg{Code: tea.KeyEnter, Text: "\r"})
	if !m.done {
		t.Fatal("CR did not accept")
	}
}

func TestUpdateAbortsOnQEscAndCtrlC(t *testing.T) {
	for _, k := range []tea.KeyPressMsg{
		{Code: 'q', Text: "q"},
		{Code: tea.KeyEscape},
		{Code: 'c', Mod: tea.ModCtrl},
	} {
		m := newModel(testItems(), Options{})
		m = press(m, k)
		if !m.aborted {
			t.Fatalf("key %q did not abort", k.String())
		}
	}
}

// Alt belongs to KWin; the picker ignores every Alt chord.
func TestUpdateIgnoresAltChords(t *testing.T) {
	m := newModel(testItems(), Options{})
	m = press(m, tea.KeyPressMsg{Code: 'j', Mod: tea.ModAlt})
	if m.current != 0 || m.aborted || m.done {
		t.Fatalf("alt chord changed state: %+v", m)
	}
}

func TestUpdateRecordsWindowSize(t *testing.T) {
	m := newModel(testItems(), Options{})
	next, _ := m.Update(tea.WindowSizeMsg{Width: 72, Height: 18})
	m = next.(model)
	if m.width != 72 || m.height != 18 {
		t.Fatalf("size = %dx%d", m.width, m.height)
	}
}

func TestEmptyListIgnoresEnter(t *testing.T) {
	m := newModel(nil, Options{})
	m = press(m, tea.KeyPressMsg{Code: tea.KeyEnter})
	if m.done {
		t.Fatal("enter on an empty list must not finish")
	}
	if got := m.result().ID; got != "" {
		t.Fatalf("result = %q", got)
	}
}

func TestViewShowsEveryRowAndCursor(t *testing.T) {
	m := newModel(testItems(), Options{Color: boolPtr(false)})
	next, _ := m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	m = next.(model)
	frame := m.View().Content
	for _, want := range []string{"dev", "build", "lint", "Recent (1)", "Scripts (2)", "> "} {
		if !strings.Contains(frame, want) {
			t.Fatalf("frame is missing %q:\n%s", want, frame)
		}
	}
	for _, line := range strings.Split(frame, "\n") {
		if w := lipgloss.Width(line); w > 80 {
			t.Fatalf("line width %d exceeds 80: %q", w, line)
		}
	}
}

// A Hangul label must be cut by cells, not bytes: two cells per syllable.
func TestTakeCellsCountsHangulWidth(t *testing.T) {
	label := "스크립트 목록"
	if w := lipgloss.Width(label); w != 13 {
		t.Fatalf("source width = %d, want 13", w)
	}
	got := takeCells(label, 6)
	if w := lipgloss.Width(got); w != 6 {
		t.Fatalf("truncated width = %d, want 6 (%q)", w, got)
	}
	// A wide glyph that does not fit whole is dropped, never split.
	if w := lipgloss.Width(takeCells(label, 5)); w != 4 {
		t.Fatalf("odd width = %d, want 4", w)
	}
}

// A long detailed row is truncated to the terminal width.
func TestViewTruncatesLongDetail(t *testing.T) {
	items := []Item{{ID: "a", Label: "dev", Detail: "very-long-command-that-keeps-going-and-going"}}
	m := newModel(items, Options{Color: boolPtr(false)})
	next, _ := m.Update(tea.WindowSizeMsg{Width: 40, Height: 12})
	m = next.(model)
	for _, line := range strings.Split(m.View().Content, "\n") {
		if w := lipgloss.Width(line); w > 40 {
			t.Fatalf("line width %d exceeds 40: %q", w, line)
		}
	}
}

func TestHintsNameEveryKey(t *testing.T) {
	move, act := hints(false)
	if !strings.Contains(move, keys.move) || !strings.Contains(act, keys.accept) || !strings.Contains(act, keys.abort) {
		t.Fatalf("hints = %q / %q", move, act)
	}
	if narrowMove, _ := hints(true); narrowMove == "" {
		t.Fatal("narrow hints are empty")
	}
}

func boolPtr(v bool) *bool { return &v }
