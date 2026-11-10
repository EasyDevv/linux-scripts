package app

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"pk/internal/ui"
)

// fake is one Env with every process boundary replaced: no terminal, no
// package manager, no clock.
type fake struct {
	env      Env
	out      *bytes.Buffer
	errOut   *bytes.Buffer
	commands []Command
	items    []ui.Item
	options  ui.Options
	picked   bool
	pickID   string
	pickErr  error
	now      time.Time
}

func newFake(t *testing.T, dir, statePath string) *fake {
	t.Helper()
	f := &fake{
		out:    &bytes.Buffer{},
		errOut: &bytes.Buffer{},
		now:    baseTime,
	}
	f.env = Env{
		Stdout:    f.out,
		Stderr:    f.errOut,
		Getwd:     func() (string, error) { return dir, nil },
		StatePath: statePath,
		Now:       func() time.Time { return f.now },
		Pick: func(items []ui.Item, opts ui.Options) (ui.Result, error) {
			f.picked = true
			f.items = items
			f.options = opts
			if f.pickErr != nil {
				return ui.Result{}, f.pickErr
			}
			return ui.Result{ID: f.pickID}, nil
		},
		Exec: func(cmd Command) int {
			f.commands = append(f.commands, cmd)
			return exitOK
		},
	}
	return f
}

func demoProject(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "package.json"),
		`{"name":"demo","scripts":{"dev":"vite dev","build":"vite build","lint":"eslint ."}}`)
	return dir
}

func TestRunPickerRunsSelectedScript(t *testing.T) {
	dir := demoProject(t)
	statePath := filepath.Join(t.TempDir(), "recent.json")
	f := newFake(t, dir, statePath)
	f.pickID = "build"

	if code := Run(nil, f.env); code != exitOK {
		t.Fatalf("exit = %d, stderr = %q", code, f.errOut.String())
	}
	if len(f.commands) != 1 {
		t.Fatalf("commands = %+v", f.commands)
	}
	got := f.commands[0]
	if got.PM != "bun" || got.Script != "build" || got.Dir != dir {
		t.Fatalf("command = %+v", got)
	}
	if len(f.items) != 3 || f.items[0].ID != "dev" {
		t.Fatalf("items = %+v", f.items)
	}
	if f.options.Title != "demo" {
		t.Fatalf("title = %q", f.options.Title)
	}
}

// The second run puts the first run's script in the Recent section.
func TestRunSecondLaunchShowsRecent(t *testing.T) {
	dir := demoProject(t)
	statePath := filepath.Join(t.TempDir(), "recent.json")

	first := newFake(t, dir, statePath)
	first.pickID = "lint"
	if code := Run(nil, first.env); code != exitOK {
		t.Fatalf("first exit = %d", code)
	}

	second := newFake(t, dir, statePath)
	second.pickID = "dev"
	if code := Run(nil, second.env); code != exitOK {
		t.Fatalf("second exit = %d", code)
	}
	if len(second.items) != 3 {
		t.Fatalf("items = %+v", second.items)
	}
	if second.items[0].ID != "lint" {
		t.Fatalf("first item = %+v, want the recent script", second.items[0])
	}
	if !strings.HasPrefix(second.items[0].Group, "Recent") {
		t.Fatalf("group = %q", second.items[0].Group)
	}
	if second.items[0].Detail == "" {
		t.Fatal("a recent row keeps its command detail")
	}
}

func TestRunDirectScriptSkipsPicker(t *testing.T) {
	dir := demoProject(t)
	f := newFake(t, dir, filepath.Join(t.TempDir(), "recent.json"))
	f.pickID = "dev"

	if code := Run([]string{"build", "--minify"}, f.env); code != exitOK {
		t.Fatalf("exit = %d, stderr = %q", code, f.errOut.String())
	}
	if f.picked {
		t.Fatal("a named script must not open the picker")
	}
	got := f.commands[0]
	if got.Script != "build" || len(got.Args) != 1 || got.Args[0] != "--minify" {
		t.Fatalf("command = %+v", got)
	}
}

func TestRunUnknownScriptFails(t *testing.T) {
	dir := demoProject(t)
	f := newFake(t, dir, filepath.Join(t.TempDir(), "recent.json"))

	if code := Run([]string{"nope"}, f.env); code != exitFailure {
		t.Fatalf("exit = %d, want %d", code, exitFailure)
	}
	if len(f.commands) != 0 {
		t.Fatalf("commands = %+v", f.commands)
	}
	if !strings.Contains(f.errOut.String(), "dev") {
		t.Fatalf("stderr = %q, want the available names", f.errOut.String())
	}
}

func TestRunNotTTYExitsOne(t *testing.T) {
	dir := demoProject(t)
	f := newFake(t, dir, filepath.Join(t.TempDir(), "recent.json"))
	f.pickErr = ui.ErrNotTTY

	if code := Run(nil, f.env); code != exitFailure {
		t.Fatalf("exit = %d, want %d", code, exitFailure)
	}
	if !strings.Contains(f.errOut.String(), "--list") {
		t.Fatalf("stderr = %q, want the --list hint", f.errOut.String())
	}
}

func TestRunAbortExits130(t *testing.T) {
	dir := demoProject(t)
	f := newFake(t, dir, filepath.Join(t.TempDir(), "recent.json"))
	f.pickErr = ui.ErrAborted

	if code := Run(nil, f.env); code != exitAbort {
		t.Fatalf("exit = %d, want %d", code, exitAbort)
	}
	if len(f.commands) != 0 {
		t.Fatalf("commands = %+v", f.commands)
	}
}

func TestRunNoPackageFails(t *testing.T) {
	f := newFake(t, t.TempDir(), filepath.Join(t.TempDir(), "recent.json"))
	if code := Run(nil, f.env); code != exitFailure {
		t.Fatalf("exit = %d, want %d", code, exitFailure)
	}
	if !strings.Contains(f.errOut.String(), "package.json") {
		t.Fatalf("stderr = %q", f.errOut.String())
	}
}

func TestRunListJSON(t *testing.T) {
	dir := demoProject(t)
	statePath := filepath.Join(t.TempDir(), "recent.json")

	first := newFake(t, dir, statePath)
	first.pickID = "lint"
	if code := Run(nil, first.env); code != exitOK {
		t.Fatalf("first exit = %d", code)
	}

	f := newFake(t, dir, statePath)
	if code := Run([]string{"--list", "--json"}, f.env); code != exitOK {
		t.Fatalf("exit = %d, stderr = %q", code, f.errOut.String())
	}
	if f.picked {
		t.Fatal("--list must not open the picker")
	}
	var doc listDoc
	if err := json.Unmarshal(f.out.Bytes(), &doc); err != nil {
		t.Fatalf("JSON: %v\n%s", err, f.out.String())
	}
	if doc.Dir != dir || doc.PM != "bun" || doc.Name != "demo" {
		t.Fatalf("doc = %+v", doc)
	}
	if len(doc.Scripts) != 3 {
		t.Fatalf("scripts = %+v", doc.Scripts)
	}
	if doc.Scripts[0].Name != "lint" || !doc.Scripts[0].Recent || doc.Scripts[0].Count != 1 {
		t.Fatalf("first row = %+v", doc.Scripts[0])
	}
	for _, row := range doc.Scripts[1:] {
		if row.Recent {
			t.Fatalf("unexpected recent row: %+v", row)
		}
	}
}

func TestRunListTextMarksRecent(t *testing.T) {
	dir := demoProject(t)
	statePath := filepath.Join(t.TempDir(), "recent.json")

	first := newFake(t, dir, statePath)
	first.pickID = "dev"
	if code := Run(nil, first.env); code != exitOK {
		t.Fatalf("first exit = %d", code)
	}

	f := newFake(t, dir, statePath)
	if code := Run([]string{"--list"}, f.env); code != exitOK {
		t.Fatalf("exit = %d", code)
	}
	if !strings.Contains(f.out.String(), "* dev") {
		t.Fatalf("output = %q, want a recent marker", f.out.String())
	}
}

func TestRunHelpAndVersion(t *testing.T) {
	f := newFake(t, "/nowhere", filepath.Join(t.TempDir(), "recent.json"))
	if code := Run([]string{"--help"}, f.env); code != exitOK {
		t.Fatalf("help exit = %d", code)
	}
	if !strings.Contains(f.out.String(), "--list") {
		t.Fatalf("help = %q", f.out.String())
	}
	f.out.Reset()
	if code := Run([]string{"--version"}, f.env); code != exitOK {
		t.Fatalf("version exit = %d", code)
	}
	if !strings.Contains(f.out.String(), Version) {
		t.Fatalf("version = %q", f.out.String())
	}
}

// --json on its own selects the list path instead of opening the picker.
func TestRunJSONAloneLists(t *testing.T) {
	dir := demoProject(t)
	f := newFake(t, dir, filepath.Join(t.TempDir(), "recent.json"))
	if code := Run([]string{"--json"}, f.env); code != exitOK {
		t.Fatalf("exit = %d, stderr = %q", code, f.errOut.String())
	}
	if f.picked {
		t.Fatal("--json must not open the picker")
	}
	var doc listDoc
	if err := json.Unmarshal(f.out.Bytes(), &doc); err != nil {
		t.Fatalf("JSON: %v\n%s", err, f.out.String())
	}
	if len(doc.Scripts) != 3 {
		t.Fatalf("scripts = %+v", doc.Scripts)
	}
}

func TestRunBadFlagExitsTwo(t *testing.T) {
	f := newFake(t, "/nowhere", filepath.Join(t.TempDir(), "recent.json"))
	if code := Run([]string{"--bogus"}, f.env); code != exitUsage {
		t.Fatalf("exit = %d, want %d", code, exitUsage)
	}
}
