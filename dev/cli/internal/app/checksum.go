// checksum.go ports cli-rust/src/checksum.rs.
//
// sha256File, parseChecksums, parseSingleHash, findHash, verifySha256.
// ChecksumMismatch is the verify error (not a wrapped I/O error).

package app

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strings"
	"unicode"
)

// ChecksumMismatch is checksum::ChecksumMismatch.
// Actual is the computed hash, or the sha256File error text when the file cannot be read.
type ChecksumMismatch struct {
	Expected string
	Actual   string
}

func (e ChecksumMismatch) Error() string {
	return fmt.Sprintf("checksum mismatch: expected %s, got %s", e.Expected, e.Actual)
}

// sha256File is sha256_file. Read failures are "read {path}: ...".
func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", path, err)
	}
	defer file.Close()
	hasher := sha256.New()
	buf := make([]byte, 64*1024)
	for {
		n, err := file.Read(buf)
		if n > 0 {
			if _, werr := hasher.Write(buf[:n]); werr != nil {
				return "", fmt.Errorf("read %s: %w", path, werr)
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("read %s: %w", path, err)
		}
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

// parseChecksums is parse_checksums. Lines that are not `hash  name` are skipped.
func parseChecksums(text string) [][2]string {
	rows := make([][2]string, 0)
	for _, line := range splitChecksumLines(text) {
		if row, ok := parseChecksumLine(line); ok {
			rows = append(rows, row)
		}
	}
	return rows
}

// parseSingleHash is parse_single_hash.
// One non-comment hex line is that hash. Zero, two, or a non-hex line is none.
func parseSingleHash(text string) (string, bool) {
	var found string
	seen := false
	for _, line := range splitChecksumLines(text) {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if !isHex64(line) {
			return "", false
		}
		if seen {
			return "", false
		}
		found = strings.ToLower(line)
		seen = true
	}
	return found, seen
}

// findHash is find_hash. "./" is stripped once from the asset and each name.
// Two different hashes for the same name is none. Otherwise a lone hash file matches any asset.
func findHash(text, asset string) (string, bool) {
	want := stripDotSlash(asset)
	var found string
	ok := false
	for _, row := range parseChecksums(text) {
		if stripDotSlash(row[1]) != want {
			continue
		}
		if !ok {
			found = row[0]
			ok = true
			continue
		}
		if found != row[0] {
			return "", false
		}
	}
	if ok {
		return found, true
	}
	return parseSingleHash(text)
}

// verifySha256 is verify_sha256. expected is trimmed and lowercased.
// A read failure is still ChecksumMismatch, with Actual set to the error text.
func verifySha256(path, expected string) error {
	expected = strings.ToLower(strings.TrimSpace(expected))
	actual, err := sha256File(path)
	if err != nil {
		return ChecksumMismatch{Expected: expected, Actual: err.Error()}
	}
	if actual == expected {
		return nil
	}
	return ChecksumMismatch{Expected: expected, Actual: actual}
}

func parseChecksumLine(line string) ([2]string, bool) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return [2]string{}, false
	}
	hash, rest, ok := splitOnceSpace(line)
	if !ok || !isHex64(hash) {
		return [2]string{}, false
	}
	name := strings.TrimSpace(rest)
	name = strings.TrimSpace(strings.TrimPrefix(name, "*"))
	if name == "" {
		return [2]string{}, false
	}
	return [2]string{strings.ToLower(hash), name}, true
}

func stripDotSlash(name string) string {
	return strings.TrimPrefix(name, "./")
}

func isHex64(text string) bool {
	if len(text) != 64 {
		return false
	}
	for i := 0; i < len(text); i++ {
		if !isASCIIHex(text[i]) {
			return false
		}
	}
	return true
}

func isASCIIHex(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

func splitOnceSpace(s string) (string, string, bool) {
	for i, r := range s {
		if unicode.IsSpace(r) {
			return s[:i], s[i:], true
		}
	}
	return "", "", false
}

func splitChecksumLines(text string) []string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return strings.Split(text, "\n")
}
