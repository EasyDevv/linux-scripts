package app

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func lockTmp(t *testing.T) string {
	t.Helper()
	return t.TempDir()
}

func lockEntry() LockEntry {
	return LockEntry{
		Method:      "release",
		Version:     "0.5.17",
		Source:      "https://github.com/o/r/releases/download/v0.5.17/a.tgz",
		Digest:      strings.Repeat("a", 64),
		Level:       "checksum",
		Package:     "",
		Bin:         "/home/u/.proto/shims/lite",
		InstalledAt: "2026-11-02T00:00:00+00:00",
		Previous:    nil,
	}
}

func TestMissingFileLoadsAsEmptyAndRoundtrips(t *testing.T) {
	dir := lockTmp(t)
	path := filepath.Join(dir, "state", "lock.json")
	lock, err := LoadLockFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(lock.Tools) != 0 {
		t.Fatalf("missing file tools = %#v, want empty", lock.Tools)
	}
	lock.Tools["lite"] = lockEntry()
	if err := lock.Save(path); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadLockFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(loaded, lock) {
		t.Fatalf("roundtrip\n got: %#v\nwant: %#v", loaded, lock)
	}
	// Rust Path::with_extension("json.tmp") on lock.json is lock.json.tmp.
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Fatalf("tmp file still present: %v", err)
	}
}

func TestCorruptFileIsAnError(t *testing.T) {
	dir := lockTmp(t)
	path := filepath.Join(dir, "lock.json")
	if err := os.WriteFile(path, []byte("{ nope"), 0o666); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadLockFile(path); err == nil {
		t.Fatal("corrupt lock file loaded")
	}
}

func TestSecondGuardIsRefusedUntilTheFirstDrops(t *testing.T) {
	dir := lockTmp(t)
	path := filepath.Join(dir, "lock.json")
	first, err := AcquireGuard(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := AcquireGuard(path); err == nil || !strings.Contains(err.Error(), "another cli command is running") {
		t.Fatalf("second guard = %v, want lock held", err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	second, err := AcquireGuard(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := second.Close(); err != nil {
		t.Fatal(err)
	}
}
