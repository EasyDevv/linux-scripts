// env.go ports the .env reader/writer: NAME=value lines with comments,
// optional export prefix and wrapping quotes, and the stable upsert.
package app

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var envLineRe = regexp.MustCompile(`^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$`)

// stripWrappingQuotes mirrors strip_wrapping_quotes(): a matching pair of
// single or double quotes around the whole value is dropped.
func stripWrappingQuotes(value string) string {
	if len(value) >= 2 && value[0] == value[len(value)-1] && (value[0] == '\'' || value[0] == '"') {
		return value[1 : len(value)-1]
	}
	return value
}

// parseEnv reads NAME=value pairs. Comments, blanks, and lines without `=` are
// skipped. Later assignments win.
func parseEnv(text string) map[string]string {
	values := map[string]string{}
	for _, rawLine := range strings.Split(text, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		match := envLineRe.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		values[match[1]] = stripWrappingQuotes(match[2])
	}
	return values
}

// loadEnvFile returns an empty map when the file is missing.
func loadEnvFile(path string) map[string]string {
	data, err := os.ReadFile(path)
	if err != nil {
		return map[string]string{}
	}
	return parseEnv(string(data))
}

// envHeader is the comment block written above the first stored key.
func envHeader(managementURL, autoGroup string) string {
	return "# One-off setup keys. Do not commit. Do not print.\n" +
		"# management: " + managementURL + "\n" +
		"# auto-group: " + autoGroup + "\n" +
		"# type: one-off, usage_limit: 1, expires_in: 604800\n" +
		"#\n" +
		"# PC:\n" +
		"#   netbird up --management-url " + managementURL + " --setup-key <KEY>\n" +
		"#\n" +
		"# Mobile (iOS/Android):\n" +
		"#   1. Change Server\n" +
		"#   2. Management URL: " + managementURL + "\n" +
		"#   3. Add this device with a setup key\n" +
		"#   4. paste <KEY> and connect\n"
}

// upsertEnv replaces every assignment of name in place, or appends a blank line
// plus the assignment, and always ends the text with one newline.
func upsertEnv(text, name, value string) string {
	assignment := name + "=" + value
	lines := strings.Split(strings.TrimSuffix(text, "\n"), "\n")
	if text == "" {
		lines = nil
	}
	replaced := false
	out := make([]string, 0, len(lines)+2)
	for _, line := range lines {
		if match := envLineRe.FindStringSubmatch(strings.TrimSpace(line)); match != nil && match[1] == name {
			out = append(out, assignment)
			replaced = true
			continue
		}
		out = append(out, line)
	}
	if !replaced {
		if len(out) > 0 && out[len(out)-1] != "" {
			out = append(out, "")
		}
		out = append(out, assignment)
	}
	return strings.Join(out, "\n") + "\n"
}

// atomicWrite writes through `.<name>.tmp` in the same directory, chmods the
// temp file, then renames over the target (mode applied twice, as in Python).
func atomicWrite(path, text string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := filepath.Join(filepath.Dir(path), "."+filepath.Base(path)+".tmp")
	if err := os.WriteFile(tmp, []byte(text), mode); err != nil {
		return err
	}
	if err := os.Chmod(tmp, mode); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	return os.Chmod(path, mode)
}

// envNameOrder returns the assignment names in first-occurrence order, the way
// Python's dict preserved them.
func envNameOrder(text string) []string {
	names := make([]string, 0, 8)
	seen := map[string]bool{}
	for _, rawLine := range strings.Split(text, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		match := envLineRe.FindStringSubmatch(line)
		if match == nil || seen[match[1]] {
			continue
		}
		seen[match[1]] = true
		names = append(names, match[1])
	}
	return names
}

// errNotExist keeps errors.Is checks readable in the command layer.
var errNotExist = errors.New("does not exist")
