package ui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

func twoChoices() model {
	return NewModel("Select USB storage", []Choice{
		{ID: "/run/media/u/USB", Label: "USB  /run/media/u/USB", Color: ColorGreen},
		{ID: "/media/u/OLD", Label: "OLD  /media/u/OLD", Color: ColorGreen},
	}, false)
}

func press(m model, msg tea.KeyPressMsg) (model, tea.Cmd) {
	updated, cmd := m.Update(msg)
	return updated.(model), cmd
}

// KeyClassifyTests.test_arrows_and_vim_keys, as Bubble Tea key events.
func TestKeyActions(t *testing.T) {
	cases := []struct {
		msg  tea.KeyPressMsg
		want action
	}{
		{tea.KeyPressMsg{Code: 'j', Text: "j"}, actionDown},
		{tea.KeyPressMsg{Code: 'k', Text: "k"}, actionUp},
		{tea.KeyPressMsg{Code: 'g', Text: "g"}, actionFirst},
		{tea.KeyPressMsg{Code: 'G', Text: "G"}, actionLast},
		{tea.KeyPressMsg{Code: tea.KeyUp}, actionUp},
		{tea.KeyPressMsg{Code: tea.KeyDown}, actionDown},
		{tea.KeyPressMsg{Code: tea.KeyHome}, actionFirst},
		{tea.KeyPressMsg{Code: tea.KeyEnd}, actionLast},
		{tea.KeyPressMsg{Code: tea.KeyEnter}, actionSelect},
		{tea.KeyPressMsg{Code: 'q', Text: "q"}, actionAbort},
		{tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl}, actionAbort},
		{tea.KeyPressMsg{Code: tea.KeyEscape}, actionAbort},
		{tea.KeyPressMsg{Code: '2', Text: "2"}, actionNone},
		{tea.KeyPressMsg{Code: 'j', Text: "j", Mod: tea.ModAlt}, actionNone},
	}
	for _, tc := range cases {
		if got := keyAction(tc.msg); got != tc.want {
			t.Fatalf("keyAction(%q) = %v, want %v", tc.msg.Keystroke(), got, tc.want)
		}
	}
}

// The original wrapped with modulo; the port clamps at both ends.
func TestMoveClamps(t *testing.T) {
	cases := []struct {
		index       int
		act         action
		count, want int
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

func TestUpdateMovesAndSelects(t *testing.T) {
	m := twoChoices()
	m, _ = press(m, tea.KeyPressMsg{Code: 'j', Text: "j"})
	if m.index != 1 {
		t.Fatalf("j index = %d, want 1", m.index)
	}
	m, _ = press(m, tea.KeyPressMsg{Code: 'j', Text: "j"})
	if m.index != 1 {
		t.Fatalf("last row clamps, index = %d, want 1", m.index)
	}
	m, _ = press(m, tea.KeyPressMsg{Code: 'g', Text: "g"})
	if m.index != 0 {
		t.Fatalf("g index = %d, want 0", m.index)
	}
	m, cmd := press(m, tea.KeyPressMsg{Code: tea.KeyEnter})
	if cmd == nil || !m.chosen || m.aborted {
		t.Fatalf("enter: cmd=%v chosen=%v aborted=%v", cmd, m.chosen, m.aborted)
	}
	if !strings.Contains(m.Frame(), "> USB") {
		t.Fatalf("selected row missing:\n%s", m.Frame())
	}
}

func TestUpdateAborts(t *testing.T) {
	for _, msg := range []tea.KeyPressMsg{
		{Code: 'q', Text: "q"},
		{Code: tea.KeyEscape},
		{Code: 'c', Mod: tea.ModCtrl},
	} {
		m, cmd := press(twoChoices(), msg)
		if !m.aborted || cmd == nil || m.chosen {
			t.Fatalf("%q: aborted=%v cmd=%v", msg.Keystroke(), m.aborted, cmd)
		}
	}
}

func TestWindowSizeIsHandled(t *testing.T) {
	updated, _ := twoChoices().Update(tea.WindowSizeMsg{Width: 60, Height: 24})
	if got := updated.(model).width; got != 60 {
		t.Fatalf("width = %d, want 60", got)
	}
	// Only the choice rows are cut to width-1, as in the original.
	updated, _ = updated.Update(tea.WindowSizeMsg{Width: 20, Height: 24})
	for _, row := range strings.Split(updated.(model).Frame(), "\n")[2:4] {
		if got := lipgloss.Width(row); got > 19 {
			t.Fatalf("row %q width = %d at 20 columns, want at most 19", row, got)
		}
	}
}

// TestFrameText pins the title, the blank lines, the rows, and the footer.
func TestFrameText(t *testing.T) {
	want := strings.Join([]string{
		"Select USB storage",
		"",
		"> USB  /run/media/u/USB",
		"  OLD  /media/u/OLD",
		"",
		"↑/↓ move  enter select  q abort",
	}, "\n")
	if got := twoChoices().Frame(); got != want {
		t.Fatalf("Frame() =\n%s\nwant\n%s", got, want)
	}
}

// TestFrameHangulWidth asserts cells, not bytes: a Korean label stays aligned.
func TestFrameHangulWidth(t *testing.T) {
	m := NewModel("설치 키 선택", []Choice{
		{ID: "A", Label: "관리자 PC", Color: ColorCyan},
		{ID: "B", Label: "직원 휴대폰", Color: ColorCyan},
	}, false)
	rows := strings.Split(m.Frame(), "\n")
	if len(rows) != 6 {
		t.Fatalf("rows = %d, want 6", len(rows))
	}
	if got, want := lipgloss.Width(rows[2]), 11; got != want {
		t.Fatalf("selected Hangul row width = %d, want %d (bytes: %d)", got, want, len(rows[2]))
	}
	if len(rows[2]) == lipgloss.Width(rows[2]) {
		t.Fatalf("row %q: bytes equal cells, Hangul was not counted as 2", rows[2])
	}
}

// Key-name prompt: typed characters are kept and echoed after the prompt.
func TestSecretPromptEchoesInput(t *testing.T) {
	m := newSecretModel(NamePromptForTest)
	for _, text := range []string{"g", "r", "e", "e", "n"} {
		m, _ = pressSecret(m, tea.KeyPressMsg{Code: rune(text[0]), Text: text})
	}
	frame := m.View().Content
	if frame != NamePromptForTest+"green" {
		t.Fatalf("frame = %q, want the prompt plus the typed name", frame)
	}
	if m.Value() != "green" {
		t.Fatalf("value = %q", m.Value())
	}
	m, _ = pressSecret(m, tea.KeyPressMsg{Code: tea.KeyBackspace})
	if m.Value() != "gree" {
		t.Fatalf("after backspace value = %q", m.Value())
	}
	m, cmd := pressSecret(m, tea.KeyPressMsg{Code: tea.KeyEnter})
	if !m.done || cmd == nil {
		t.Fatalf("enter: done=%v cmd=%v", m.done, cmd)
	}
}

func TestSecretPromptAborts(t *testing.T) {
	for _, msg := range []tea.KeyPressMsg{
		{Code: tea.KeyEscape},
		{Code: 'c', Mod: tea.ModCtrl},
	} {
		m, cmd := pressSecret(newSecretModel("Key name: "), msg)
		if !m.aborted || cmd == nil || m.done {
			t.Fatalf("%q: aborted=%v cmd=%v", msg.Keystroke(), m.aborted, cmd)
		}
	}
}

// NamePromptForTest mirrors the app layer's prompt text.
const NamePromptForTest = "Key name (e.g. GREEN_USER_01): "

func pressSecret(m secretModel, msg tea.KeyPressMsg) (secretModel, tea.Cmd) {
	updated, cmd := m.Update(msg)
	return updated.(secretModel), cmd
}
