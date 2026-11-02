// roster.go ports the employee roster rules: `people[].pc` and
// `people[].phone` become key names, duplicates are rejected, and `keys_path`
// (absolute, or a file name next to the module) selects the store.
package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// rosterKeyNames validates a roster's people and returns their key names.
func rosterKeyNames(people []any) ([]string, error) {
	names := make([]string, 0, len(people)*2)
	for _, raw := range people {
		person, ok := raw.(map[string]any)
		if !ok {
			return nil, newError("employee roster people must be objects")
		}
		for _, field := range []string{"pc", "phone"} {
			value, ok := person[field].(string)
			if !ok || strings.TrimSpace(value) == "" {
				return nil, newError("employee roster missing " + field)
			}
			name, err := normalizeKeyName(value)
			if err != nil {
				return nil, err
			}
			names = append(names, name)
		}
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			return nil, newError("employee roster has duplicate key names")
		}
		seen[name] = true
	}
	return names, nil
}

// loadEmployeeRoster reads the roster JSON and resolves its keys path.
func loadEmployeeRoster(paths Paths, rosterPath string) ([]string, string, error) {
	data, err := os.ReadFile(rosterPath)
	if err != nil {
		return nil, "", newError("cannot read employee roster: " + rosterPath)
	}
	var parsed any
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, "", newError("employee roster must be an object")
	}
	roster, ok := parsed.(map[string]any)
	if !ok {
		return nil, "", newError("employee roster must be an object")
	}
	people, ok := roster["people"].([]any)
	if !ok || len(people) == 0 {
		return nil, "", newError("employee roster needs people")
	}
	names, err := rosterKeyNames(people)
	if err != nil {
		return nil, "", err
	}
	keysPath := paths.KeysPath
	if rawKeys, ok := roster["keys_path"].(string); ok && rawKeys != "" {
		expanded := expandHome(rawKeys)
		if !filepath.IsAbs(expanded) {
			keysPath = filepath.Join(paths.ScriptDir, filepath.Base(expanded))
		} else {
			keysPath = expanded
		}
	}
	return names, keysPath, nil
}

// expandHome is Path.expanduser(): a leading ~ or ~/ becomes $HOME.
func expandHome(path string) string {
	if path == "~" {
		return homeDir(nil)
	}
	if strings.HasPrefix(path, "~/") {
		return filepath.Join(homeDir(nil), path[2:])
	}
	return path
}

// resolvePath is Path.expanduser().resolve() for the --dest flag: absolute,
// symlinks resolved, and nothing written.
func resolvePath(raw string) string {
	expanded := expandHome(raw)
	if absolute, err := filepath.Abs(expanded); err == nil {
		expanded = absolute
	}
	if resolved, err := filepath.EvalSymlinks(expanded); err == nil {
		return resolved
	}
	return expanded
}
