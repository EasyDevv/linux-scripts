// verify.go ports cli-rust/src/verify.rs.
//
// gpg is invoked only via os/exec argument arrays (never a shell).
// Go has no Drop: gpgVerify closes the temporary GNUPGHOME (gpgconf --kill all,
// then remove) before it returns. Callers do not free it.
// Domain errors are *GpgError. OS causes are chained with Unwrap; Error()
// matches Rust Display.

package app

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	GpgKindInvalidFingerprint  = "InvalidFingerprint"
	GpgKindMissing             = "GpgMissing"
	GpgKindImportFailed        = "ImportFailed"
	GpgKindBadSignature        = "BadSignature"
	GpgKindFingerprintMismatch = "FingerprintMismatch"

	KeySourceFile      = "file"
	KeySourceKeyserver = "keyserver"
)

// GpgError is GpgError. Kind is one of the GpgKind* constants.
// Message is the ImportFailed or BadSignature payload.
// Expected and Actual are set for FingerprintMismatch (lowercase, no spaces).
type GpgError struct {
	Kind     string
	Message  string
	Expected string
	Actual   string
	cause    error
}

func (e *GpgError) Error() string {
	if e == nil {
		return ""
	}
	switch e.Kind {
	case GpgKindInvalidFingerprint:
		return "invalid fingerprint"
	case GpgKindMissing:
		return "gpg not found"
	case GpgKindImportFailed:
		return "gpg import failed: " + e.Message
	case GpgKindBadSignature:
		return "bad signature: " + e.Message
	case GpgKindFingerprintMismatch:
		return fmt.Sprintf("fingerprint mismatch: expected %s, got %s", e.Expected, e.Actual)
	default:
		return "gpg error"
	}
}

func (e *GpgError) Unwrap() error { return e.cause }

func gpgErr(kind, message string, cause error) error {
	return fmt.Errorf("%w", &GpgError{Kind: kind, Message: message, cause: cause})
}

// KeySource is KeySource::{KeyFile, Keyserver}.
// Kind is KeySourceFile or KeySourceKeyserver. Value is the path or URL.
type KeySource struct {
	Kind  string
	Value string
}

// GpgVerify is the gpg_verify input. Paths are filesystem paths, not shell text.
type GpgVerify struct {
	File        string
	Sig         string
	Fingerprint string
	KeySource   KeySource
}

// parseValidsig is parse_validsig. A BADSIG/ERRSIG/EXPKEYSIG/REVKEYSIG tag
// wins over a later VALIDSIG. Fingerprints are compared lowercase.
func parseValidsig(status, fingerprint string) error {
	expected, err := normalizeFingerprint(fingerprint)
	if err != nil {
		return err
	}
	var bad string
	sawValid := false
	matched := false
	actual := ""
	for _, line := range statusLines(status) {
		rest, ok := gnupgPayload(line)
		if !ok {
			continue
		}
		parts := strings.Fields(rest)
		if len(parts) == 0 {
			continue
		}
		tag := parts[0]
		fields := parts[1:]
		switch tag {
		case "BADSIG", "ERRSIG", "EXPKEYSIG", "REVKEYSIG":
			if bad == "" {
				bad = tag
			}
		case "VALIDSIG":
			sawValid = true
			if len(fields) == 0 {
				continue
			}
			candidates := [2]string{fields[0], fields[len(fields)-1]}
			for _, field := range candidates {
				if !isFingerprint(field) {
					continue
				}
				lower := strings.ToLower(field)
				if actual == "" {
					actual = preferActual(fields)
				}
				if lower == expected {
					matched = true
				}
			}
		}
	}
	if bad != "" {
		return gpgErr(GpgKindBadSignature, bad, nil)
	}
	if matched {
		return nil
	}
	if sawValid {
		return fmt.Errorf("%w", &GpgError{
			Kind:     GpgKindFingerprintMismatch,
			Expected: expected,
			Actual:   actual,
		})
	}
	return gpgErr(GpgKindBadSignature, "no VALIDSIG", nil)
}

// gpgVerify is gpg_verify. It imports the key into a fresh GNUPGHOME, then
// runs `gpg --batch --status-fd=1 --verify <sig> <file>` and checks VALIDSIG.
func gpgVerify(verify *GpgVerify) error {
	if verify == nil {
		return gpgErr(GpgKindImportFailed, "nil verify", nil)
	}
	fingerprint, err := normalizeFingerprint(verify.Fingerprint)
	if err != nil {
		return err
	}
	home, err := createGnupgHome()
	if err != nil {
		return err
	}
	defer home.close()
	return verifyIn(home.path, verify, fingerprint)
}

func verifyIn(home string, verify *GpgVerify, fingerprint string) error {
	if err := importKey(home, verify, fingerprint); err != nil {
		return err
	}
	out, err := gpg(home, "--batch", "--status-fd=1", "--verify", verify.Sig, verify.File)
	if err != nil {
		return err
	}
	return parseValidsig(lossy(out.stdout), fingerprint)
}

func importKey(home string, verify *GpgVerify, fingerprint string) error {
	var out gpgOutput
	var err error
	switch verify.KeySource.Kind {
	case KeySourceFile:
		out, err = gpg(home, "--batch", "--import", verify.KeySource.Value)
	case KeySourceKeyserver:
		out, err = gpg(home, "--batch", "--keyserver", verify.KeySource.Value, "--recv-keys", fingerprint)
	default:
		return gpgErr(GpgKindImportFailed, "unknown key source", nil)
	}
	if err != nil {
		return err
	}
	if out.success() {
		return nil
	}
	return gpgErr(GpgKindImportFailed, commandNote(out), nil)
}

type gpgOutput struct {
	stdout []byte
	stderr []byte
	state  *os.ProcessState
}

func (o gpgOutput) success() bool {
	return o.state != nil && o.state.Success()
}

func gpg(home string, args ...string) (gpgOutput, error) {
	cmd := exec.Command("gpg", args...)
	cmd.Env = childEnv(home)
	stdin := devNull()
	if stdin != nil {
		defer stdin.Close()
	}
	cmd.Stdin = stdin
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	out := gpgOutput{stdout: stdout.Bytes(), stderr: stderr.Bytes(), state: cmd.ProcessState}
	if err == nil {
		return out, nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		out.state = exitErr.ProcessState
		return out, nil
	}
	if gpgNotFound(err) {
		return gpgOutput{}, gpgErr(GpgKindMissing, "", nil)
	}
	return gpgOutput{}, gpgErr(GpgKindImportFailed, err.Error(), err)
}

func gpgNotFound(err error) bool {
	if errors.Is(err, exec.ErrNotFound) || errors.Is(err, os.ErrNotExist) {
		return true
	}
	var execErr *exec.Error
	if errors.As(err, &execErr) {
		return errors.Is(execErr.Err, exec.ErrNotFound) || errors.Is(execErr.Err, os.ErrNotExist)
	}
	return false
}

func normalizeFingerprint(raw string) (string, error) {
	var b strings.Builder
	b.Grow(len(raw))
	for _, ch := range raw {
		if !unicode.IsSpace(ch) {
			b.WriteRune(ch)
		}
	}
	compact := b.String()
	if !isFingerprint(compact) {
		return "", gpgErr(GpgKindInvalidFingerprint, "", nil)
	}
	return strings.ToLower(compact), nil
}

func isFingerprint(text string) bool {
	if len(text) != 40 {
		return false
	}
	for i := 0; i < len(text); i++ {
		c := text[i]
		switch {
		case c >= '0' && c <= '9', c >= 'a' && c <= 'f', c >= 'A' && c <= 'F':
		default:
			return false
		}
	}
	return true
}

func gnupgPayload(line string) (string, bool) {
	trimmed := strings.TrimSpace(line)
	rest, ok := strings.CutPrefix(trimmed, "[GNUPG:]")
	if !ok {
		return "", false
	}
	return strings.TrimLeftFunc(rest, unicode.IsSpace), true
}

func preferActual(fields []string) string {
	if len(fields) == 0 {
		return ""
	}
	last := fields[len(fields)-1]
	if isFingerprint(last) {
		return strings.ToLower(last)
	}
	first := fields[0]
	if isFingerprint(first) {
		return strings.ToLower(first)
	}
	return ""
}

func commandNote(output gpgOutput) string {
	text := lossy(output.stderr) + " " + lossy(output.stdout)
	text = strings.ReplaceAll(text, "\x00", "")
	text = strings.Join(strings.Fields(text), " ")
	if text == "" {
		return "exit " + rustExitStatus(output.state)
	}
	if len(text) > 500 {
		text = text[:500]
		for text != "" && !utf8.ValidString(text) {
			text = text[:len(text)-1]
		}
	}
	return text
}

func rustExitStatus(state *os.ProcessState) string {
	if state == nil {
		return "exit status: unknown"
	}
	if ws, ok := state.Sys().(syscall.WaitStatus); ok {
		switch {
		case ws.Exited():
			return fmt.Sprintf("exit status: %d", ws.ExitStatus())
		case ws.Signaled():
			return fmt.Sprintf("signal: %d", int(ws.Signal()))
		case ws.Stopped():
			return fmt.Sprintf("stop signal: %d", int(ws.StopSignal()))
		case ws.Continued():
			return "continued"
		}
	}
	if code := state.ExitCode(); code >= 0 {
		return fmt.Sprintf("exit status: %d", code)
	}
	return state.String()
}

func lossy(b []byte) string {
	if utf8.Valid(b) {
		return string(b)
	}
	return strings.ToValidUTF8(string(b), "\uFFFD")
}

func statusLines(status string) []string {
	if status == "" {
		return nil
	}
	status = strings.ReplaceAll(status, "\r\n", "\n")
	lines := strings.Split(status, "\n")
	if strings.HasSuffix(status, "\n") && len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

func childEnv(home string) []string {
	base := os.Environ()
	out := make([]string, 0, len(base)+2)
	for _, kv := range base {
		if strings.HasPrefix(kv, "GNUPGHOME=") || strings.HasPrefix(kv, "LC_ALL=") {
			continue
		}
		out = append(out, kv)
	}
	out = append(out, "GNUPGHOME="+home, "LC_ALL=C")
	return out
}

func devNull() *os.File {
	f, err := os.Open(os.DevNull)
	if err != nil {
		return nil
	}
	return f
}

type gnupgHome struct {
	path string
}

var gnupgSeq atomic.Uint64

func createGnupgHome() (*gnupgHome, error) {
	seq := gnupgSeq.Add(1) - 1
	nanos := time.Now().UnixNano()
	var n uint64
	if nanos > 0 {
		n = uint64(nanos)
	}
	path := filepath.Join(os.TempDir(), fmt.Sprintf("cli-gnupg-%d-%d-%d", os.Getpid(), n, seq))
	if err := os.Mkdir(path, 0o700); err != nil {
		return nil, gpgErr(GpgKindImportFailed, "temp dir: "+err.Error(), err)
	}
	if err := os.Chmod(path, 0o700); err != nil {
		_ = os.RemoveAll(path)
		return nil, gpgErr(GpgKindImportFailed, "temp dir mode: "+err.Error(), err)
	}
	return &gnupgHome{path: path}, nil
}

func (h *gnupgHome) close() {
	if h == nil || h.path == "" {
		return
	}
	cmd := exec.Command("gpgconf", "--kill", "all")
	cmd.Env = childEnv(h.path)
	stdin, stdout, stderr := devNull(), devNull(), devNull()
	defer func() {
		for _, f := range []*os.File{stdin, stdout, stderr} {
			if f != nil {
				_ = f.Close()
			}
		}
	}()
	cmd.Stdin, cmd.Stdout, cmd.Stderr = stdin, stdout, stderr
	_ = cmd.Run()
	_ = os.RemoveAll(h.path)
}
