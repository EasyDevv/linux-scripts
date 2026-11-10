package ui

import (
	"strings"
	"unicode/utf8"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

const narrowWidth = 60

// hints reads the key catalog: footer copy is `기능 : 키`, pipe-separated.
func hints(narrow bool) (string, string) {
	move := "이동 : " + keys.move + " | 첫/끝 : " + keys.reach
	if narrow {
		move = "이동 : " + keys.move + " | " + keys.reach
	}
	return move, "실행 : " + keys.accept + " | 취소 : " + keys.abort
}

// View draws inline. AltScreen stays false and Run writes to stderr,
// so the list scrolls away once the script takes the terminal.
func (m model) View() tea.View {
	lines, cursor, header, footer := m.renderLines()
	lines = fit(lines, cursor, m.width, m.height, header, footer)
	return tea.NewView(strings.Join(lines, "\n"))
}

func (m model) renderLines() (lines []string, cursor, header, footer int) {
	lines = append(lines, joinPieces(m.width, m.color,
		piece{"pk", true, false, "6"},
		piece{"  " + m.title, true, false, ""},
	))
	if m.subtitle != "" {
		lines = append(lines, paint(m.subtitle, false, true, "", m.color))
	}
	lines = append(lines, "")
	cursor = 1
	for si, sec := range m.sections {
		if si > 0 {
			lines = append(lines, "")
		}
		if sec.title != "" {
			lines = append(lines, paint(sec.title, true, true, "", m.color))
		}
		for i := sec.from; i < sec.to; i++ {
			if i == m.current {
				cursor = len(lines)
			}
			lines = append(lines, m.itemLine(i))
		}
	}
	footerAt := len(lines)
	move, act := hints(m.width > 0 && m.width < narrowWidth)
	for _, hint := range wrapCells(move, m.width) {
		lines = append(lines, paint(hint, false, true, "", m.color))
	}
	for _, hint := range wrapCells(act, m.width) {
		lines = append(lines, paint(hint, false, true, "", m.color))
	}
	return lines, cursor, 1, len(lines) - footerAt
}

func (m model) itemLine(i int) string {
	row := m.rows[i]
	here := i == m.current
	marker := " "
	if here {
		marker = ">"
	}
	parts := []piece{
		{"  ", false, false, ""},
		{marker, true, false, "6"},
		{" ", false, false, ""},
		{row.Label, here, false, ""},
	}
	if row.Detail != "" {
		parts = append(parts, piece{"  " + row.Detail, false, true, ""})
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
	for _, p := range parts {
		text := p.text
		if width > 0 {
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

// takeCells truncates s to max display cells without splitting a wide glyph.
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

// fit truncates to width and windows the body when the terminal is shorter
// than the list. Header and footer stay visible.
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

// wrapCells breaks s on spaces so every returned line fits width cells.
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
