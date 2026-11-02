// pin.go ports cli-rust/src/pin.rs.
//
// tools.toml is edited as text so comments and other [[tool]] tables stay put.
// Spacing follows toml_edit 0.22: an existing key keeps the whitespace before '=',
// the new value is written as `= "..."` (so version="1" becomes version= "2"),
// a new key is appended as `key = "value"`, and status = "pending" is removed
// together with the blank lines and comments directly above it.
// Carriage returns are dropped, matching toml_edit's decor encoder.

package app

import (
	"fmt"
	"os"
	"strings"
	"unicode/utf8"

	"github.com/BurntSushi/toml"
)

// writePin is write_pin. The temp file is path with its extension replaced by toml.tmp.
func writePin(path, name, sha256 string, version *string) error {
	text, err := readTools(path)
	if err != nil {
		return err
	}
	updated, err := applyPin(text, name, sha256, version)
	if err != nil {
		return err
	}
	return writeAtomic(path, updated)
}

// writeVersion is write_version. It pins version only and clears status = "pending".
func writeVersion(path, name, version string) error {
	text, err := readTools(path)
	if err != nil {
		return err
	}
	updated, err := applyVersion(text, name, version)
	if err != nil {
		return err
	}
	return writeAtomic(path, updated)
}

// applyPin is apply_pin.
func applyPin(text, name, sha256 string, version *string) (string, error) {
	if len(sha256) != 64 || !isHex64(sha256) {
		return "", fmt.Errorf("sha256 must be 64 hex characters")
	}
	sha := strings.ToLower(sha256)
	return editTool(text, name, func(sec *pinSection) {
		sec.setKey("sha256", formatTomlString(sha))
		if version != nil {
			sec.setKey("version", formatTomlString(*version))
		}
		sec.removePending()
	})
}

func applyVersion(text, name, version string) (string, error) {
	return editTool(text, name, func(sec *pinSection) {
		sec.setKey("version", formatTomlString(version))
		sec.removePending()
	})
}

func editTool(text, name string, mutate func(*pinSection)) (string, error) {
	tables, err := toolTables(text)
	if err != nil {
		return "", err
	}
	index := -1
	for i, table := range tables {
		n, _ := table["name"].(string)
		if n == name {
			index = i
			break
		}
	}
	if index < 0 {
		return "", fmt.Errorf("tool %s not found", name)
	}
	doc := parsePinDoc(text)
	blocks := doc.toolBlocks()
	if index >= len(blocks) {
		return "", fmt.Errorf("tool %s not found", name)
	}
	mutate(blocks[index])
	return doc.render(), nil
}

func toolTables(text string) ([]map[string]any, error) {
	var root map[string]any
	if _, err := toml.Decode(text, &root); err != nil {
		return nil, fmt.Errorf("invalid tools.toml: %w", err)
	}
	raw, ok := root["tool"]
	if !ok || raw == nil {
		return nil, fmt.Errorf("tools.toml has no [[tool]]")
	}
	switch tables := raw.(type) {
	case []map[string]any:
		return tables, nil
	case []any:
		out := make([]map[string]any, len(tables))
		for i, item := range tables {
			table, ok := item.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("tools.toml has no [[tool]]")
			}
			out[i] = table
		}
		return out, nil
	default:
		return nil, fmt.Errorf("tools.toml has no [[tool]]")
	}
}

func readTools(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", path, err)
	}
	if !utf8.Valid(data) {
		return "", fmt.Errorf("read %s: stream did not contain valid UTF-8", path)
	}
	return string(data), nil
}

func writeAtomic(path, text string) error {
	tmp := withTomlTmp(path)
	if err := os.WriteFile(tmp, []byte(text), 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	return nil
}

// withTomlTmp is Path::with_extension("toml.tmp").
func withTomlTmp(path string) string {
	i := strings.LastIndex(path, "/")
	dir, base := "", path
	if i >= 0 {
		dir, base = path[:i+1], path[i+1:]
	}
	stem := base
	if dot := strings.LastIndex(base, "."); dot >= 0 {
		stem = base[:dot]
	}
	return dir + stem + ".toml.tmp"
}

type pinSection struct {
	preamble  []string
	header    string
	hasHeader bool
	keys      []pinKey
}

type pinKey struct {
	preamble []string
	line     string
}

type pinDoc struct {
	sections []pinSection
	trailing []string
}

func (d *pinDoc) toolBlocks() []*pinSection {
	var out []*pinSection
	for i := range d.sections {
		if isToolArrayHeader(d.sections[i].header) {
			out = append(out, &d.sections[i])
		}
	}
	return out
}

func (s *pinSection) removePending() {
	kept := s.keys[:0]
	for _, key := range s.keys {
		if pinKeyName(key.line) == "status" {
			if value, ok := pinStringValue(key.line); ok && value == "pending" {
				continue
			}
		}
		kept = append(kept, key)
	}
	s.keys = kept
}

func (s *pinSection) setKey(name, formatted string) {
	for i := range s.keys {
		if pinKeyName(s.keys[i].line) != name {
			continue
		}
		eq, ok := pinEqIndex(s.keys[i].line)
		if !ok {
			continue
		}
		s.keys[i].line = s.keys[i].line[:eq+1] + " " + formatted
		return
	}
	s.keys = append(s.keys, pinKey{line: name + " = " + formatted})
}

func (d *pinDoc) render() string {
	var lines []string
	for _, sec := range d.sections {
		lines = append(lines, sec.preamble...)
		if sec.hasHeader {
			lines = append(lines, sec.header)
		}
		for _, key := range sec.keys {
			lines = append(lines, key.preamble...)
			lines = append(lines, key.line)
		}
	}
	lines = append(lines, d.trailing...)
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n") + "\n"
}

func parsePinDoc(text string) *pinDoc {
	text = strings.ReplaceAll(text, "\r", "")
	var lines []string
	switch {
	case text == "":
		lines = nil
	case strings.HasSuffix(text, "\n"):
		lines = strings.Split(text, "\n")
		lines = lines[:len(lines)-1]
	default:
		lines = strings.Split(text, "\n")
	}
	doc := &pinDoc{}
	var current *pinSection
	var pending []string
	flushHeader := func(header string) {
		sec := pinSection{preamble: pending, header: header, hasHeader: true}
		doc.sections = append(doc.sections, sec)
		current = &doc.sections[len(doc.sections)-1]
		pending = nil
	}
	for _, line := range lines {
		switch {
		case isPinBlank(line) || isPinComment(line):
			pending = append(pending, line)
		case isPinHeader(line):
			flushHeader(line)
		default:
			if current == nil {
				doc.sections = append(doc.sections, pinSection{})
				current = &doc.sections[len(doc.sections)-1]
			}
			current.keys = append(current.keys, pinKey{preamble: pending, line: line})
			pending = nil
		}
	}
	doc.trailing = pending
	return doc
}

func isPinBlank(line string) bool {
	return strings.TrimSpace(line) == ""
}

func isPinComment(line string) bool {
	return strings.HasPrefix(strings.TrimSpace(line), "#")
}

func isPinHeader(line string) bool {
	s := strings.TrimSpace(line)
	if hash := pinCommentIndex(s); hash >= 0 {
		s = strings.TrimSpace(s[:hash])
	}
	return strings.HasPrefix(s, "[")
}

func isToolArrayHeader(line string) bool {
	s := strings.TrimSpace(line)
	if hash := pinCommentIndex(s); hash >= 0 {
		s = strings.TrimSpace(s[:hash])
	}
	if !strings.HasPrefix(s, "[[") || !strings.HasSuffix(s, "]]") {
		return false
	}
	inner := strings.TrimSpace(s[2 : len(s)-2])
	return inner == "tool"
}

func pinCommentIndex(s string) int {
	inSingle, inDouble := false, false
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '\'':
			if !inDouble {
				inSingle = !inSingle
			}
		case '"':
			if !inSingle {
				inDouble = !inDouble
			}
		case '#':
			if !inSingle && !inDouble {
				return i
			}
		}
	}
	return -1
}

func pinKeyName(line string) string {
	i := skipHSpace(line, 0)
	if i >= len(line) {
		return ""
	}
	if line[i] == '"' || line[i] == '\'' {
		value, _, ok := decodePinString(line[i:])
		if !ok {
			return ""
		}
		return value
	}
	start := i
	for i < len(line) {
		c := line[i]
		if c == ' ' || c == '\t' || c == '=' || c == '.' {
			break
		}
		i++
	}
	return line[start:i]
}

func pinEqIndex(line string) (int, bool) {
	i := skipHSpace(line, 0)
	if i >= len(line) {
		return 0, false
	}
	if line[i] == '"' || line[i] == '\'' {
		_, n, ok := decodePinString(line[i:])
		if !ok {
			return 0, false
		}
		i += n
	} else {
		for i < len(line) {
			c := line[i]
			if c == '=' {
				break
			}
			if c == ' ' || c == '\t' {
				j := skipHSpace(line, i)
				if j < len(line) && line[j] == '=' {
					i = j
					break
				}
				if j < len(line) && line[j] == '.' {
					i = j + 1
					continue
				}
				break
			}
			i++
		}
	}
	i = skipHSpace(line, i)
	if i >= len(line) || line[i] != '=' {
		return 0, false
	}
	return i, true
}

func pinStringValue(line string) (string, bool) {
	eq, ok := pinEqIndex(line)
	if !ok {
		return "", false
	}
	rest := line[eq+1:]
	rest = rest[skipHSpace(rest, 0):]
	value, _, ok := decodePinString(rest)
	return value, ok
}

func skipHSpace(s string, i int) int {
	for i < len(s) && (s[i] == ' ' || s[i] == '\t') {
		i++
	}
	return i
}

func decodePinString(s string) (string, int, bool) {
	if strings.HasPrefix(s, `"""`) {
		return "", 0, false
	}
	if strings.HasPrefix(s, "'''") {
		return "", 0, false
	}
	if strings.HasPrefix(s, `"`) {
		return decodeBasic(s)
	}
	if strings.HasPrefix(s, "'") {
		end := strings.IndexByte(s[1:], '\'')
		if end < 0 {
			return "", 0, false
		}
		return s[1 : 1+end], 2 + end, true
	}
	return "", 0, false
}

func decodeBasic(s string) (string, int, bool) {
	var b strings.Builder
	for i := 1; i < len(s); i++ {
		switch s[i] {
		case '"':
			return b.String(), i + 1, true
		case '\\':
			if i+1 >= len(s) {
				return "", 0, false
			}
			i++
			switch s[i] {
			case 'b':
				b.WriteByte('\b')
			case 't':
				b.WriteByte('\t')
			case 'n':
				b.WriteByte('\n')
			case 'f':
				b.WriteByte('\f')
			case 'r':
				b.WriteByte('\r')
			case '"', '\\':
				b.WriteByte(s[i])
			case 'u':
				r, n, ok := decodeU(s[i+1:], 4)
				if !ok {
					return "", 0, false
				}
				b.WriteRune(r)
				i += n
			case 'U':
				r, n, ok := decodeU(s[i+1:], 8)
				if !ok {
					return "", 0, false
				}
				b.WriteRune(r)
				i += n
			default:
				return "", 0, false
			}
		default:
			b.WriteByte(s[i])
		}
	}
	return "", 0, false
}

func decodeU(s string, n int) (rune, int, bool) {
	if len(s) < n {
		return 0, 0, false
	}
	var v rune
	for i := 0; i < n; i++ {
		c := s[i]
		v <<= 4
		switch {
		case c >= '0' && c <= '9':
			v += rune(c - '0')
		case c >= 'a' && c <= 'f':
			v += rune(c-'a') + 10
		case c >= 'A' && c <= 'F':
			v += rune(c-'A') + 10
		default:
			return 0, 0, false
		}
	}
	return v, n, true
}

// formatTomlString matches toml_edit's value() string style for the common cases.
func formatTomlString(s string) string {
	if s == "" {
		return `""`
	}
	newline := strings.Contains(s, "\n")
	escapeCodes := false
	backslash := strings.Contains(s, `\`)
	maxSingle, maxDouble := 0, 0
	runSingle, runDouble := 0, 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '\'' {
			runSingle++
			if runSingle > maxSingle {
				maxSingle = runSingle
			}
		} else {
			runSingle = 0
		}
		if c == '"' {
			runDouble++
			if runDouble > maxDouble {
				maxDouble = runDouble
			}
		} else {
			runDouble = 0
		}
		if c != '\t' && c != '\n' && (c <= 0x1f || c == 0x7f) {
			escapeCodes = true
		}
	}
	switch {
	case !escapeCodes && !backslash && maxDouble == 0 && !newline:
		return `"` + s + `"`
	case !escapeCodes && maxSingle == 0 && !newline:
		return "'" + s + "'"
	case !escapeCodes && !backslash && maxDouble <= 2 && newline:
		return "\"\"\"\n" + s + "\"\"\""
	default:
		return `"` + escapeBasic(s) + `"`
	}
}

func escapeBasic(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '\\':
			b.WriteString(`\\`)
		case '"':
			b.WriteString(`\"`)
		case '\b':
			b.WriteString(`\b`)
		case '\t':
			b.WriteString(`\t`)
		case '\n':
			b.WriteString(`\n`)
		case '\f':
			b.WriteString(`\f`)
		case '\r':
			b.WriteString(`\r`)
		default:
			if s[i] <= 0x1f || s[i] == 0x7f {
				fmt.Fprintf(&b, `\u%04X`, s[i])
			} else {
				b.WriteByte(s[i])
			}
		}
	}
	return b.String()
}
