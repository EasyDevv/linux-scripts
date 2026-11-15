// Package store is the central credential file: one JSON document, written only through
// Modify (flock + temp file + rename) so every reader sees a complete file.
package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"syscall"
	"time"
)

const (
	TypeAPIKey = "api_key"
	TypeOAuth  = "oauth"

	// Version is the file format. A reader rejects any other value instead of guessing.
	Version = 1
)

// Credential is one provider's login. `Expires` is epoch milliseconds and already includes the
// refresh skew, so a reader treats `Expires <= now` as expired.
type Credential struct {
	Type    string            `json:"type"`
	Key     string            `json:"key,omitempty"`
	Access  string            `json:"access,omitempty"`
	Refresh string            `json:"refresh,omitempty"`
	Expires int64             `json:"expires,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
}

// Expired reports an OAuth credential whose access token can no longer be used.
func (c Credential) Expired(now time.Time) bool {
	return c.Type == TypeOAuth && c.Expires <= now.UnixMilli()
}

type document struct {
	Version     int                   `json:"version"`
	Credentials map[string]Credential `json:"credentials"`
}

var providerID = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)

// ValidID reports whether id may be a provider id.
func ValidID(id string) bool { return providerID.MatchString(id) }

type Store struct{ Path string }

// DefaultPath is `$AUTH_FILE`, else `$XDG_CONFIG_HOME/auth/credentials.json`, else
// `~/.config/auth/credentials.json`.
func DefaultPath(getenv func(string) string) (string, error) {
	if p := getenv("AUTH_FILE"); p != "" {
		return p, nil
	}
	if dir := getenv("XDG_CONFIG_HOME"); dir != "" {
		return filepath.Join(dir, "auth", "credentials.json"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "auth", "credentials.json"), nil
}

func (s Store) read() (document, error) {
	raw, err := os.ReadFile(s.Path)
	if errors.Is(err, os.ErrNotExist) {
		return document{Version: Version, Credentials: map[string]Credential{}}, nil
	}
	if err != nil {
		return document{}, err
	}
	var doc document
	if err := json.Unmarshal(raw, &doc); err != nil {
		return document{}, fmt.Errorf("%s is not valid JSON: %w", s.Path, err)
	}
	if doc.Version != Version {
		return document{}, fmt.Errorf("%s has format version %d, expected %d", s.Path, doc.Version, Version)
	}
	if doc.Credentials == nil {
		doc.Credentials = map[string]Credential{}
	}
	return doc, nil
}

// List returns every stored credential.
func (s Store) List() (map[string]Credential, error) {
	doc, err := s.read()
	return doc.Credentials, err
}

// Read returns one credential, if stored.
func (s Store) Read(id string) (Credential, bool, error) {
	all, err := s.List()
	if err != nil {
		return Credential{}, false, err
	}
	c, ok := all[id]
	return c, ok, nil
}

// IDs lists the stored provider ids, sorted.
func (s Store) IDs() ([]string, error) {
	all, err := s.List()
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(all))
	for id := range all {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids, nil
}

// Modify is the only write path. fn sees the current credential (nil when absent) under an
// exclusive lock and returns the new one; returning nil keeps the entry as it is.
func (s Store) Modify(id string, fn func(current *Credential) (*Credential, error)) (*Credential, error) {
	if !ValidID(id) {
		return nil, fmt.Errorf("invalid provider id %q", id)
	}
	unlock, err := s.lock()
	if err != nil {
		return nil, err
	}
	defer unlock()
	doc, err := s.read()
	if err != nil {
		return nil, err
	}
	var current *Credential
	if c, ok := doc.Credentials[id]; ok {
		current = &c
	}
	next, err := fn(current)
	if err != nil {
		return nil, err
	}
	if next == nil {
		return current, nil
	}
	doc.Credentials[id] = *next
	if err := s.write(doc); err != nil {
		return nil, err
	}
	return next, nil
}

// Delete removes a credential; an absent one is not an error.
func (s Store) Delete(id string) error {
	unlock, err := s.lock()
	if err != nil {
		return err
	}
	defer unlock()
	doc, err := s.read()
	if err != nil {
		return err
	}
	if _, ok := doc.Credentials[id]; !ok {
		return nil
	}
	delete(doc.Credentials, id)
	return s.write(doc)
}

func (s Store) lock() (func(), error) {
	if err := os.MkdirAll(filepath.Dir(s.Path), 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(s.Path+".lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(30 * time.Second)
	for {
		err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return func() { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN); _ = f.Close() }, nil
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) || time.Now().After(deadline) {
			_ = f.Close()
			if errors.Is(err, syscall.EWOULDBLOCK) {
				return nil, errors.New("credential file is locked by another process")
			}
			return nil, err
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func (s Store) write(doc document) error {
	doc.Version = Version
	body, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.Path), ".credentials-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	cleanup := func() { _ = tmp.Close(); _ = os.Remove(name) }
	if err := tmp.Chmod(0o600); err != nil {
		cleanup()
		return err
	}
	if _, err := tmp.Write(append(body, '\n')); err != nil {
		cleanup()
		return err
	}
	if err := tmp.Sync(); err != nil {
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(name)
		return err
	}
	if err := os.Rename(name, s.Path); err != nil {
		_ = os.Remove(name)
		return err
	}
	return nil
}
