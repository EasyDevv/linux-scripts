package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// recentLimit is how many recent scripts sit at the top of the list.
const recentLimit = 5

// historyKeep is how many entries per project the store keeps on disk.
const historyKeep = 20

// storeVersion is the on-disk schema version.
const storeVersion = 1

// recentFile is one script's record on disk.
type recentFile struct {
	Count int    `json:"count"`
	Last  string `json:"last"`
}

// store is the whole recent file: projects keyed by absolute package dir.
type store struct {
	Version  int                              `json:"version"`
	Projects map[string]map[string]recentFile `json:"projects"`
}

// recentEntry is one row of the in-memory ranking.
type recentEntry struct {
	Name  string
	Count int
	Last  string
}

// loadStore reads the state file. A missing, unreadable, or corrupt file
// starts empty: the store is a convenience, never a reason to fail.
func loadStore(path string) store {
	empty := store{Version: storeVersion, Projects: map[string]map[string]recentFile{}}
	data, err := os.ReadFile(path)
	if err != nil {
		return empty
	}
	var loaded store
	if err := json.Unmarshal(data, &loaded); err != nil {
		return empty
	}
	if loaded.Projects == nil {
		loaded.Projects = map[string]map[string]recentFile{}
	}
	loaded.Version = storeVersion
	return loaded
}

// bump records one launch of name under dir and trims the history.
func (s *store) bump(dir, name string, now time.Time) {
	if s.Projects == nil {
		s.Projects = map[string]map[string]recentFile{}
	}
	project := s.Projects[dir]
	if project == nil {
		project = map[string]recentFile{}
		s.Projects[dir] = project
	}
	record := project[name]
	record.Count++
	record.Last = now.UTC().Format(time.RFC3339)
	project[name] = record
	s.trim(dir)
}

// trim keeps the top historyKeep entries of one project.
func (s *store) trim(dir string) {
	project := s.Projects[dir]
	if len(project) <= historyKeep {
		return
	}
	entries := make([]recentEntry, 0, len(project))
	for name, record := range project {
		entries = append(entries, recentEntry{Name: name, Count: record.Count, Last: record.Last})
	}
	keep := map[string]recentFile{}
	for _, name := range sortRecent(entries)[:historyKeep] {
		keep[name] = project[name]
	}
	s.Projects[dir] = keep
}

// top returns the most used scripts of dir, limited to names still in the
// package. A script removed from package.json drops out of Recent.
func (s store) top(dir string, available []string, limit int) []recentEntry {
	project := s.Projects[dir]
	if len(project) == 0 {
		return nil
	}
	present := make(map[string]bool, len(available))
	for _, name := range available {
		present[name] = true
	}
	entries := make([]recentEntry, 0, len(project))
	for name, record := range project {
		if !present[name] {
			continue
		}
		entries = append(entries, recentEntry{Name: name, Count: record.Count, Last: record.Last})
	}
	names := sortRecent(entries)
	if len(names) > limit {
		names = names[:limit]
	}
	out := make([]recentEntry, 0, len(names))
	for _, name := range names {
		out = append(out, recentEntry{Name: name, Count: project[name].Count, Last: project[name].Last})
	}
	return out
}

// saveStore writes the state file atomically. A failure is reported by the
// caller and never stops the script from running.
func saveStore(path string, s store) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	s.Version = storeVersion
	if s.Projects == nil {
		s.Projects = map[string]map[string]recentFile{}
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".recent-*.json")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return err
	}
	return nil
}

// defaultStatePath is ~/.local/share/pk/recent.json unless PK_STATE names a file.
func defaultStatePath() string {
	if path := os.Getenv("PK_STATE"); path != "" {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".local", "share", "pk", "recent.json")
}
