package app

import (
	"path/filepath"
	"testing"
	"time"
)

var baseTime = time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC)

func TestBumpCountsAndKeepsLastFive(t *testing.T) {
	state := loadStore(filepath.Join(t.TempDir(), "recent.json"))
	dir := "/work/demo"
	// dev 7, build 4, test 3, then three single launches.
	names := []string{"check", "lint", "build", "dev", "test", "zip", "dev", "build", "dev", "test", "dev", "build", "dev", "test", "dev", "build", "dev"}
	for i, name := range names {
		state.bump(dir, name, baseTime.Add(time.Duration(i)*time.Minute))
	}
	top := state.top(dir, []string{"dev", "build", "test", "lint", "check", "zip"}, recentLimit)
	if len(top) != recentLimit {
		t.Fatalf("top = %d entries, want %d", len(top), recentLimit)
	}
	if top[0].Name != "dev" || top[0].Count != 7 {
		t.Fatalf("first = %+v", top[0])
	}
	if top[1].Name != "build" || top[1].Count != 4 {
		t.Fatalf("second = %+v", top[1])
	}
	if top[2].Name != "test" || top[2].Count != 3 {
		t.Fatalf("third = %+v", top[2])
	}
	// The three single launches tie on count, so recency decides: zip, lint, check.
	if top[3].Name != "zip" || top[4].Name != "lint" {
		t.Fatalf("tie order = %v", []string{top[3].Name, top[4].Name})
	}
}

func TestTopDropsScriptsNoLongerInPackage(t *testing.T) {
	state := loadStore(filepath.Join(t.TempDir(), "recent.json"))
	state.bump("/work/demo", "gone", baseTime)
	state.bump("/work/demo", "dev", baseTime)
	top := state.top("/work/demo", []string{"dev"}, recentLimit)
	if len(top) != 1 || top[0].Name != "dev" {
		t.Fatalf("top = %+v", top)
	}
}

func TestTopTieBreaksOnRecencyThenName(t *testing.T) {
	state := loadStore(filepath.Join(t.TempDir(), "recent.json"))
	state.bump("/work/demo", "b", baseTime.Add(time.Minute))
	state.bump("/work/demo", "a", baseTime.Add(2*time.Minute))
	top := state.top("/work/demo", []string{"a", "b"}, recentLimit)
	if len(top) != 2 || top[0].Name != "a" {
		t.Fatalf("top = %+v", top)
	}
}

func TestStoreRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "recent.json")
	state := loadStore(path)
	state.bump("/work/demo", "dev", baseTime)
	if err := saveStore(path, state); err != nil {
		t.Fatalf("saveStore: %v", err)
	}
	again := loadStore(path)
	top := again.top("/work/demo", []string{"dev"}, recentLimit)
	if len(top) != 1 || top[0].Count != 1 {
		t.Fatalf("reloaded = %+v", top)
	}
}

func TestStoreTrimKeepsHistoryBounded(t *testing.T) {
	state := loadStore(filepath.Join(t.TempDir(), "recent.json"))
	for i := 0; i < historyKeep+10; i++ {
		state.bump("/work/demo", string(rune('a'+i)), baseTime)
	}
	if got := len(state.Projects["/work/demo"]); got > historyKeep {
		t.Fatalf("kept %d entries, want <= %d", got, historyKeep)
	}
}

func TestLoadStoreIgnoresCorruptFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "recent.json")
	writeFile(t, path, "{not json")
	state := loadStore(path)
	if len(state.Projects) != 0 {
		t.Fatalf("projects = %v", state.Projects)
	}
}
