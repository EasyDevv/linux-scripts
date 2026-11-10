package app

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func TestLoadKeepsScriptOrder(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "package.json")
	writeFile(t, file, `{
	  "name": "demo",
	  "version": "1.0.0",
	  "dependencies": {"left-pad": "1.0.0"},
	  "scripts": {
	    "dev": "vite dev",
	    "build": "vite build",
	    "test:unit": "vitest run"
	  },
	  "devDependencies": {"left-pad": "1.0.0"}
	}`)

	pkg, err := Load(file)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if pkg.Name != "demo" {
		t.Fatalf("name = %q", pkg.Name)
	}
	want := []string{"dev", "build", "test:unit"}
	got := pkg.Names()
	if len(got) != len(want) {
		t.Fatalf("names = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("names = %v, want %v", got, want)
		}
	}
	if pkg.Scripts[2].Command != "vitest run" {
		t.Fatalf("command = %q", pkg.Scripts[2].Command)
	}
}

func TestLoadToleratesNullAndMissingScripts(t *testing.T) {
	dir := t.TempDir()
	for name, body := range map[string]string{
		"null.json":    `{"name":"n","scripts":null}`,
		"missing.json": `{"name":"m"}`,
	} {
		file := filepath.Join(dir, name)
		writeFile(t, file, body)
		pkg, err := Load(file)
		if err != nil {
			t.Fatalf("%s: Load: %v", name, err)
		}
		if len(pkg.Scripts) != 0 {
			t.Fatalf("%s: scripts = %v", name, pkg.Names())
		}
	}
}

func TestDiscoverWalksUpToScripts(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "package.json"), `{"name":"root","scripts":{"dev":"echo dev"}}`)
	nested := filepath.Join(root, "apps", "client", "src")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	pkg, err := Discover(nested)
	if err != nil {
		t.Fatalf("Discover: %v", err)
	}
	if pkg.Dir != root {
		t.Fatalf("dir = %q, want %q", pkg.Dir, root)
	}
	if len(pkg.Scripts) != 1 || pkg.Scripts[0].Name != "dev" {
		t.Fatalf("scripts = %v", pkg.Names())
	}
}

// A package.json without scripts in the way must not stop the walk: the
// nearest one with scripts wins.
func TestDiscoverSkipsPackageWithoutScripts(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "package.json"), `{"name":"root","scripts":{"build":"echo build"}}`)
	inner := filepath.Join(root, "tool")
	writeFile(t, filepath.Join(inner, "package.json"), `{"name":"tool"}`)
	pkg, err := Discover(inner)
	if err != nil {
		t.Fatalf("Discover: %v", err)
	}
	if pkg.Dir != root {
		t.Fatalf("dir = %q, want %q", pkg.Dir, root)
	}
}

func TestDiscoverReportsMissingPackage(t *testing.T) {
	dir := t.TempDir()
	if _, err := Discover(dir); err == nil {
		t.Fatal("expected an error when no package.json has scripts")
	}
}

func TestDetectPM(t *testing.T) {
	cases := []struct {
		name           string
		packageManager string
		lock           string
		want           string
	}{
		{"field wins", "pnpm@9.1.0", "bun.lock", "pnpm"},
		{"bun lock", "", "bun.lock", "bun"},
		{"pnpm lock", "", "pnpm-lock.yaml", "pnpm"},
		{"yarn lock", "", "yarn.lock", "yarn"},
		{"npm lock", "", "package-lock.json", "npm"},
		{"no lock defaults to bun", "", "", "bun"},
	}
	for _, tc := range cases {
		dir := t.TempDir()
		if tc.lock != "" {
			writeFile(t, filepath.Join(dir, tc.lock), "")
		}
		if got := detectPM(dir, tc.packageManager); got != tc.want {
			t.Fatalf("%s: pm = %q, want %q", tc.name, got, tc.want)
		}
	}
}
