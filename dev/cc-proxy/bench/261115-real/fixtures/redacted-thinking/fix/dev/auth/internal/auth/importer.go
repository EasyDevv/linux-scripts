package auth

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"slices"
	"strings"

	"auth/internal/store"
)

// ImportReport counts what an import did. It names providers, never secrets.
type ImportReport struct {
	Imported []string
	Skipped  []string // already in the store
	Ignored  []string // not importable, with the reason
}

// FromPi copies API keys out of pi's auth.json. OAuth entries are left behind unless
// includeOAuth: a refresh token held by both pi and this store is rotated by whichever
// refreshes first, which kills the other copy. A key that is a `!command` is also left.
func (s Service) FromPi(path string, includeOAuth, overwrite bool) (ImportReport, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ImportReport{}, err
	}
	var entries map[string]struct {
		Type    string `json:"type"`
		Key     string `json:"key"`
		Access  string `json:"access"`
		Refresh string `json:"refresh"`
		Expires int64  `json:"expires"`
	}
	if err := json.Unmarshal(raw, &entries); err != nil {
		return ImportReport{}, fmt.Errorf("%s: %w", path, err)
	}
	var rep ImportReport
	for _, id := range sortedKeys(entries) {
		e := entries[id]
		var c store.Credential
		switch strings.ReplaceAll(e.Type, "-", "_") {
		case store.TypeAPIKey:
			if e.Key == "" || strings.HasPrefix(e.Key, "!") {
				rep.Ignored = append(rep.Ignored, id+" (no literal key)")
				continue
			}
			c = store.Credential{Type: store.TypeAPIKey, Key: e.Key}
		case store.TypeOAuth:
			if !includeOAuth {
				rep.Ignored = append(rep.Ignored, id+" (OAuth: run `auth login "+id+"`)")
				continue
			}
			c = store.Credential{Type: store.TypeOAuth, Access: e.Access, Refresh: e.Refresh, Expires: e.Expires}
		default:
			rep.Ignored = append(rep.Ignored, id+" (unknown type)")
			continue
		}
		if !store.ValidID(id) {
			rep.Ignored = append(rep.Ignored, id+" (invalid id)")
			continue
		}
		wrote := false
		if _, err := s.Store.Modify(id, func(cur *store.Credential) (*store.Credential, error) {
			if cur != nil && !overwrite {
				return nil, nil
			}
			wrote = true
			return &c, nil
		}); err != nil {
			return rep, err
		}
		if wrote {
			rep.Imported = append(rep.Imported, id)
		} else {
			rep.Skipped = append(rep.Skipped, id)
		}
	}
	return rep, nil
}

// FromEnvFile copies the known providers' keys out of a `NAME=value` shell file. Only the
// variable names in Known are read; the rest of the file is never looked at.
func (s Service) FromEnvFile(path string, overwrite bool) (ImportReport, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ImportReport{}, err
	}
	var rep ImportReport
	for _, p := range Known {
		if p.Env == "" {
			continue
		}
		value := EnvFileValue(string(raw), p.Env)
		if value == "" {
			continue
		}
		wrote := false
		if _, err := s.Store.Modify(p.ID, func(cur *store.Credential) (*store.Credential, error) {
			if cur != nil && !overwrite {
				return nil, nil
			}
			wrote = true
			return &store.Credential{Type: store.TypeAPIKey, Key: value}, nil
		}); err != nil {
			return rep, err
		}
		if wrote {
			rep.Imported = append(rep.Imported, p.ID)
		} else {
			rep.Skipped = append(rep.Skipped, p.ID)
		}
	}
	return rep, nil
}

// EnvFileValue is the value of one `NAME=value` (or `export NAME=value`) line; one pair of
// surrounding quotes is dropped.
func EnvFileValue(text, name string) string {
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "export "))
		key, value, ok := strings.Cut(line, "=")
		if !ok || strings.TrimSpace(key) != name {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		}
		return value
	}
	return ""
}

func sortedKeys[V any](m map[string]V) []string { return slices.Sorted(maps.Keys(m)) }
