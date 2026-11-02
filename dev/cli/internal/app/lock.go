// lock.go ports cli-rust/src/lock.rs.
//
// Exported: LockFile, LockEntry, LoadLockFile, Save, Guard, AcquireGuard, Close.
// JSON field names match serde (digest alias sha256 on read; both keys is an error;
// method/version/source/level/bin/installed_at/digest required; previous omitted when nil;
// tools null is an error; tools keys sorted like BTreeMap).
// AcquireGuard uses syscall.Flock(LOCK_EX|LOCK_NB).
// Rust drops Guard to release the lock; Go has no Drop, so callers must Close (defer).

package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"syscall"
)

type LockFile struct {
	Version uint32               `json:"version"`
	Tools   map[string]LockEntry `json:"tools"`
}

type LockEntry struct {
	Method      string  `json:"method"`
	Version     string  `json:"version"`
	Source      string  `json:"source"`
	Digest      string  `json:"digest"`
	Level       string  `json:"level"`
	Package     string  `json:"package"`
	Bin         string  `json:"bin"`
	InstalledAt string  `json:"installed_at"`
	Previous    *string `json:"previous,omitempty"`
}

// LoadLockFile is LockFile::load. A missing file is an empty lock at version 1.
func LoadLockFile(path string) (LockFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return LockFile{Version: 1, Tools: map[string]LockEntry{}}, nil
		}
		return LockFile{}, fmt.Errorf("read %s: %w", path, err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return LockFile{}, fmt.Errorf("invalid lock file %s: %w", path, err)
	}
	lf := LockFile{Version: 1, Tools: map[string]LockEntry{}}
	if v, ok := raw["version"]; ok {
		if err := json.Unmarshal(v, &lf.Version); err != nil {
			return LockFile{}, fmt.Errorf("invalid lock file %s: %w", path, err)
		}
	}
	if v, ok := raw["tools"]; ok {
		if string(bytes.TrimSpace(v)) == "null" {
			return LockFile{}, fmt.Errorf("invalid lock file %s: invalid type: null, expected a map", path)
		}
		if err := json.Unmarshal(v, &lf.Tools); err != nil {
			return LockFile{}, fmt.Errorf("invalid lock file %s: %w", path, err)
		}
		if lf.Tools == nil {
			lf.Tools = map[string]LockEntry{}
		}
	}
	return lf, nil
}

func (e *LockEntry) UnmarshalJSON(data []byte) error {
	var present map[string]json.RawMessage
	if err := json.Unmarshal(data, &present); err != nil {
		return err
	}
	_, hasDigest := present["digest"]
	_, hasSHA := present["sha256"]
	if hasDigest && hasSHA {
		return fmt.Errorf("duplicate field `digest`")
	}
	if !hasDigest && !hasSHA {
		return fmt.Errorf("missing field `digest`")
	}
	for _, key := range []string{"method", "version", "source", "level", "bin", "installed_at"} {
		if _, ok := present[key]; !ok {
			return fmt.Errorf("missing field `%s`", key)
		}
	}
	var raw struct {
		Method      string  `json:"method"`
		Version     string  `json:"version"`
		Source      string  `json:"source"`
		Digest      *string `json:"digest"`
		SHA256      *string `json:"sha256"`
		Level       string  `json:"level"`
		Package     string  `json:"package"`
		Bin         string  `json:"bin"`
		InstalledAt string  `json:"installed_at"`
		Previous    *string `json:"previous"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	e.Method = raw.Method
	e.Version = raw.Version
	e.Source = raw.Source
	switch {
	case raw.Digest != nil:
		e.Digest = *raw.Digest
	case raw.SHA256 != nil:
		e.Digest = *raw.SHA256
	default:
		return fmt.Errorf("missing field `digest`")
	}
	e.Level = raw.Level
	e.Package = raw.Package
	e.Bin = raw.Bin
	e.InstalledAt = raw.InstalledAt
	e.Previous = raw.Previous
	return nil
}

// Save is LockFile::save. Writes path with extension json.tmp, then renames over path.
func (f LockFile) Save(path string) error {
	if err := mkdirParent(path); err != nil {
		return err
	}
	if f.Tools == nil {
		f.Tools = map[string]LockEntry{}
	}
	body, err := marshalLockFile(f)
	if err != nil {
		return err
	}
	tmp := withExtension(path, "json.tmp")
	if err := os.WriteFile(tmp, body, 0o666); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	return nil
}

func marshalLockFile(f LockFile) ([]byte, error) {
	type file struct {
		Version uint32           `json:"version"`
		Tools   orderedLockTools `json:"tools"`
	}
	raw, err := marshalJSONNoHTML(file{Version: f.Version, Tools: orderedLockTools(f.Tools)})
	if err != nil {
		return nil, err
	}
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, raw, "", "  "); err != nil {
		return nil, err
	}
	pretty.WriteByte('\n')
	return pretty.Bytes(), nil
}

type orderedLockTools map[string]LockEntry

func (m orderedLockTools) MarshalJSON() ([]byte, error) {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, k := range keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		kb, err := marshalJSONNoHTML(k)
		if err != nil {
			return nil, err
		}
		vb, err := marshalJSONNoHTML(m[k])
		if err != nil {
			return nil, err
		}
		buf.Write(kb)
		buf.WriteByte(':')
		buf.Write(vb)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

func marshalJSONNoHTML(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// Guard holds an exclusive non-blocking flock until Close.
type Guard struct {
	file *os.File
	path string
}

// AcquireGuard is Guard::acquire. The lock file is lock.json → lock.json.flock.
// Another holder fails immediately with "another cli command is running (lock held: ...)".
func AcquireGuard(lockJSON string) (*Guard, error) {
	if err := mkdirParent(lockJSON); err != nil {
		return nil, err
	}
	path := withExtension(lockJSON, "json.flock")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o666)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, fmt.Errorf("another cli command is running (lock held: %s)", path)
	}
	return &Guard{file: file, path: path}, nil
}

// Close releases the flock. Idempotent. Rust releases on Drop; callers must Close.
func (g *Guard) Close() error {
	if g == nil || g.file == nil {
		return nil
	}
	err := g.file.Close()
	g.file = nil
	return err
}
