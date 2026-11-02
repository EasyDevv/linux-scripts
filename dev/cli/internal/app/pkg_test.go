package app

import "testing"

func pkgPaths() Paths {
	paths := NewPaths("/h/cli", "/h/state", "proto")
	paths.Prefix = "/h/.local"
	return paths
}

func TestBunInstallIgnoresScriptsAndSetsTheCooldownInSeconds(t *testing.T) {
	paths := pkgPaths()
	plan := bunInstallPlan(&paths, "cf", "1.0.0-beta.26", 7)
	if plan.Program != "bun" {
		t.Fatalf("program %q", plan.Program)
	}
	want := []string{"add", "-g", "cf@1.0.0-beta.26", "--ignore-scripts", "--minimum-release-age=604800"}
	if len(plan.Args) != len(want) {
		t.Fatalf("args %v", plan.Args)
	}
	for i := range want {
		if plan.Args[i] != want[i] {
			t.Fatalf("args %v", plan.Args)
		}
	}
}

func TestGoInstallPinsTheVersionAndTargetsThePrefixBin(t *testing.T) {
	paths := pkgPaths()
	plan := goInstallPlan(&paths, "github.com/x/y/cmd/y", "1.2.3")
	if len(plan.Args) != 2 || plan.Args[0] != "install" || plan.Args[1] != "github.com/x/y/cmd/y@v1.2.3" {
		t.Fatalf("args %v", plan.Args)
	}
	if len(plan.Envs) != 1 || plan.Envs[0] != [2]string{"GOBIN", "/h/.local/bin"} {
		t.Fatalf("envs %v", plan.Envs)
	}
	again := goInstallPlan(&paths, "m", "v1.2.3")
	if again.Args[1] != "m@v1.2.3" {
		t.Fatalf("args %v", again.Args)
	}
}

func TestCargoInstallIsLockedAndRootedAtThePrefix(t *testing.T) {
	paths := pkgPaths()
	plan := cargoInstallPlan(&paths, "ripgrep", "14.1.0")
	want := []string{"install", "--locked", "--root", "/h/.local", "ripgrep@14.1.0"}
	if len(plan.Args) != len(want) {
		t.Fatalf("args %v", plan.Args)
	}
	for i := range want {
		if plan.Args[i] != want[i] {
			t.Fatalf("args %v", plan.Args)
		}
	}
	removed := cargoUninstallPlan(&paths, "ripgrep")
	wantRemove := []string{"uninstall", "--root", "/h/.local", "ripgrep"}
	if len(removed.Args) != len(wantRemove) {
		t.Fatalf("args %v", removed.Args)
	}
	for i := range wantRemove {
		if removed.Args[i] != wantRemove[i] {
			t.Fatalf("args %v", removed.Args)
		}
	}
}

func TestBunLockIntegrityReadsTheHashAfterTheEntry(t *testing.T) {
	text := `{ "packages": {
  "other": ["other@1.0.0", "", {}, "sha512-AAAA=="],
  "cf": ["cf@1.0.0-beta.26", "", { "bin": { "cf": "bin/cf" } }, "sha512-Zm9v+/bar=="],
}}`
	got, ok := bunLockIntegrity(text, "cf", "1.0.0-beta.26")
	if !ok || got != "sha512-Zm9v+/bar==" {
		t.Fatalf("got %q ok %v", got, ok)
	}
	if _, ok := bunLockIntegrity(text, "cf", "9.9.9"); ok {
		t.Fatal("expected missing")
	}
}

func TestGoRemovalRefusesPathsOutsideTheBinDir(t *testing.T) {
	paths := pkgPaths()
	entry := LockEntry{
		Method:      "go",
		Version:     "1.0.0",
		Source:      "",
		Digest:      "",
		Level:       "sumdb",
		Package:     "m",
		Bin:         "/etc/passwd",
		InstalledAt: "",
		Previous:    nil,
	}
	if err := uninstall(&paths, &entry); err == nil {
		t.Fatal("expected error")
	}
}
