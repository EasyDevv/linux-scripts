package ui

import (
	"errors"
	"os"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

func plain() *bool {
	v := false
	return &v
}

func colored() *bool {
	v := true
	return &v
}

func cloudItems() []Item {
	return []Item{
		{ID: "aws", Label: "aws", Category: "cloud", Detail: "미설치"},
		{ID: "cf", Label: "cf", Category: "cloud"},
	}
}

func three() model {
	return newModel([]Item{
		{ID: "a", Label: "a", Category: "cloud"},
		{ID: "b", Label: "b", Category: "cloud"},
		{ID: "c", Label: "c", Category: "cloud"},
	}, Options{Title: "도구", Color: plain()})
}

func press(m model, k tea.KeyPressMsg) (model, tea.Cmd) {
	next, cmd := m.Update(k)
	return next.(model), cmd
}

func seq(m model, keys ...tea.KeyPressMsg) model {
	for _, k := range keys {
		m, _ = press(m, k)
	}
	return m
}

func runeKey(r rune) tea.KeyPressMsg {
	return tea.KeyPressMsg{Code: r, Text: string(r)}
}

func special(code rune) tea.KeyPressMsg {
	return tea.KeyPressMsg{Code: code}
}

func isQuit(cmd tea.Cmd) bool {
	if cmd == nil {
		return false
	}
	_, ok := cmd().(tea.QuitMsg)
	return ok
}

func isInterrupt(cmd tea.Cmd) bool {
	if cmd == nil {
		return false
	}
	_, ok := cmd().(tea.InterruptMsg)
	return ok
}

func viewText(m model) string {
	return strings.TrimSuffix(m.View().Content, "\n")
}

func TestSplitsCombinedReadsBeforeClassifying(t *testing.T) {
	// Rust splits a combined read ("j\r", CSI down/up) before classifying.
	// Bubble Tea delivers one KeyPressMsg per key; the sequence must match.
	m := newModel([]Item{
		{ID: "one", Label: "one", Category: "cloud"},
		{ID: "two", Label: "two", Category: "cloud"},
	}, Options{Title: "작업", Mode: ModeOne, Color: plain()})
	m, cmd := press(m, runeKey('j'))
	if cmd != nil || m.current != 1 {
		t.Fatalf("j should move down, current=%d cmd=%v", m.current, cmd)
	}
	m, cmd = press(m, special(tea.KeyEnter))
	if !isQuit(cmd) || !m.done || m.aborted {
		t.Fatalf("enter should accept, done=%v aborted=%v cmd quit=%v", m.done, m.aborted, isQuit(cmd))
	}
	if got := m.result(); got.Action != ActionAccept || len(got.Selected) != 1 || got.Selected[0] != "two" {
		t.Fatalf("result = %+v", got)
	}
}

func TestLeavesIncompleteEscapeForTheNextRead(t *testing.T) {
	// Incomplete escapes stay in select.rs's pending buffer. The framework
	// owns that parser; an empty key must not move or quit.
	m := three()
	next, cmd := press(m, tea.KeyPressMsg{})
	if cmd != nil || next.current != 0 || next.aborted || next.done {
		t.Fatalf("empty key changed state: %+v cmd=%v", next, cmd)
	}
}

func TestMapsCancelAndVimKeys(t *testing.T) {
	m := three()
	m = seq(m, runeKey('j'), runeKey('j'))
	if m.current != 2 {
		t.Fatalf("jj current=%d", m.current)
	}
	m, cmd := press(m, runeKey('k'))
	if cmd != nil || m.current != 1 {
		t.Fatalf("k current=%d", m.current)
	}
	m, _ = press(m, special(tea.KeyUp))
	if m.current != 0 {
		t.Fatalf("up current=%d", m.current)
	}
	m, _ = press(m, special(tea.KeyDown))
	if m.current != 1 {
		t.Fatalf("down current=%d", m.current)
	}
	m, _ = press(m, runeKey('G'))
	if m.current != 2 {
		t.Fatalf("G current=%d", m.current)
	}
	m, _ = press(m, runeKey('g'))
	if m.current != 0 {
		t.Fatalf("g current=%d", m.current)
	}
	m, _ = press(m, special(tea.KeyEnd))
	if m.current != 2 {
		t.Fatalf("end current=%d", m.current)
	}
	m, _ = press(m, special(tea.KeyHome))
	if m.current != 0 {
		t.Fatalf("home current=%d", m.current)
	}

	aborted, cmd := press(m, runeKey('q'))
	if !aborted.aborted || !isQuit(cmd) {
		t.Fatal("q should abort")
	}
	aborted, cmd = press(m, special(tea.KeyEscape))
	if !aborted.aborted || !isQuit(cmd) {
		t.Fatal("esc should abort")
	}
	aborted, cmd = press(m, tea.KeyPressMsg{Code: 'c', Text: "c", Mod: tea.ModCtrl})
	if !aborted.aborted || !isInterrupt(cmd) || aborted.action == ActionCheck {
		t.Fatalf("ctrl-c must interrupt, not check: action=%q quit=%v interrupt=%v", aborted.action, isQuit(cmd), isInterrupt(cmd))
	}
}

func TestMultiKeysMapToToggleAllNoneAndActions(t *testing.T) {
	m := three()
	m, cmd := press(m, special(tea.KeySpace))
	if cmd != nil || !m.checked[0] {
		t.Fatalf("space checked=%v", m.checked)
	}
	m, _ = press(m, runeKey('n'))
	if m.checked[0] || m.checked[1] || m.checked[2] {
		t.Fatalf("n checked=%v", m.checked)
	}
	m, _ = press(m, runeKey('a'))
	if !m.checked[0] || !m.checked[1] || !m.checked[2] {
		t.Fatalf("a checked=%v", m.checked)
	}
	m, _ = press(m, runeKey('n'))
	m, _ = press(m, special(tea.KeySpace))
	m, cmd = press(m, runeKey('i'))
	if !isQuit(cmd) || m.action != ActionInstall {
		t.Fatalf("i action=%q quit=%v", m.action, isQuit(cmd))
	}
	m = three()
	m, _ = press(m, special(tea.KeySpace))
	m, cmd = press(m, runeKey('x'))
	if m.action != ActionRemove || !isQuit(cmd) {
		t.Fatalf("x action=%q", m.action)
	}
	m = three()
	m, _ = press(m, special(tea.KeySpace))
	m, cmd = press(m, runeKey('d'))
	if m.action != ActionRemove {
		t.Fatalf("d should delete, action=%q", m.action)
	}
	m = three()
	m, _ = press(m, special(tea.KeySpace))
	m, _ = press(m, special(tea.KeyDelete))
	if m.action != ActionRemove {
		t.Fatalf("delete action=%q", m.action)
	}
	m = three()
	m, _ = press(m, special(tea.KeySpace))
	m, _ = press(m, runeKey('u'))
	if m.action != ActionUpdate {
		t.Fatalf("u action=%q", m.action)
	}
	m = three()
	m, _ = press(m, special(tea.KeySpace))
	m, _ = press(m, runeKey('c'))
	if m.action != ActionCheck {
		t.Fatalf("c action=%q", m.action)
	}
	m = three()
	m, _ = press(m, special(tea.KeySpace))
	m, cmd = press(m, special(tea.KeyEnter))
	if m.action != ActionMenu || !isQuit(cmd) {
		t.Fatalf("enter action=%q quit=%v", m.action, isQuit(cmd))
	}
	m = three()
	m, cmd = press(m, runeKey('z'))
	if cmd != nil || m.current != 0 || m.done || m.message != "" {
		t.Fatalf("z should be ignored: %+v", m)
	}
	m, cmd = press(m, special(tea.KeyDown))
	if m.current != 1 || cmd != nil {
		t.Fatalf("down current=%d", m.current)
	}
	m, _ = press(m, runeKey('k'))
	if m.current != 0 {
		t.Fatalf("k current=%d", m.current)
	}
	m, cmd = press(m, runeKey('q'))
	if !m.aborted || !isQuit(cmd) {
		t.Fatal("q should abort")
	}
}

func TestNothingIsSelectedAtFirstAndActionsNeedASelection(t *testing.T) {
	m := three()
	if len(m.selected()) != 0 {
		t.Fatalf("selected = %v", m.selected())
	}
	m, cmd := press(m, runeKey('i'))
	if cmd != nil || m.done || m.message != emptySelection {
		t.Fatalf("i without selection: msg=%q done=%v cmd=%v", m.message, m.done, cmd)
	}
	m, cmd = press(m, special(tea.KeyEnter))
	if cmd != nil || m.done || m.message != emptySelection {
		t.Fatalf("enter without selection: msg=%q", m.message)
	}
	m, _ = press(m, special(tea.KeyDown))
	if m.message != "" {
		t.Fatalf("move should clear message, got %q", m.message)
	}
	text := viewText(m)
	if strings.Contains(text, "[x]") {
		t.Fatalf("nothing should be checked:\n%s", text)
	}
}

func TestToggleAllNoneAndMoveWorkTogether(t *testing.T) {
	m := three()
	m = seq(m, special(tea.KeySpace), special(tea.KeyDown), special(tea.KeyDown), special(tea.KeyDown))
	if m.current != 2 {
		t.Fatalf("current=%d", m.current)
	}
	m, _ = press(m, special(tea.KeySpace))
	if got := m.selected(); strings.Join(got, ",") != "a,c" {
		t.Fatalf("selected=%v", got)
	}
	m, _ = press(m, special(tea.KeySpace))
	if got := m.selected(); strings.Join(got, ",") != "a" {
		t.Fatalf("selected=%v", got)
	}
	m, _ = press(m, runeKey('a'))
	if got := m.selected(); strings.Join(got, ",") != "a,b,c" {
		t.Fatalf("all=%v", got)
	}
	m, _ = press(m, runeKey('n'))
	if len(m.selected()) != 0 {
		t.Fatalf("none=%v", m.selected())
	}
	m = seq(m, runeKey('g'), runeKey('k'))
	if m.current != 0 {
		t.Fatalf("first+up current=%d", m.current)
	}
	m, _ = press(m, runeKey('G'))
	if m.current != 2 {
		t.Fatalf("last current=%d", m.current)
	}
}

func TestActionKeysReturnTheSelectionAndAbortReturnsNone(t *testing.T) {
	m := three()
	m = seq(m, special(tea.KeySpace), runeKey('G'), special(tea.KeySpace))
	m, cmd := press(m, runeKey('u'))
	if !isQuit(cmd) {
		t.Fatal("u should quit")
	}
	got := m.result()
	if got.Action != ActionUpdate || strings.Join(got.Selected, ",") != "a,c" {
		t.Fatalf("result=%+v", got)
	}
	m, cmd = press(m, special(tea.KeyEnter))
	if got = m.result(); got.Action != ActionMenu || strings.Join(got.Selected, ",") != "a,c" || !isQuit(cmd) {
		t.Fatalf("menu=%+v quit=%v", got, isQuit(cmd))
	}
	m, cmd = press(three(), runeKey('q'))
	if !m.aborted || !isQuit(cmd) || m.done {
		t.Fatal("abort should return none")
	}
}

func TestMultiRenderShowsCheckboxesCountsAndFooter(t *testing.T) {
	m := newModel(cloudItems(), Options{Title: "도구", Color: plain()})
	m, _ = press(m, special(tea.KeySpace))
	text := viewText(m)
	if !strings.Contains(text, "선택 1/2") {
		t.Fatalf("missing count:\n%s", text)
	}
	note := cloudItems()[0].Detail
	if lipgloss.Width(note) != 6 {
		t.Fatalf("note cell width = %d, want 6", lipgloss.Width(note))
	}
	if !strings.Contains(text, "> [x] aws  "+note) {
		t.Fatalf("missing checked row:\n%s", text)
	}
	if !strings.Contains(text, "[ ] cf") {
		t.Fatalf("missing unchecked row:\n%s", text)
	}
	if !strings.Contains(text, "cloud (2)") {
		t.Fatalf("missing category header:\n%s", text)
	}
	if !strings.Contains(text, hintMove) || !strings.Contains(text, hintAct) {
		t.Fatalf("missing footer hints:\n%s", text)
	}
	if m.View().AltScreen {
		t.Fatal("picker must stay inline; Rust select.rs does not use the alternate screen")
	}
	want := strings.Join([]string{
		"도구  선택 1/2",
		"",
		"cloud (2)",
		"  > [x] aws  " + note,
		"    [ ] cf",
		"",
		hintMove,
		hintAct,
	}, "\n")
	if text != want {
		t.Fatalf("view mismatch\n got:\n%s\nwant:\n%s", text, want)
	}
}

func TestCategoryHeadersAndOtherBucket(t *testing.T) {
	m := newModel([]Item{
		{ID: "sec", Label: "sec", Category: "security"},
		{ID: "misc", Label: "misc", Category: "custom"},
		{ID: "aws", Label: "aws", Category: "cloud"},
		{Label: "bare", Category: "payment"},
	}, Options{Title: "도구", Color: plain()})
	text := viewText(m)
	cloud := strings.Index(text, "cloud (1)")
	pay := strings.Index(text, "payment (1)")
	sec := strings.Index(text, "security (1)")
	other := strings.Index(text, "other (1)")
	if cloud < 0 || pay < 0 || sec < 0 || other < 0 || !(cloud < pay && pay < sec && sec < other) {
		t.Fatalf("category order:\n%s", text)
	}
	var bareID string
	for _, row := range m.rows {
		if row.label == "bare" {
			bareID = row.id
		}
	}
	if bareID != "bare" {
		t.Fatalf("empty id should fall back to label, got %q", bareID)
	}
}

func TestWindowSizeTruncatesHangulOnCellWidth(t *testing.T) {
	if lipgloss.Width("한") != 2 {
		t.Fatalf("hangul cell width = %d, want 2", lipgloss.Width("한"))
	}
	m := newModel([]Item{
		{ID: "h", Label: "한글이름", Category: "cloud"},
	}, Options{Title: "pick", Color: plain()})
	next, _ := m.Update(tea.WindowSizeMsg{Width: 10, Height: 24})
	m = next.(model)
	if m.width != 10 || m.height != 24 {
		t.Fatalf("size not stored: %d x %d", m.width, m.height)
	}
	text := viewText(m)
	if !strings.Contains(text, "cloud (1)") || !strings.Contains(text, "[ ]") {
		t.Fatalf("narrow view lost structure:\n%s", text)
	}
	label := "한글이름"
	if lipgloss.Width(label) != 8 {
		t.Fatalf("label cell width = %d, want 8", lipgloss.Width(label))
	}
	const itemPrefix = "  > [ ] "
	var rest string
	var found bool
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, itemPrefix) {
			rest = strings.TrimPrefix(line, itemPrefix)
			found = true
		}
	}
	// Width 10 leaves 2 cells after the ASCII prefix: one syllable, not two.
	if !found || lipgloss.Width(rest) != 2 || lipgloss.Width(itemPrefix)+lipgloss.Width(rest) != 10 {
		t.Fatalf("truncated label width = %d, want 2:\n%s", lipgloss.Width(rest), text)
	}
	for _, line := range strings.Split(text, "\n") {
		if w := lipgloss.Width(line); w > 10 {
			t.Fatalf("line width %d > 10: %q", w, line)
		}
	}
	narrow, _ := m.Update(tea.WindowSizeMsg{Width: 40, Height: 4})
	m = narrow.(model)
	narrowText := viewText(m)
	if strings.Contains(narrowText, hintMove) {
		t.Fatalf("width < 60 should use the short footer:\n%s", narrowText)
	}
	if !strings.Contains(narrowText, hintMoveNarrow) {
		t.Fatalf("missing narrow hint:\n%s", narrowText)
	}
	lines := strings.Split(strings.TrimSuffix(m.View().Content, "\n"), "\n")
	if len(lines) != 4 {
		t.Fatalf("height window = %d lines, want 4:\n%s", len(lines), narrowText)
	}
}

func TestNOColorSuppressesANSI(t *testing.T) {
	prev := stderrIsTerminal
	t.Cleanup(func() { stderrIsTerminal = prev })
	stderrIsTerminal = func() bool { return true }
	t.Setenv("NO_COLOR", "")
	if colorsEnabled(nil) {
		t.Fatal("NO_COLOR must disable color even when empty")
	}
	os.Unsetenv("NO_COLOR")
	if !colorsEnabled(nil) {
		t.Fatal("color should be on when stderr is a terminal and NO_COLOR is unset")
	}
	m := newModel(cloudItems(), Options{Title: "도구", Color: colored()})
	if !strings.Contains(m.View().Content, "\x1b[") {
		t.Fatalf("forced color should emit ANSI:\n%s", m.View().Content)
	}
	m = newModel(cloudItems(), Options{Title: "도구", Color: plain()})
	if strings.Contains(m.View().Content, "\x1b[") {
		t.Fatal("plain view must not contain ANSI")
	}
}

func TestAltChordIsIgnored(t *testing.T) {
	m := three()
	next, cmd := press(m, tea.KeyPressMsg{Code: 'j', Text: "j", Mod: tea.ModAlt})
	if cmd != nil || next.current != 0 || next.checked[0] {
		t.Fatalf("alt+j must not move or toggle: current=%d checked=%v", next.current, next.checked)
	}
}

func TestModeOneFooterAndAbort(t *testing.T) {
	m := newModel([]Item{
		{ID: "설치", Label: "설치", Category: "payment"},
		{ID: "삭제", Label: "삭제", Category: "payment"},
	}, Options{Title: "작업", Mode: ModeOne, Color: plain()})
	text := viewText(m)
	if !strings.Contains(text, "> "+m.rows[0].label) || strings.Contains(text, "[ ]") || strings.Contains(text, "[x]") {
		t.Fatalf("single select should not draw checkboxes:\n%s", text)
	}
	if !strings.Contains(text, hintOne) {
		t.Fatalf("missing single footer:\n%s", text)
	}
	m, cmd := press(m, runeKey('q'))
	if !m.aborted || !isQuit(cmd) {
		t.Fatal("q should abort the action menu")
	}
}

func TestRunEmptyAndNotTTY(t *testing.T) {
	if _, err := Run(nil, Options{}); !errors.Is(err, ErrEmpty) {
		t.Fatalf("empty: %v", err)
	}
	prevIn, prevErr := stdinIsTerminal, stderrIsTerminal
	t.Cleanup(func() {
		stdinIsTerminal = prevIn
		stderrIsTerminal = prevErr
	})
	stdinIsTerminal = func() bool { return false }
	stderrIsTerminal = func() bool { return true }
	if _, err := Run(cloudItems(), Options{}); !errors.Is(err, ErrNotTTY) {
		t.Fatalf("stdin: %v", err)
	}
	stdinIsTerminal = func() bool { return true }
	stderrIsTerminal = func() bool { return false }
	if _, err := Run(cloudItems(), Options{}); !errors.Is(err, ErrNotTTY) {
		t.Fatalf("stderr: %v", err)
	}
}

func TestLineFeedAcceptsLikeRustNewline(t *testing.T) {
	// select.rs classify_token maps '\n' to Accept. Bubble Tea delivers that byte as ctrl+j.
	one := newModel([]Item{
		{ID: "one", Label: "one", Category: "cloud"},
		{ID: "two", Label: "two", Category: "cloud"},
	}, Options{Title: "작업", Mode: ModeOne, Color: plain()})
	next, cmd := press(one, tea.KeyPressMsg{Code: 'j', Mod: tea.ModCtrl})
	if !isQuit(cmd) || !next.done || next.current != 0 || next.result().Selected[0] != "one" {
		t.Fatalf("ctrl+j should accept the current row, not move: %+v", next)
	}
	next, cmd = press(one, tea.KeyPressMsg{Text: "\n"})
	if !isQuit(cmd) || next.result().Action != ActionAccept {
		t.Fatalf("bare LF should accept: action=%q quit=%v", next.result().Action, isQuit(cmd))
	}

	multi := three()
	multi, _ = press(multi, special(tea.KeySpace))
	multi, cmd = press(multi, tea.KeyPressMsg{Code: 'j', Mod: tea.ModCtrl})
	if !isQuit(cmd) || multi.action != ActionMenu || multi.current != 0 {
		t.Fatalf("ctrl+j in multi should open the menu: action=%q current=%d", multi.action, multi.current)
	}
}

func TestModeOneLinesMatchRustRender(t *testing.T) {
	m := newModel([]Item{
		{ID: "alpha", Label: "alpha", Category: "cloud", Detail: "note"},
		{ID: "beta", Label: "beta", Category: "payment"},
	}, Options{Title: "pick", Mode: ModeOne, Color: plain()})
	want := strings.Join([]string{
		"pick",
		"",
		"cloud (1)",
		"  > alpha  note",
		"",
		"payment (1)",
		"    beta",
		hintOne,
	}, "\n")
	if got := viewText(m); got != want {
		t.Fatalf("select_one frame mismatch\n got:\n%s\nwant:\n%s", got, want)
	}
	if m.View().AltScreen {
		t.Fatal("select_one must stay inline")
	}
}

func catalog() []Item {
	return []Item{
		{ID: "litestream", Label: "litestream", Category: "database", Detail: "미설치"},
		{ID: "aws", Label: "aws", Category: "cloud", Detail: "미설치"},
		{ID: "ovhcloud", Label: "ovhcloud", Category: "cloud", Detail: "미설치"},
		{ID: "gcloud", Label: "gcloud", Category: "cloud", Detail: "미설치"},
		{ID: "oauth2l", Label: "oauth2l", Category: "cloud", Detail: "미설치"},
		{ID: "cf", Label: "cf", Category: "cloud", Detail: "미설치"},
		{ID: "creem", Label: "creem", Category: "payment", Detail: "미설치"},
		{ID: "ant", Label: "ant", Category: "ai", Detail: "미설치"},
		{ID: "xurl", Label: "xurl", Category: "social", Detail: "미설치"},
		{ID: "goat", Label: "goat", Category: "social", Detail: "미설치"},
		{ID: "osv-scanner", Label: "osv-scanner", Category: "security", Detail: "미설치"},
	}
}

func TestSizedViewKeepsChromeInsideTheTerminal(t *testing.T) {
	items := catalog()
	sizes := []tea.WindowSizeMsg{
		{Width: 80, Height: 24},
		{Width: 60, Height: 20},
		{Width: 40, Height: 10},
		{Width: 120, Height: 40},
	}
	for _, sz := range sizes {
		m := newModel(items, Options{Title: "도구", Color: plain()})
		next, cmd := m.Update(sz)
		if cmd != nil {
			t.Fatalf("%dx%d resize cmd = %v", sz.Width, sz.Height, cmd)
		}
		m = next.(model)
		assertChrome(t, m, sz.Width, sz.Height, len(items))
		m = seq(m, runeKey('G'))
		text := m.View().Content
		if !strings.Contains(text, "security") || !strings.Contains(text, "osv-scanner") || !strings.Contains(text, ">") {
			t.Fatalf("%dx%d end cursor left the window:\n%s", sz.Width, sz.Height, text)
		}
		assertChrome(t, m, sz.Width, sz.Height, len(items))
	}
}

func assertChrome(t *testing.T, m model, width, height, n int) {
	t.Helper()
	raw := m.View().Content
	// Split length matches bubbletea Height (Count('\n')+1). A trailing newline is an extra line.
	lines := strings.Split(raw, "\n")
	if len(lines) > height {
		t.Fatalf("%dx%d view lines %d > height %d:\n%s", width, height, len(lines), height, raw)
	}
	if len(lines) == 0 || lines[0] == "" || strings.TrimSpace(lines[0]) == "" {
		t.Fatalf("%dx%d first line empty:\n%q", width, height, raw)
	}
	if !strings.Contains(lines[0], "도구") || !strings.Contains(raw, "선택 ") || !strings.Contains(raw, "/"+itoa(n)) {
		t.Fatalf("%dx%d missing title or selection count:\n%s", width, height, raw)
	}
	for i, line := range lines {
		if w := lipgloss.Width(line); w > width {
			t.Fatalf("%dx%d line %d display width %d > %d: %q", width, height, i, w, width, line)
		}
	}
	if width >= narrowWidth {
		if !strings.Contains(raw, "끝") || !strings.Contains(raw, "q 취소") {
			t.Fatalf("%dx%d footer key hints truncated:\n%s", width, height, raw)
		}
	} else if !strings.Contains(raw, hintMoveNarrow) || !strings.Contains(raw, hintActNarrow) {
		t.Fatalf("%dx%d narrow footer missing:\n%s", width, height, raw)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [8]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func TestWorkMenuSectionUsesToolName(t *testing.T) {
	const section = "aws — 작업"
	m := newModel([]Item{
		{ID: "0", Label: "설치", Category: section},
		{ID: "1", Label: "삭제", Category: section},
		{ID: "2", Label: "업데이트 확인", Category: section},
		{ID: "3", Label: "업데이트", Category: section},
	}, Options{Title: "작업", Mode: ModeOne, Color: plain()})
	text := viewText(m)
	if strings.Contains(text, "other (") {
		t.Fatalf("work menu section must not be the other bucket:\n%s", text)
	}
	if !strings.Contains(text, section) || !strings.HasPrefix(text, "작업\n") {
		t.Fatalf("work menu title mismatch:\n%s", text)
	}
}

func TestHangulLabelKeepsCheckboxColumn(t *testing.T) {
	if lipgloss.Width("한") != 2 {
		t.Fatalf("hangul cell width = %d, want 2", lipgloss.Width("한"))
	}
	label := "한글이름"
	if lipgloss.Width(label) != 8 {
		t.Fatalf("label cell width = %d, want 8", lipgloss.Width(label))
	}
	items := []Item{
		{ID: "aws", Label: "aws", Category: "cloud"},
		{ID: "h", Label: label, Category: "cloud"},
	}
	for _, color := range []*bool{plain(), colored()} {
		m := newModel(items, Options{Title: "tools", Color: color})
		text := m.View().Content
		var cols []int
		for _, line := range strings.Split(text, "\n") {
			mark := strings.Index(line, "[ ]")
			if mark < 0 {
				continue
			}
			cols = append(cols, lipgloss.Width(line[:mark]))
			aws := strings.Index(line, "aws")
			hangul := strings.Index(line, label)
			if aws >= 0 && lipgloss.Width(line[:aws]) != 8 {
				t.Fatalf("ascii label column = %d, want 8: %q", lipgloss.Width(line[:aws]), line)
			}
			if hangul >= 0 && lipgloss.Width(line[:hangul]) != 8 {
				t.Fatalf("hangul label column = %d, want 8: %q", lipgloss.Width(line[:hangul]), line)
			}
		}
		if len(cols) != 2 || cols[0] != cols[1] || cols[0] != 4 {
			t.Fatalf("checkbox columns = %v, want [4 4]\n%s", cols, text)
		}
	}
}
