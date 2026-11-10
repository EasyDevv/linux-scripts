// Package app turns `pk` arguments into a picker or a single script run.
//
// Discovery reads the nearest package.json upward from the working directory,
// the recent store records scripts launched through pk, and the runner hands
// the terminal to the package manager.
package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Package is one package.json that has scripts.
type Package struct {
	// File is the absolute path to package.json.
	File string
	// Dir is where the script runs.
	Dir string
	// Name is package.json's name field when present.
	Name string
	// Scripts keeps package.json order.
	Scripts []Script
	// PM is the package manager that runs the scripts.
	PM string
}

// Script is one entry of package.json's scripts object.
type Script struct {
	Name    string
	Command string
}

// Names returns the script names in package.json order.
func (p Package) Names() []string {
	names := make([]string, 0, len(p.Scripts))
	for _, s := range p.Scripts {
		names = append(names, s.Name)
	}
	return names
}

// errNoPackage means no package.json with scripts was found walking up.
func errNoPackage(start string) error {
	return fmt.Errorf("package.json에 scripts가 없습니다: %s에서 상위로 찾지 못함", start)
}

// Discover walks up from start and loads the first package.json that has
// scripts. It stops at the filesystem root and after maxDepth levels.
func Discover(start string) (Package, error) {
	const maxDepth = 12
	dir, err := filepath.Abs(start)
	if err != nil {
		return Package{}, err
	}
	for depth := 0; depth < maxDepth; depth++ {
		file := filepath.Join(dir, "package.json")
		if info, statErr := os.Stat(file); statErr == nil && !info.IsDir() {
			pkg, loadErr := Load(file)
			if loadErr != nil {
				return Package{}, loadErr
			}
			if len(pkg.Scripts) > 0 {
				return pkg, nil
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return Package{}, errNoPackage(start)
}

// Load reads one package.json. Script order follows the file, which a plain
// map decode would lose.
func Load(file string) (Package, error) {
	data, err := os.ReadFile(file)
	if err != nil {
		return Package{}, fmt.Errorf("package.json 읽기 실패: %w", err)
	}
	scripts, err := decodeScripts(data)
	if err != nil {
		return Package{}, fmt.Errorf("%s: %w", file, err)
	}
	var meta struct {
		Name           string `json:"name"`
		PackageManager string `json:"packageManager"`
	}
	if err := json.Unmarshal(data, &meta); err != nil {
		return Package{}, fmt.Errorf("%s: %w", file, err)
	}
	dir := filepath.Dir(file)
	return Package{
		File:    file,
		Dir:     dir,
		Name:    meta.Name,
		Scripts: scripts,
		PM:      detectPM(dir, meta.PackageManager),
	}, nil
}

// decodeScripts reads the scripts object in file order.
func decodeScripts(data []byte) ([]Script, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	if _, err := dec.Token(); err != nil {
		return nil, err
	}
	var scripts []Script
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		key, _ := tok.(string)
		if key != "scripts" {
			var skip json.RawMessage
			if err := dec.Decode(&skip); err != nil {
				return nil, err
			}
			continue
		}
		open, err := dec.Token()
		if err != nil {
			return nil, err
		}
		if open == nil { // "scripts": null
			continue
		}
		for dec.More() {
			nameTok, err := dec.Token()
			if err != nil {
				return nil, err
			}
			name, _ := nameTok.(string)
			var command any
			if err := dec.Decode(&command); err != nil {
				return nil, err
			}
			scripts = append(scripts, Script{Name: name, Command: scriptCommand(command)})
		}
		if _, err := dec.Token(); err != nil { // closing '}'
			return nil, err
		}
	}
	return scripts, nil
}

func scriptCommand(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case nil:
		return ""
	default:
		raw, err := json.Marshal(v)
		if err != nil {
			return ""
		}
		return string(raw)
	}
}

// detectPM picks the package manager: the packageManager field wins, then a
// lock file, then bun (the default on this machine).
func detectPM(dir, packageManager string) string {
	if name, _, ok := strings.Cut(packageManager, "@"); ok && name != "" {
		return name
	}
	candidates := []struct{ file, pm string }{
		{"bun.lock", "bun"},
		{"bun.lockb", "bun"},
		{"pnpm-lock.yaml", "pnpm"},
		{"yarn.lock", "yarn"},
		{"package-lock.json", "npm"},
	}
	for _, c := range candidates {
		if _, err := os.Stat(filepath.Join(dir, c.file)); err == nil {
			return c.pm
		}
	}
	return "bun"
}

// sortRecent orders names by use count, then recency, then name.
func sortRecent(entries []recentEntry) []string {
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].Count != entries[j].Count {
			return entries[i].Count > entries[j].Count
		}
		if entries[i].Last != entries[j].Last {
			return entries[i].Last > entries[j].Last
		}
		return entries[i].Name < entries[j].Name
	})
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name)
	}
	return names
}
