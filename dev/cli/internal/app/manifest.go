// manifest.go ports cli-rust/src/manifest.rs, plus the process exit codes
// the rest of the port uses (Rust EXIT_ERROR / EXIT_BLOCKED live here too).
//
// Exported: ExitOK ExitError ExitBlocked, BlockedError, ExitCode,
// Manifest, Tool, Method, Status, LoadPath, LoadStr, Tool.ExeName, Method.AsStr.
// TOML parsing uses only github.com/BurntSushi/toml.
// Unknown tools.toml keys are rejected (serde deny_unknown_fields), case-sensitive.

package app

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/BurntSushi/toml"
)

const (
	ExitOK      = 0
	ExitError   = 1
	ExitBlocked = 2
)

// BlockedError is a gate or audit block. Pass a pointer so errors.As can see it.
// Code 0 means ExitBlocked. Set Code to ExitError for Rust Blocked::Io / Blocked::Config.
type BlockedError struct {
	Err  error
	Code int
}

func (e *BlockedError) Error() string {
	if e == nil || e.Err == nil {
		return "blocked"
	}
	return e.Err.Error()
}

func (e *BlockedError) Unwrap() error { return e.Err }

// ExitCode is the process status for err. nil is ExitOK.
// A *BlockedError in the chain returns its Code, or ExitBlocked when Code is 0.
// Any other error is ExitError.
func ExitCode(err error) int {
	if err == nil {
		return ExitOK
	}
	var blocked *BlockedError
	if errors.As(err, &blocked) {
		if blocked != nil && blocked.Code != 0 {
			return blocked.Code
		}
		return ExitBlocked
	}
	return ExitError
}

type Manifest struct {
	CooldownDays uint32
	Tools        []Tool
}

type Tool struct {
	Name           string
	Method         Method
	Repo           *string
	URL            *string
	SigURL         *string
	GPGFingerprint *string
	Sig            *string
	KeyFile        *string
	SHA256         *string
	Version        *string
	VersionFrom    *string
	Asset          *string
	Checksum       *string
	Package        *string
	Module         *string
	Bin            *string
	Exe            *string
	Priority       string
	Group          string
	Category       string
	Env            []string
	Probe          []string
	Status         Status
}

// ExeName is Tool::exe_name. A blank exe falls back to Name.
func (t Tool) ExeName() string {
	if t.Exe != nil {
		value := strings.TrimSpace(*t.Exe)
		if value != "" {
			return value
		}
	}
	return t.Name
}

type Method int

const (
	MethodRelease Method = iota
	MethodVendor
	MethodBun
	MethodGo
	MethodCargo
)

// AsStr is Method::as_str.
func (m Method) AsStr() string {
	switch m {
	case MethodRelease:
		return "release"
	case MethodVendor:
		return "vendor"
	case MethodBun:
		return "bun"
	case MethodGo:
		return "go"
	case MethodCargo:
		return "cargo"
	default:
		return ""
	}
}

type Status int

const (
	StatusReady Status = iota
	StatusPending
)

// LoadPath is load_path. Read errors are "read {path}: ...".
// Parse and validation errors are "parse {path}: ...".
func LoadPath(path string) (Manifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Manifest{}, fmt.Errorf("read %s: %w", path, err)
	}
	if !utf8.Valid(data) {
		return Manifest{}, fmt.Errorf("read %s: stream did not contain valid UTF-8", path)
	}
	manifest, err := LoadStr(string(data))
	if err != nil {
		return Manifest{}, fmt.Errorf("parse %s: %w", path, err)
	}
	return manifest, nil
}

// LoadStr is load_str. TOML decode failures are wrapped with "invalid tools.toml".
// normalize errors (missing fields, unknown method, https) are not.
func LoadStr(text string) (Manifest, error) {
	file, err := decodeManifest(text)
	if err != nil {
		return Manifest{}, fmt.Errorf("invalid tools.toml: %w", err)
	}
	tools := make([]Tool, 0, len(file.Tool))
	seen := make([]string, 0, len(file.Tool))
	for _, raw := range file.Tool {
		tool, err := normalize(raw)
		if err != nil {
			return Manifest{}, err
		}
		for _, name := range seen {
			if name == tool.Name {
				return Manifest{}, fmt.Errorf("%s: duplicate name", tool.Name)
			}
		}
		seen = append(seen, tool.Name)
		tools = append(tools, tool)
	}
	if tools == nil {
		tools = []Tool{}
	}
	return Manifest{CooldownDays: *file.Defaults.CooldownDays, Tools: tools}, nil
}

type manifestFile struct {
	Defaults *defaultsFile `toml:"defaults"`
	Tool     []rawTool     `toml:"tool"`
}

type defaultsFile struct {
	CooldownDays *uint32 `toml:"cooldown_days"`
}

type rawTool struct {
	Name           *string  `toml:"name"`
	Method         *string  `toml:"method"`
	Repo           *string  `toml:"repo"`
	URL            *string  `toml:"url"`
	SigURL         *string  `toml:"sig_url"`
	GPGFingerprint *string  `toml:"gpg_fingerprint"`
	Sig            *string  `toml:"sig"`
	KeyFile        *string  `toml:"key_file"`
	SHA256         *string  `toml:"sha256"`
	Version        *string  `toml:"version"`
	VersionFrom    *string  `toml:"version_from"`
	Asset          *string  `toml:"asset"`
	Checksum       *string  `toml:"checksum"`
	Package        *string  `toml:"package"`
	Module         *string  `toml:"module"`
	Bin            *string  `toml:"bin"`
	Exe            *string  `toml:"exe"`
	Priority       *string  `toml:"priority"`
	Group          *string  `toml:"group"`
	Category       *string  `toml:"category"`
	Env            []string `toml:"env"`
	Probe          []string `toml:"probe"`
	Status         *string  `toml:"status"`
}

// manifestKeys is the serde deny_unknown_fields set. Comparison is case-sensitive;
// BurntSushi would otherwise accept Name as name.
var manifestKeys = map[string]map[string]struct{}{
	"defaults": {"cooldown_days": {}},
	"tool": {
		"name": {}, "method": {}, "repo": {}, "url": {}, "sig_url": {},
		"gpg_fingerprint": {}, "sig": {}, "key_file": {}, "sha256": {},
		"version": {}, "version_from": {}, "asset": {}, "checksum": {},
		"package": {}, "module": {}, "bin": {}, "exe": {},
		"priority": {}, "group": {}, "category": {}, "env": {}, "probe": {},
		"status": {},
	},
}

func decodeManifest(text string) (manifestFile, error) {
	var file manifestFile
	md, err := toml.Decode(text, &file)
	if err != nil {
		return manifestFile{}, err
	}
	if err := rejectUnknown(&md); err != nil {
		return manifestFile{}, err
	}
	if file.Defaults == nil {
		return manifestFile{}, fmt.Errorf("missing field `defaults`")
	}
	if file.Defaults.CooldownDays == nil {
		return manifestFile{}, fmt.Errorf("missing field `cooldown_days`")
	}
	for _, tool := range file.Tool {
		if tool.Name == nil {
			return manifestFile{}, fmt.Errorf("missing field `name`")
		}
		if tool.Method == nil {
			return manifestFile{}, fmt.Errorf("missing field `method`")
		}
	}
	return file, nil
}

func rejectUnknown(md *toml.MetaData) error {
	for _, key := range md.Keys() {
		if len(key) == 0 {
			return fmt.Errorf("unknown field `%s`", key.String())
		}
		top := key[0]
		fields, ok := manifestKeys[top]
		if !ok {
			return fmt.Errorf("unknown field `%s`", top)
		}
		if len(key) == 1 {
			continue
		}
		if len(key) != 2 {
			return fmt.Errorf("unknown field `%s`", key[len(key)-1])
		}
		if _, ok := fields[key[1]]; !ok {
			return fmt.Errorf("unknown field `%s`", key[1])
		}
	}
	return nil
}

func normalize(raw rawTool) (Tool, error) {
	name := strings.TrimSpace(*raw.Name)
	if name == "" {
		return Tool{}, fmt.Errorf("missing name")
	}
	method, err := parseMethod(name, *raw.Method)
	if err != nil {
		return Tool{}, err
	}
	status, err := parseStatus(name, raw.Status)
	if err != nil {
		return Tool{}, err
	}
	version := nonempty(raw.Version)
	sha256 := nonempty(raw.SHA256)
	if status != StatusPending && version == nil {
		return Tool{}, fmt.Errorf("%s: missing version", name)
	}
	switch method {
	case MethodRelease:
		if err := require(name, "repo", raw.Repo); err != nil {
			return Tool{}, err
		}
		if err := require(name, "asset", raw.Asset); err != nil {
			return Tool{}, err
		}
		if err := require(name, "checksum", raw.Checksum); err != nil {
			return Tool{}, err
		}
		if err := require(name, "bin", raw.Bin); err != nil {
			return Tool{}, err
		}
		if status != StatusPending {
			if err := require(name, "version", raw.Version); err != nil {
				return Tool{}, err
			}
		}
	case MethodVendor:
		if err := require(name, "url", raw.URL); err != nil {
			return Tool{}, err
		}
		if err := require(name, "bin", raw.Bin); err != nil {
			return Tool{}, err
		}
	case MethodBun, MethodCargo:
		if err := require(name, "package", raw.Package); err != nil {
			return Tool{}, err
		}
		if status != StatusPending {
			if err := require(name, "version", raw.Version); err != nil {
				return Tool{}, err
			}
		}
	case MethodGo:
		if err := require(name, "module", raw.Module); err != nil {
			return Tool{}, err
		}
		if status != StatusPending {
			if err := require(name, "version", raw.Version); err != nil {
				return Tool{}, err
			}
		}
	}
	if err := checkHTTPS(name, "url", raw.URL); err != nil {
		return Tool{}, err
	}
	if err := checkHTTPS(name, "sig_url", raw.SigURL); err != nil {
		return Tool{}, err
	}
	return Tool{
		Name:           name,
		Method:         method,
		Repo:           nonempty(raw.Repo),
		URL:            nonempty(raw.URL),
		SigURL:         nonempty(raw.SigURL),
		GPGFingerprint: nonempty(raw.GPGFingerprint),
		Sig:            nonempty(raw.Sig),
		KeyFile:        nonempty(raw.KeyFile),
		SHA256:         sha256,
		Version:        version,
		VersionFrom:    nonempty(raw.VersionFrom),
		Asset:          nonempty(raw.Asset),
		Checksum:       nonempty(raw.Checksum),
		Package:        nonempty(raw.Package),
		Module:         nonempty(raw.Module),
		Bin:            nonempty(raw.Bin),
		Exe:            nonempty(raw.Exe),
		Priority:       trimmed(raw.Priority),
		Group:          trimmed(raw.Group),
		Category:       trimmed(raw.Category),
		Env:            stringSlice(raw.Env),
		Probe:          stringSlice(raw.Probe),
		Status:         status,
	}, nil
}

func parseMethod(name, raw string) (Method, error) {
	switch strings.TrimSpace(raw) {
	case "release":
		return MethodRelease, nil
	case "vendor":
		return MethodVendor, nil
	case "bun":
		return MethodBun, nil
	case "go":
		return MethodGo, nil
	case "cargo":
		return MethodCargo, nil
	default:
		return 0, fmt.Errorf("%s: unknown method: %s", name, strings.TrimSpace(raw))
	}
}

func parseStatus(name string, raw *string) (Status, error) {
	if raw == nil {
		return StatusReady, nil
	}
	value := strings.TrimSpace(*raw)
	switch value {
	case "":
		return StatusReady, nil
	case "pending":
		return StatusPending, nil
	default:
		return 0, fmt.Errorf("%s: unknown status: %s", name, value)
	}
}

func require(name, field string, value *string) error {
	if _, ok := nonemptyRef(value); !ok {
		return fmt.Errorf("%s: missing %s", name, field)
	}
	return nil
}

func checkHTTPS(name, field string, value *string) error {
	text, ok := nonemptyRef(value)
	if !ok {
		return nil
	}
	if strings.HasPrefix(text, "https://") && len(text) > len("https://") && !strings.ContainsFunc(text, unicode.IsSpace) {
		return nil
	}
	return fmt.Errorf("%s: %s must be https", name, field)
}

func nonempty(value *string) *string {
	text, ok := nonemptyRef(value)
	if !ok {
		return nil
	}
	return &text
}

func nonemptyRef(value *string) (string, bool) {
	if value == nil {
		return "", false
	}
	text := strings.TrimSpace(*value)
	if text == "" {
		return "", false
	}
	return text, true
}

func trimmed(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func stringSlice(value []string) []string {
	if value == nil {
		return []string{}
	}
	out := make([]string, len(value))
	copy(out, value)
	return out
}
