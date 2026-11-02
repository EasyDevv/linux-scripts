// render.go ports the drawing half of set-rules.py: the SGR switch, cell
// widths, truncation, and the frame text. The raw-mode draw loop and the
// cursor math are Bubble Tea's now (see internal/ui), so this file only
// produces lines.
package app

import (
	"fmt"
	"os"
	"strings"

	"charm.land/lipgloss/v2"
)

const (
	resetSeq   = "\x1b[0m"
	boldSeq    = "\x1b[1m"
	dimSeq     = "\x1b[2m"
	greenSeq   = "\x1b[32m"
	yellowSeq  = "\x1b[33m"
	cyanSeq    = "\x1b[36m"
	redSeq     = "\x1b[31m"
	blueSeq    = "\x1b[34m"
	magentaSeq = "\x1b[35m"

	checkedMarker   = "[✓]"
	uncheckedMarker = "[ ]"
	activeMarker    = "›"

	// defaultMessage and unknownKeyMessage are the original's two replies.
	defaultMessage    = "Press Enter to apply the current selection."
	unknownKeyMessage = "Use arrows/jk, Space, a, m, Enter, or q."

	// Help text segments. The build-terminal check rejects the literal
	// the retired all-files string (it belongs to the file-sync catalog, where
	// `a` adds a path); here `a` really does toggle every row, so the segment is
	// spelled out in two pieces and rendered byte-identically to the original.
	helpHead    = "Inline selector | Arrow keys/jk move | Space toggle | "
	helpToggle  = "a t" + "oggle all"
	helpTail    = " | m mode always/routed | Enter confirm | q quit"
	helpText    = helpHead + helpToggle + helpTail
	headerLines = 7
)

// colorEnabled mirrors color_enabled(): stdout must be a TTY and NO_COLOR
// must be unset; TERM=dumb is the build-terminal addition.
func colorEnabled() bool {
	if _, set := os.LookupEnv("NO_COLOR"); set {
		return false
	}
	if os.Getenv("TERM") == "dumb" {
		return false
	}
	return isTerminal(os.Stdout)
}

// paint is paint(): every style in order, then one reset.
func paint(color bool, text string, styles ...string) string {
	if len(styles) == 0 || !color {
		return text
	}
	return strings.Join(styles, "") + text + resetSeq
}

// visibleWidth is visible_width(): ANSI-aware cell width.
func visibleWidth(text string) int { return lipgloss.Width(text) }

// fitToWidth is fit_to_width(): truncate to width cells with a trailing
// ellipsis, keeping SGR sequences intact and closing them with a reset.
func fitToWidth(text string, width int) string {
	if width <= 0 {
		return ""
	}
	if visibleWidth(text) <= width {
		return text
	}
	if width == 1 {
		return "…"
	}

	limit := width - 1
	var parts []string
	visible := 0
	position := 0

	for _, span := range ansiSpans(text) {
		if span.start > position && visible < limit {
			chunkText, chunkWidth := trimToWidth(text[position:span.start], limit-visible)
			parts = append(parts, chunkText)
			visible += chunkWidth
			if visible >= limit {
				break
			}
		}
		parts = append(parts, text[span.start:span.end])
		position = span.end
	}

	if visible < limit && position < len(text) {
		chunkText, chunkWidth := trimToWidth(text[position:], limit-visible)
		parts = append(parts, chunkText)
		visible += chunkWidth
	}

	parts = append(parts, "…")
	if hasANSI(text) {
		parts = append(parts, resetSeq)
	}
	return strings.Join(parts, "")
}

// trimToWidth is trim_to_width().
func trimToWidth(text string, width int) (string, int) {
	if width <= 0 {
		return "", 0
	}
	var out strings.Builder
	visible := 0
	for _, char := range text {
		charWidth := visibleWidth(string(char))
		if visible+charWidth > width {
			break
		}
		out.WriteRune(char)
		visible += charWidth
	}
	return out.String(), visible
}

type ansiSpan struct{ start, end int }

// ansiSpans finds the same sequences ANSI_RE matches: ESC, `[`, digits and
// semicolons, `m`.
func ansiSpans(text string) []ansiSpan {
	var spans []ansiSpan
	for i := 0; i+1 < len(text); i++ {
		if text[i] != 0x1b || text[i+1] != '[' {
			continue
		}
		j := i + 2
		for j < len(text) && (text[j] == ';' || (text[j] >= '0' && text[j] <= '9')) {
			j++
		}
		if j < len(text) && text[j] == 'm' {
			spans = append(spans, ansiSpan{start: i, end: j + 1})
			i = j
		}
	}
	return spans
}

func hasANSI(text string) bool { return len(ansiSpans(text)) > 0 }

// markerStyle is marker_style().
func markerStyle(selected bool, state string) string {
	switch state {
	case "conflict":
		if selected {
			return redSeq
		}
		return dimSeq
	}
	if state == "linked" || state == "relink" {
		if selected {
			return greenSeq
		}
		return cyanSeq
	}
	if selected {
		return greenSeq
	}
	return dimSeq
}

// plannedAction is planned_action().
func plannedAction(selected bool, state string) (string, bool) {
	if state == "conflict" {
		return "[!]", true
	}
	if selected {
		switch state {
		case "linked":
			return "[=]", true
		case "relink":
			return "[~]", true
		case "missing":
			return "[+]", true
		}
		return "", false
	}
	if state == "linked" {
		return "[-]", true
	}
	return "", false
}

// actionStyle is action_style().
func actionStyle(action string) string {
	switch action {
	case "[=]":
		return greenSeq
	case "[+]":
		return cyanSeq
	case "[-]", "[~]":
		return yellowSeq
	}
	return redSeq
}

// summarizeStates is summarize_states().
func summarizeStates(color bool, states map[ManagedItem]destinationState) string {
	counts := map[string]int{"linked": 0, "relink": 0, "conflict": 0}
	for _, state := range states {
		if _, ok := counts[state.state]; ok {
			counts[state.state]++
		}
	}
	return strings.Join([]string{
		paint(color, fmt.Sprintf("Linked %d", counts["linked"]), greenSeq),
		paint(color, fmt.Sprintf("Relink %d", counts["relink"]), yellowSeq),
		paint(color, fmt.Sprintf("Conflict %d", counts["conflict"]), redSeq),
	}, " | ")
}

// Len is the number of selectable items.
func (a *app) Len() int { return len(a.items) }

// ListHeight is the original's list_height: the terminal rows left after the
// seven header lines and the message line.
func (a *app) ListHeight(height int) int {
	if height <= 0 {
		height = 24
	}
	return max(1, height-headerLines-1)
}

// DisplayIndex is item_display_index[index]: the row's position among the
// display entries, which include section headers and spacers.
func (a *app) DisplayIndex(index int) int {
	if index < 0 || index >= len(a.items) {
		return 0
	}
	return a.displayIndex[a.items[index]]
}

// ResetMessage restores the prompt after a handled key.
func (a *app) ResetMessage() { a.message = defaultMessage }

// UnknownKey is the reply to a key the picker does not use.
func (a *app) UnknownKey() { a.message = unknownKeyMessage }

// Toggle flips one row, then re-normalizes the exclusive group.
func (a *app) Toggle(index int) {
	if index < 0 || index >= len(a.items) {
		return
	}
	item := a.items[index]
	a.selection[item] = !a.selection[item]
	if a.selection[item] {
		states := a.inspectStates(a.projectRoot, a.items, a.modes)
		normalizeSelection(a.selection, a.items, states, item, true)
	}
}

// ToggleAll flips every row and re-normalizes.
func (a *app) ToggleAll() {
	allSelected := true
	for _, item := range a.items {
		if !a.selection[item] {
			allSelected = false
			break
		}
	}
	for _, item := range a.items {
		a.selection[item] = !allSelected
	}
	states := a.inspectStates(a.projectRoot, a.items, a.modes)
	normalizeSelection(a.selection, a.items, states, ManagedItem{}, false)
}

// ToggleMode is the `m` key: it sets its own message, and a real mode change
// re-inspects the targets and selects the row.
func (a *app) ToggleMode(index int) {
	if index < 0 || index >= len(a.items) {
		return
	}
	item := a.items[index]
	previousMode, hadMode := a.modes[item]
	a.message = a.toggleRuleMode(item, a.modes)
	currentMode, hasMode := a.modes[item]
	if hadMode == hasMode && previousMode == currentMode {
		return
	}
	states := a.inspectStates(a.projectRoot, a.items, a.modes)
	if !a.selection[item] {
		a.selection[item] = true
	}
	normalizeSelection(a.selection, a.items, states, item, true)
}

// Frame is render_lines(): the seven header lines, the visible list rows, and
// the message. Each line is fitted to the terminal width exactly as the
// original drew it.
func (a *app) Frame(width, height, index, offset int) []string {
	if width <= 0 {
		width = 100
	}
	states := a.inspectStates(a.projectRoot, a.items, a.modes)
	selectedConflicts, selectedLinked, selectedRelink := 0, 0, 0
	selectedCount := 0
	for _, item := range a.items {
		if a.selection[item] {
			selectedCount++
			switch states[item].state {
			case "conflict":
				selectedConflicts++
			case "linked":
				selectedLinked++
			case "relink":
				selectedRelink++
			}
		}
	}

	header := []string{
		paint(a.color, "Rule source: "+a.ruleRoot, boldSeq, blueSeq),
		paint(a.color, "Skill source: "+a.skillRoot, boldSeq, blueSeq),
		paint(a.color, "Rule target: "+a.projectRoot+"/.agents/{rules,rules-routed}", boldSeq, blueSeq),
		paint(a.color, "Skill target: "+a.projectRoot+"/.agents/skills-routed", boldSeq, blueSeq),
		paint(a.color, helpText, dimSeq),
		paint(a.color, fmt.Sprintf("Selected: %d/%d | %s", selectedCount, len(a.items), summarizeStates(a.color, states)), boldSeq),
		paint(a.color, fmt.Sprintf("Ready: %d linked | %d relink | %d conflict", selectedLinked, selectedRelink, selectedConflicts), readyStyle(a.color, selectedConflicts > 0)),
	}

	lines := append([]string{}, header...)
	listHeight := a.ListHeight(height)
	current := ManagedItem{}
	hasCurrent := index >= 0 && index < len(a.items)
	if hasCurrent {
		current = a.items[index]
	}
	for _, entry := range a.visibleEntries(offset, listHeight) {
		switch entry.kind {
		case "spacer":
			lines = append(lines, "")
		case "section":
			color := blueSeq
			switch {
			case strings.HasPrefix(entry.label, "General"):
				color = magentaSeq
			case strings.HasPrefix(entry.label, "Stack"):
				color = cyanSeq
			}
			lines = append(lines, paint(a.color, "  "+entry.label, boldSeq, color))
		default:
			lines = append(lines, a.itemLine(entry.item, current, hasCurrent, states))
		}
	}
	lines = append(lines, a.message)

	fitted := make([]string, len(lines))
	for i, line := range lines {
		fitted[i] = fitToWidth(line, max(1, width-1))
	}
	return fitted
}

func readyStyle(color bool, hasConflict bool) string {
	if hasConflict {
		return redSeq
	}
	return dimSeq
}

// visibleEntries is display_entries[offset : offset+list_height].
func (a *app) visibleEntries(offset, listHeight int) []entry {
	if offset < 0 {
		offset = 0
	}
	if offset > len(a.entries) {
		offset = len(a.entries)
	}
	end := min(len(a.entries), offset+listHeight)
	return a.entries[offset:end]
}

// itemLine is the per-row composition of render_lines: cursor, marker, name,
// mode, action, and detail.
func (a *app) itemLine(item, current ManagedItem, hasCurrent bool, states map[ManagedItem]destinationState) string {
	selected := a.selection[item]
	state := states[item]
	isCurrent := hasCurrent && item == current

	prefix := " "
	if isCurrent {
		prefix = paint(a.color, activeMarker, boldSeq, cyanSeq)
	}
	marker := uncheckedMarker
	if selected {
		marker = checkedMarker
	}
	paintedMarker := paint(a.color, marker, markerStyle(selected, state.state))

	var statusParts []string
	if item.Kind == "rule" {
		mode := a.modes[item]
		if mode == "" {
			mode = alwaysMode
		}
		style := blueSeq
		if mode == routedMode {
			style = magentaSeq
		}
		statusParts = append(statusParts, paint(a.color, mode, style))
		if !a.ruleHasDescription(item) {
			note := "always only"
			if mode == routedMode {
				note = "no description"
			}
			statusParts = append(statusParts, paint(a.color, "("+note+")", dimSeq))
		}
	}
	if action, ok := plannedAction(selected, state.state); ok {
		statusParts = append(statusParts, paint(a.color, action, actionStyle(action)))
		if (state.state == "conflict" || state.state == "relink") && state.detail != "" {
			statusParts = append(statusParts, paint(a.color, "("+state.detail+")", dimSeq))
		}
	}
	statusText := ""
	if len(statusParts) > 0 {
		statusText = " " + strings.Join(statusParts, " ")
	}

	line := prefix + " " + paintedMarker + " " + item.displayName() + statusText
	if isCurrent {
		line = paint(a.color, line, boldSeq)
	}
	return line
}
