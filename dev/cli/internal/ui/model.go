package ui

import (
	"fmt"
	"strings"
	"unicode/utf8"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

const (
	hintMove       = "↑/↓ j/k 이동  space 선택  a 전체선택  n 전체해제  g/G 처음/끝"
	hintAct        = "i 설치  x 삭제  u 업데이트  c 업데이트 확인  enter 작업 메뉴  q 취소"
	hintMoveNarrow = "j/k space a/n g/G"
	hintActNarrow  = "i/x/u/c enter q"
	hintOne        = "↑/↓ move  enter select  q abort"
	hintOneNarrow  = "j/k enter q"
	emptySelection = "선택된 항목이 없습니다 — space 로 선택하세요"
	narrowWidth    = 60
)

var categoryOrder = []string{"cloud", "payment", "database", "ai", "social", "security"}

type row struct {
	id       string
	label    string
	detail   string
	category string
	color    string // ANSI color number; empty means dim (other)
}

type section struct {
	title string
	color string
	from  int
	to    int
}

type model struct {
	title   string
	mode    Mode
	rows    []row
	sects   []section
	current int
	checked []bool
	message string
	width   int
	height  int
	color   bool
	done    bool
	aborted bool
	action  string
}

func newModel(items []Item, opts Options) model {
	input := make([]row, 0, len(items))
	for _, it := range items {
		id := it.ID
		if id == "" {
			id = it.Label
		}
		cat := groupKey(it.Category, opts.Mode)
		input = append(input, row{
			id:       id,
			label:    it.Label,
			detail:   it.Detail,
			category: cat,
			color:    categoryColor(cat),
		})
	}
	rows, sects := arrange(input)
	return model{
		title:   opts.Title,
		mode:    opts.Mode,
		rows:    rows,
		sects:   sects,
		checked: make([]bool, len(rows)),
		color:   colorsEnabled(opts.Color),
	}
}

func categoryOf(category string) string {
	for _, known := range categoryOrder {
		if category == known {
			return category
		}
	}
	return "other"
}

// customSectionTitle is a ModeOne section label such as "aws — 작업".
// Known categories and the other bucket keep the "name (n)" header.
func customSectionTitle(category string) bool {
	if category == "" || category == "other" {
		return false
	}
	return categoryOf(category) == "other"
}

func groupKey(category string, mode Mode) string {
	if mode == ModeOne && customSectionTitle(category) {
		return category
	}
	return categoryOf(category)
}

func categoryColor(category string) string {
	switch category {
	case "cloud":
		return "6"
	case "payment":
		return "3"
	case "database":
		return "2"
	case "ai":
		return "5"
	case "social":
		return "4"
	case "security":
		return "1"
	default:
		return ""
	}
}

// arrange groups rows into the fixed category order. Indexes in the
// returned sections refer to the returned slice, not the input order.
func arrange(input []row) ([]row, []section) {
	buckets := map[string][]row{}
	for _, row := range input {
		buckets[row.category] = append(buckets[row.category], row)
	}
	var custom []string
	seenCustom := map[string]bool{}
	for _, row := range input {
		if customSectionTitle(row.category) && !seenCustom[row.category] {
			seenCustom[row.category] = true
			custom = append(custom, row.category)
		}
	}
	order := append(append(append([]string{}, categoryOrder...), custom...), "other")
	rows := make([]row, 0, len(input))
	var sects []section
	for _, cat := range order {
		bucket := buckets[cat]
		if len(bucket) == 0 {
			continue
		}
		from := len(rows)
		rows = append(rows, bucket...)
		title := fmt.Sprintf("%s (%d)", cat, len(bucket))
		if customSectionTitle(cat) {
			title = cat
		}
		sects = append(sects, section{
			title: title,
			color: categoryColor(cat),
			from:  from,
			to:    len(rows),
		})
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
	// Ctrl-C cancels. Other ctrl chords are not product keys, except LF:
	// a raw '\n' arrives as ctrl+j, and select.rs maps that byte to Accept/Menu.
	if k.Mod.Contains(tea.ModCtrl) && !isLineFeed(k) {
		if k.Code == 'c' || k.Keystroke() == "ctrl+c" {
			m.aborted = true
			return m, tea.Interrupt
		}
		return m, nil
	}
	act := classify(k, m.mode)
	if act != actIgnore {
		m.message = ""
	}
	switch act {
	case actUp:
		if m.current > 0 {
			m.current--
		}
	case actDown:
		if n := len(m.rows); n > 0 && m.current < n-1 {
			m.current++
		}
	case actFirst:
		m.current = 0
	case actLast:
		if n := len(m.rows); n > 0 {
			m.current = n - 1
		}
	case actToggle:
		if m.current >= 0 && m.current < len(m.checked) {
			m.checked[m.current] = !m.checked[m.current]
		}
	case actAll:
		for i := range m.checked {
			m.checked[i] = true
		}
	case actNone:
		for i := range m.checked {
			m.checked[i] = false
		}
	case actDo:
		return m.finish(actionChar(k))
	case actMenu:
		if m.mode == ModeOne {
			m.done = true
			m.action = ActionAccept
			return m, tea.Quit
		}
		return m.finish(ActionMenu)
	case actAbort:
		m.aborted = true
		return m, tea.Quit
	}
	return m, nil
}

func actionChar(k tea.KeyPressMsg) string {
	switch k.String() {
	case "x", "d", "delete":
		return ActionRemove
	case "i":
		return ActionInstall
	case "u":
		return ActionUpdate
	case "c":
		return ActionCheck
	default:
		if k.Code == tea.KeyDelete || k.Code == tea.KeyKpDelete {
			return ActionRemove
		}
		return ActionMenu
	}
}

func (m model) finish(action string) (tea.Model, tea.Cmd) {
	if len(m.selected()) == 0 {
		m.message = emptySelection
		return m, nil
	}
	m.done = true
	m.action = action
	return m, tea.Quit
}

func (m model) selected() []string {
	if m.mode == ModeOne {
		if len(m.rows) == 0 {
			return nil
		}
		return []string{m.rows[m.current].id}
	}
	var ids []string
	for i, on := range m.checked {
		if on {
			ids = append(ids, m.rows[i].id)
		}
	}
	return ids
}

func (m model) result() Result {
	ids := m.selected()
	if m.mode == ModeOne {
		return Result{Selected: ids, Action: ActionAccept}
	}
	return Result{Selected: ids, Action: m.action}
}

type act int

const (
	actIgnore act = iota
	actUp
	actDown
	actFirst
	actLast
	actToggle
	actAll
	actNone
	actDo
	actMenu
	actAbort
)

func classify(k tea.KeyPressMsg, mode Mode) act {
	name := k.String()
	if k.Text == "\r" || k.Text == "\n" || k.Code == tea.KeyEnter || k.Code == tea.KeyKpEnter || name == "enter" || isLineFeed(k) {
		return actMenu
	}
	switch name {
	case "q", "esc":
		return actAbort
	case "up", "k":
		return actUp
	case "down", "j":
		return actDown
	case "g", "home":
		return actFirst
	case "G", "end":
		return actLast
	}
	switch k.Code {
	case tea.KeyEscape: // KeyEsc is the same rune; a second case does not compile
		return actAbort
	case tea.KeyUp, tea.KeyKpUp:
		return actUp
	case tea.KeyDown, tea.KeyKpDown:
		return actDown
	case tea.KeyHome, tea.KeyKpHome:
		return actFirst
	case tea.KeyEnd, tea.KeyKpEnd:
		return actLast
	}
	if mode == ModeOne {
		return actIgnore
	}
	switch name {
	case "space":
		return actToggle
	case "a":
		return actAll
	case "n":
		return actNone
	case "i", "x", "d", "u", "c", "delete":
		return actDo
	}
	if k.Code == tea.KeySpace || k.Code == ' ' {
		return actToggle
	}
	if k.Code == tea.KeyDelete || k.Code == tea.KeyKpDelete {
		return actDo
	}
	return actIgnore
}

func (m model) View() tea.View {
	// Inline, like select.rs. Do not set AltScreen.
	// Do not append a trailing newline: bubbletea counts one row per '\n'
	// plus one, and inline mode drops rows from the top when that exceeds
	// the terminal. The dropped row is the title, so row 0 becomes the blank
	// line under it and the last category falls off the bottom.
	lines, cursor, header, footer := m.renderLines()
	lines = fit(lines, cursor, m.width, m.height, header, footer)
	return tea.NewView(strings.Join(lines, "\n"))
}

func (m model) renderLines() (lines []string, cursor, header, footer int) {
	count := 0
	for _, on := range m.checked {
		if on {
			count++
		}
	}
	if m.mode == ModeOne {
		lines = append(lines, paint(m.title, true, false, "", m.color))
	} else {
		lines = append(lines, joinPieces(m.width, m.color,
			piece{m.title, true, false, ""},
			piece{"  ", false, false, ""},
			piece{fmt.Sprintf("선택 %d/%d", count, len(m.rows)), false, true, ""},
		))
	}
	lines = append(lines, "")
	cursor = 0
	for si, sec := range m.sects {
		if si > 0 {
			lines = append(lines, "")
		}
		faint := sec.color == ""
		lines = append(lines, paint(sec.title, true, faint, sec.color, m.color))
		for i := sec.from; i < sec.to; i++ {
			if i == m.current {
				cursor = len(lines)
			}
			lines = append(lines, m.itemLine(i))
		}
	}
	// select_many leaves a blank line before the hints. select_one does not.
	// That blank scrolls with the list. The message and hints stay pinned.
	if m.mode == ModeMulti {
		lines = append(lines, "")
	}
	footerAt := len(lines)
	if m.message != "" {
		lines = append(lines, paint(m.message, false, false, "3", m.color))
	}
	move, actHint := m.hints()
	for _, hint := range wrapCells(move, m.width) {
		lines = append(lines, paint(hint, false, true, "", m.color))
	}
	for _, hint := range wrapCells(actHint, m.width) {
		lines = append(lines, paint(hint, false, true, "", m.color))
	}
	return lines, cursor, 1, len(lines) - footerAt
}

// isLineFeed reports the LF byte. Bubble Tea's legacy table encodes it as ctrl+j.
func isLineFeed(k tea.KeyPressMsg) bool {
	if k.Text == "\n" || k.Keystroke() == "ctrl+j" {
		return true
	}
	return k.Mod.Contains(tea.ModCtrl) && k.Code == 'j'
}

func (m model) hints() (string, string) {
	narrow := m.width > 0 && m.width < narrowWidth
	if m.mode == ModeOne {
		if narrow {
			return hintOneNarrow, ""
		}
		return hintOne, ""
	}
	if narrow {
		return hintMoveNarrow, hintActNarrow
	}
	return hintMove, hintAct
}

func (m model) itemLine(i int) string {
	row := m.rows[i]
	here := i == m.current
	marker := " "
	if here {
		marker = ">"
	}
	labelBold := here
	labelFaint := row.color == "" && !here
	if row.color == "" && here {
		labelFaint = true
	}
	parts := []piece{
		{"  ", false, false, ""},
		{marker, labelBold, labelFaint, row.color},
		{" ", false, false, ""},
	}
	if m.mode == ModeMulti {
		if m.checked[i] {
			parts = append(parts, piece{"[x]", true, false, "2"})
		} else {
			parts = append(parts, piece{"[ ]", false, true, ""})
		}
		parts = append(parts, piece{" ", false, false, ""})
	}
	parts = append(parts, piece{row.label, labelBold, labelFaint, row.color})
	if row.detail != "" {
		parts = append(parts, piece{"  " + row.detail, false, true, ""})
	}
	return joinPieces(m.width, m.color, parts...)
}

type piece struct {
	text  string
	bold  bool
	faint bool
	color string
}

func joinPieces(width int, colorOn bool, parts ...piece) string {
	var b strings.Builder
	used := 0
	limit := width > 0
	for _, p := range parts {
		text := p.text
		if limit {
			room := width - used
			if room <= 0 {
				break
			}
			text = takeCells(text, room)
		}
		if text == "" {
			continue
		}
		b.WriteString(paint(text, p.bold, p.faint, p.color, colorOn))
		used += lipgloss.Width(text)
	}
	return b.String()
}

func paint(text string, bold, faint bool, color string, on bool) string {
	if text == "" || !on {
		return text
	}
	st := lipgloss.NewStyle()
	if bold {
		st = st.Bold(true)
	}
	if faint {
		st = st.Faint(true)
	}
	if color != "" {
		st = st.Foreground(lipgloss.Color(color))
	}
	return st.Render(text)
}

func takeCells(s string, max int) string {
	if max <= 0 {
		return ""
	}
	if lipgloss.Width(s) <= max {
		return s
	}
	var b strings.Builder
	used := 0
	for _, r := range s {
		w := lipgloss.Width(string(r))
		if used+w > max {
			break
		}
		b.WriteRune(r)
		used += w
	}
	return b.String()
}

func fit(lines []string, cursor, width, height, header, footer int) []string {
	if width > 0 {
		for i, line := range lines {
			if lipgloss.Width(line) > width {
				lines[i] = takeCells(stripANSI(line), width)
			}
		}
	}
	if height <= 0 || len(lines) <= height {
		return lines
	}
	if header < 0 {
		header = 0
	}
	if footer < 0 {
		footer = 0
	}
	if header > len(lines) {
		header = len(lines)
	}
	if header+footer > len(lines) {
		footer = len(lines) - header
	}
	room := height - header - footer
	if room < 1 {
		// Title and key hints win over the list when the terminal is tiny.
		if footer >= height {
			return append([]string{}, lines[len(lines)-height:]...)
		}
		headN := height - footer
		if headN > header {
			headN = header
		}
		out := append([]string{}, lines[:headN]...)
		return append(out, lines[len(lines)-footer:]...)
	}
	head := append([]string{}, lines[:header]...)
	body := lines[header : len(lines)-footer]
	tail := append([]string{}, lines[len(lines)-footer:]...)
	shown := window(body, cursor-header, room)
	out := make([]string, 0, len(head)+len(shown)+len(tail))
	out = append(out, head...)
	out = append(out, shown...)
	return append(out, tail...)
}

// wrapCells breaks s on spaces so every returned line's cell width is <= width.
// width <= 0 leaves s intact (the terminal size is not known yet).
func wrapCells(s string, width int) []string {
	if s == "" {
		return nil
	}
	if width <= 0 || lipgloss.Width(s) <= width {
		return []string{s}
	}
	var lines []string
	rest := s
	for rest != "" {
		if lipgloss.Width(rest) <= width {
			lines = append(lines, rest)
			break
		}
		cut := takeCells(rest, width)
		consumed := len(cut)
		if cut == "" {
			_, size := utf8.DecodeRuneInString(rest)
			if size <= 0 {
				break
			}
			lines = append(lines, rest[:size])
			rest = rest[size:]
			continue
		}
		if sp := strings.LastIndexByte(cut, ' '); sp > 0 {
			consumed = sp + 1
			cut = strings.TrimRight(cut[:sp], " ")
			for consumed < len(rest) && rest[consumed] == ' ' {
				consumed++
			}
			if cut == "" {
				cut = takeCells(rest, width)
				consumed = len(cut)
			}
		}
		lines = append(lines, cut)
		rest = rest[consumed:]
	}
	return lines
}

func window(lines []string, cursor, height int) []string {
	if height <= 0 || len(lines) <= height {
		return lines
	}
	if cursor < 0 {
		cursor = 0
	}
	if cursor >= len(lines) {
		cursor = len(lines) - 1
	}
	start := cursor - height/2
	if start < 0 {
		start = 0
	}
	if start+height > len(lines) {
		start = len(lines) - height
	}
	if cursor < start {
		start = cursor
	}
	if cursor >= start+height {
		start = cursor - height + 1
	}
	if start < 0 {
		start = 0
	}
	return lines[start : start+height]
}

func stripANSI(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == 0x1b {
			j := i + 1
			if j < len(s) && s[j] == '[' {
				j++
				for j < len(s) && !(s[j] >= 0x40 && s[j] <= 0x7e) {
					j++
				}
				if j < len(s) {
					j++
				}
				i = j - 1
				continue
			}
		}
		b.WriteByte(s[i])
	}
	return b.String()
}
