package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type installYes struct{}

func (installYes) Interactive() bool   { return true }
func (installYes) Confirm(string) bool { return true }

type installNoTty struct{}

func (installNoTty) Interactive() bool   { return false }
func (installNoTty) Confirm(string) bool { return false }

func installSetup(t *testing.T, name string) (Paths, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), name)
	if err := os.MkdirAll(dir, 0o777); err != nil {
		t.Fatal(err)
	}
	log := filepath.Join(dir, "calls.log")
	fake := filepath.Join(dir, "proto")
	script := fmt.Sprintf("#!/bin/sh\necho \"$@\" >> %s\n", log)
	if err := os.WriteFile(fake, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return NewPaths(filepath.Join(dir, "home"), filepath.Join(dir, "state"), fake), log
}

func installEnv(paths *Paths, prompt Prompt, yes, dryRun bool) *Env {
	return &Env{
		Paths:        paths,
		ManifestPath: "/nonexistent",
		CooldownDays: 7,
		Yes:          yes,
		DryRun:       dryRun,
		Prompt:       prompt,
		Now:          time.Now().UTC(),
	}
}

func installSeed(t *testing.T, paths Paths) {
	t.Helper()
	if err := paths.EnsureCliHome(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.PluginFile("lite"), []byte("name = \"lite\"\n"), 0o666); err != nil {
		t.Fatal(err)
	}
	lock, err := LoadLockFile(paths.LockJSON())
	if err != nil {
		t.Fatal(err)
	}
	lock.Tools["lite"] = LockEntry{
		Method:      "release",
		Version:     "1.0.0",
		Source:      "https://github.com/o/r/x",
		Digest:      strings.Repeat("a", 64),
		Level:       "checksum",
		Package:     "",
		Bin:         "/x/shims/lite",
		InstalledAt: "2026-11-02T00:00:00+00:00",
	}
	if err := lock.Save(paths.LockJSON()); err != nil {
		t.Fatal(err)
	}
}

func TestRemoveUninstallsUnregistersAndForgets(t *testing.T) {
	paths, log := installSetup(t, "remove")
	installSeed(t, paths)
	outcome, err := removeTool(installEnv(&paths, installYes{}, true, false), "lite")
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Kind != OutcomeRemoved {
		t.Fatalf("outcome %#v", outcome)
	}
	calls, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	text := string(calls)
	if !strings.Contains(text, "uninstall lite 1.0.0") {
		t.Fatalf("calls %s", text)
	}
	if !strings.Contains(text, "plugin remove lite --from global") {
		t.Fatalf("calls %s", text)
	}
	if _, err := os.Stat(paths.PluginFile("lite")); !os.IsNotExist(err) {
		t.Fatalf("plugin file still present: %v", err)
	}
	loaded, err := LoadLockFile(paths.LockJSON())
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Tools) != 0 {
		t.Fatalf("tools %#v", loaded.Tools)
	}
}

func TestRemoveDryRunChangesNothing(t *testing.T) {
	paths, log := installSetup(t, "dry")
	installSeed(t, paths)
	outcome, err := removeTool(installEnv(&paths, installYes{}, false, true), "lite")
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Kind != OutcomeDryRun {
		t.Fatalf("outcome %#v", outcome)
	}
	if _, err := os.Stat(log); !os.IsNotExist(err) {
		t.Fatalf("log exists: %v", err)
	}
	if _, err := os.Stat(paths.PluginFile("lite")); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadLockFile(paths.LockJSON())
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Tools) != 1 {
		t.Fatalf("tools %d", len(loaded.Tools))
	}
}

func TestRemoveWithoutTtyOrYesIsRefusedAndChangesNothing(t *testing.T) {
	paths, log := installSetup(t, "notty")
	installSeed(t, paths)
	_, err := removeTool(installEnv(&paths, installNoTty{}, false, false), "lite")
	if err == nil || !strings.Contains(err.Error(), "승인이 필요") {
		t.Fatalf("err %v", err)
	}
	if _, statErr := os.Stat(log); !os.IsNotExist(statErr) {
		t.Fatalf("log exists: %v", statErr)
	}
	loaded, err := LoadLockFile(paths.LockJSON())
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Tools) != 1 {
		t.Fatalf("tools %d", len(loaded.Tools))
	}
}

func TestRemoveOfAnUnrecordedToolIsRefused(t *testing.T) {
	paths, log := installSetup(t, "unknown")
	if err := paths.EnsureCliHome(); err != nil {
		t.Fatal(err)
	}
	_, err := removeTool(installEnv(&paths, installYes{}, true, false), "ghost")
	if err == nil || !strings.Contains(err.Error(), "기록이 없습니다") {
		t.Fatalf("err %v", err)
	}
	if _, statErr := os.Stat(log); !os.IsNotExist(statErr) {
		t.Fatalf("log exists: %v", statErr)
	}
}

func TestASecondCliHoldingTheLockBlocksRemoveBeforeAnythingChanges(t *testing.T) {
	paths, log := installSetup(t, "locked")
	installSeed(t, paths)
	held, err := AcquireGuard(paths.LockJSON())
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()
	if _, err := removeTool(installEnv(&paths, installYes{}, true, false), "lite"); err == nil {
		t.Fatal("expected lock error")
	}
	if _, statErr := os.Stat(log); !os.IsNotExist(statErr) {
		t.Fatalf("log exists: %v", statErr)
	}
}
