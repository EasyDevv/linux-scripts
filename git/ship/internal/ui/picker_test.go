package ui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

func twoItems() model {
	return newModel("Visibility of octocat/app", []Item{
		{Label: "private", Hint: "(default)"},
		{Label: "public"},
	}, 0, false)
}

func press(m model, msg tea.KeyPressMsg) (model, tea.Cmd) {
	updated, cmd := m.Update(msg)
	return updated.(model), cmd
}

// TestKeyActions ports picker.test.ts's classifyKey cases to the strings
// Bubble Tea reports for the same keys.
func TestKeyActions(t *testing.T) {
	cases := []struct {
		msg  tea.KeyPressMsg
		want action
	}{
		{tea.KeyPressMsg{Code: tea.KeyUp}, actionUp},
		{tea.KeyPressMsg{Code: 'k', Text: "k"}, actionUp},
		{tea.KeyPressMsg{Code: tea.KeyDown}, actionDown},
		{tea.KeyPressMsg{Code: 'j', Text: "j"}, actionDown},
		{tea.KeyPressMsg{Code: 'g', Text: "g"}, actionFirst},
		{tea.KeyPressMsg{Code: tea.KeyHome}, actionFirst},
		{tea.KeyPressMsg{Code: 'G', Text: "G"}, actionLast},
		{tea.KeyPressMsg{Code: tea.KeyEnd}, actionLast},
		{tea.KeyPressMsg{Code: tea.KeyEnter}, actionSelect},
		{tea.KeyPressMsg{Code: 'q', Text: "q"}, actionAbort},
		{tea.KeyPressMsg{Code: tea.KeyEscape}, actionAbort},
		{tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl}, actionAbort},
		{tea.KeyPressMsg{Code: '2', Text: "2"}, actionNone},
		{tea.KeyPressMsg{Code: 'j', Text: "j", Mod: tea.ModAlt}, actionNone},
	}
	for _, tc := range cases {
		if got := keyAction(tc.msg); got != tc.want {
			t.Fatalf("keyAction(%q) = %v, want %v", tc.msg.Keystroke(), got, tc.want)
		}
	}
}

// TestMoveClamps ports picker.test.ts's move cases.
func TestMoveClamps(t *testing.T) {
	cases := []struct {
		index int
		act   action
		count int
		want  int
	}{
		{0, actionUp, 2, 0},
		{1, actionDown, 2, 1},
		{0, actionDown, 2, 1},
		{1, actionFirst, 2, 0},
		{0, actionLast, 2, 1},
	}
	for _, tc := range cases {
		if got := move(tc.index, tc.act, tc.count); got != tc.want {
			t.Fatalf("move(%d, %v, %d) = %d, want %d", tc.index, tc.act, tc.count, got, tc.want)
		}
	}
}

// TestUpdateMovesAndSelects drives the model with key presses.
func TestUpdateMovesAndSelects(t *testing.T) {
	m := twoItems()
	m, _ = press(m, tea.KeyPressMsg{Code: tea.KeyDown})
	if m.index != 1 {
		t.Fatalf("after down index = %d, want 1", m.index)
	}
	m, _ = press(m, tea.KeyPressMsg{Code: 'j', Text: "j"})
	if m.index != 1 {
		t.Fatalf("down clamps at last row, index = %d, want 1", m.index)
	}
	m, _ = press(m, tea.KeyPressMsg{Code: 'g', Text: "g"})
	if m.index != 0 {
		t.Fatalf("g moves to first row, index = %d, want 0", m.index)
	}
	m, _ = press(m, tea.KeyPressMsg{Code: 'G', Text: "G"})
	if m.index != 1 {
		t.Fatalf("G moves to last row, index = %d, want 1", m.index)
	}
	m, cmd := press(m, tea.KeyPressMsg{Code: tea.KeyEnter})
	if cmd == nil {
		t.Fatal("enter did not quit the picker")
	}
	if m.aborted {
		t.Fatal("enter marked the picker aborted")
	}
	if !strings.Contains(m.Frame(), "> public") {
		t.Fatalf("selected row missing from frame:\n%s", m.Frame())
	}
}

// TestUpdateAborts checks q, Esc, and Ctrl-C all abort and quit.
func TestUpdateAborts(t *testing.T) {
	for _, msg := range []tea.KeyPressMsg{
		{Code: 'q', Text: "q"},
		{Code: tea.KeyEscape},
		{Code: 'c', Mod: tea.ModCtrl},
	} {
		m, cmd := press(twoItems(), msg)
		if !m.aborted || cmd == nil {
			t.Fatalf("%q: aborted=%v cmd=%v, want abort and quit", msg.Keystroke(), m.aborted, cmd)
		}
	}
}

// TestWindowSizeIsHandled keeps the model responsive to resize.
func TestWindowSizeIsHandled(t *testing.T) {
	m := twoItems()
	updated, _ := m.Update(tea.WindowSizeMsg{Width: 60, Height: 24})
	if got := updated.(model).width; got != 60 {
		t.Fatalf("width = %d, want 60", got)
	}
}

// TestFrameText pins the title, rows, hint, and footer.
func TestFrameText(t *testing.T) {
	want := strings.Join([]string{
		"Visibility of octocat/app",
		"> private (default)",
		"  public",
		"↑/↓ move  enter select  q abort",
	}, "\n")
	if got := twoItems().Frame(); got != want {
		t.Fatalf("Frame() =\n%s\nwant\n%s", got, want)
	}
}

// TestFrameWideLabelWidth asserts cells, not bytes: a Hangul label keeps the
// row at its display width so the columns stay aligned.
func TestFrameWideLabelWidth(t *testing.T) {
	m := newModel("공개 범위", []Item{{Label: "비공개", Hint: "(기본)"}, {Label: "공개"}}, 0, false)
	frame := m.Frame()
	row := strings.Split(frame, "\n")[1]
	if want := 15; lipgloss.Width(row) != want {
		t.Fatalf("selected Hangul row width = %d, want %d (bytes: %d)", lipgloss.Width(row), want, len(row))
	}
	if len(row) == lipgloss.Width(row) {
		t.Fatalf("row %q: byte length equals cell width, Hangul was not counted as 2", row)
	}
}
