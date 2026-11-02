// logic_test.go covers the ported inventory, state, and apply rules against
// temporary source and project trees; no test touches the real HOME.
package app

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// writeFile puts content at root/rel, creating parents.
func writeFile(t *testing.T, root, rel, content string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", full, err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", full, err)
	}
}

func newTestApp(t *testing.T, ruleRoot, skillRoot, projectRoot string) *app {
	t.Helper()
	a := &app{ruleRoot: ruleRoot, skillRoot: skillRoot, projectRoot: projectRoot, stdout: os.Stdout, stderr: os.Stderr}
	return a
}

func TestListRuleItemsSortsAndFilters(t *testing.T) {
	ruleRoot := t.TempDir()
	writeFile(t, ruleRoot, "zeta.md", "z\n")
	writeFile(t, ruleRoot, "alpha.md", "a\n")
	writeFile(t, ruleRoot, "nested/beta.md", "b\n")
	writeFile(t, ruleRoot, "notes.txt", "ignored\n")

	items, err := listRuleItems(ruleRoot)
	if err != nil {
		t.Fatalf("listRuleItems: %v", err)
	}
	var got []string
	for _, item := range items {
		if item.Kind != "rule" {
			t.Fatalf("kind = %q, want rule", item.Kind)
		}
		got = append(got, item.RelativePath)
	}
	want := []string{"alpha.md", "nested/beta.md", "zeta.md"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("relative paths = %v, want %v", got, want)
	}
}

func TestListRuleItemsErrors(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "absent")
	if _, err := listRuleItems(missing); err == nil || err.Error() != "Source directory does not exist: "+missing {
		t.Fatalf("missing root error = %v", err)
	}
	empty := t.TempDir()
	if _, err := listRuleItems(empty); err == nil || err.Error() != "No rule files found in: "+empty {
		t.Fatalf("empty root error = %v", err)
	}
}

func TestSkillSectionsAndGrouping(t *testing.T) {
	skillRoot := t.TempDir()
	writeFile(t, skillRoot, "writing/write-doc/SKILL.md", "---\nname: write-doc\n---\n")
	writeFile(t, skillRoot, "_web/web-run/SKILL.md", "---\nname: web-run\n---\n")
	writeFile(t, skillRoot, "_web/web-x/SKILL.md", "---\nname: web-x\n---\n")
	writeFile(t, skillRoot, "research/notes.md", "not a skill\n")

	skills := listSkillItems(skillRoot)
	var rels []string
	for _, item := range skills {
		rels = append(rels, item.RelativePath)
	}
	want := []string{"_web/web-run", "_web/web-x", "writing/write-doc"}
	if !reflect.DeepEqual(rels, want) {
		t.Fatalf("skill dirs = %v, want %v", rels, want)
	}

	sections := iterSkillSections(skills)
	if len(sections) != 2 || sections[0].label != "Skills" || sections[1].label != "Skills / web" {
		t.Fatalf("sections = %+v", sections)
	}
	if len(sections[0].items) != 1 || len(sections[1].items) != 2 {
		t.Fatalf("section sizes = %d, %d", len(sections[0].items), len(sections[1].items))
	}
}

func TestGroupInstructionItemsOrder(t *testing.T) {
	items := []ManagedItem{
		{Kind: "rule", RelativePath: "browser.md"},
		{Kind: "rule", RelativePath: "stack-svelte.md"},
		{Kind: "rule", RelativePath: "stack-tauri.md"},
		{Kind: "skill", RelativePath: "writing/write-doc"},
		{Kind: "rule", RelativePath: "bun.md"},
	}
	grouped := groupInstructionItems(items)
	var got []string
	for _, item := range grouped {
		got = append(got, item.RelativePath)
	}
	want := []string{"browser.md", "bun.md", "stack-svelte.md", "stack-tauri.md", "writing/write-doc"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("grouped = %v, want %v", got, want)
	}
}

func TestDisplayEntriesCountSections(t *testing.T) {
	items := []ManagedItem{
		{Kind: "rule", RelativePath: "bun.md"},
		{Kind: "rule", RelativePath: "stack-svelte.md"},
		{Kind: "skill", RelativePath: "writing/write-doc"},
	}
	entries, index := buildDisplayEntries(items)
	// spacer, header, spacer, item for each of the three non-empty sections.
	if len(entries) != 12 {
		t.Fatalf("entries = %d, want 12", len(entries))
	}
	if entries[1].label != "General (1)" || entries[5].label != "Stack (1)" || entries[9].label != "Skills (1)" {
		t.Fatalf("labels = %q, %q, %q", entries[1].label, entries[5].label, entries[9].label)
	}
	if index[items[0]] != 3 || index[items[1]] != 7 || index[items[2]] != 11 {
		t.Fatalf("display indexes = %v", index)
	}
}

func TestRuleModesReadFrontmatter(t *testing.T) {
	ruleRoot := t.TempDir()
	writeFile(t, ruleRoot, "described.md", "---\ndescription: has one\n---\nbody\n")
	writeFile(t, ruleRoot, "plain.md", "# no frontmatter\n")
	writeFile(t, ruleRoot, "load-always.md", "---\ndescription: x\nload: always\n---\n")
	writeFile(t, ruleRoot, "load-routed.md", "---\ndescription: x\nload: \"routed\"\n---\n")
	writeFile(t, ruleRoot, "load-ignored.md", "---\ndescription: x\nload: never\n---\n")
	writeFile(t, ruleRoot, "paths-only.md", "---\npaths: \"**/*.rs\"\n---\n")

	a := newTestApp(t, ruleRoot, "", t.TempDir())
	cases := map[string]string{
		"described.md":    routedMode,
		"plain.md":        alwaysMode,
		"load-always.md":  alwaysMode,
		"load-routed.md":  routedMode,
		"load-ignored.md": routedMode,
		"paths-only.md":   alwaysMode,
	}
	for rel, want := range cases {
		if got := a.ruleDefaultMode(ManagedItem{Kind: "rule", RelativePath: rel}); got != want {
			t.Fatalf("%s default mode = %q, want %q", rel, got, want)
		}
	}
}

func TestTargetRootsAndStaleLinks(t *testing.T) {
	ruleRoot := t.TempDir()
	writeFile(t, ruleRoot, "described.md", "---\ndescription: x\n---\n")
	projectRoot := t.TempDir()
	a := newTestApp(t, ruleRoot, "/skills", projectRoot)

	described := ManagedItem{Kind: "rule", RelativePath: "described.md"}
	if got := a.targetRootFor(projectRoot, described, nil); got != filepath.Join(projectRoot, ".agents", "rules-routed") {
		t.Fatalf("routed target = %s", got)
	}
	if got := a.targetRootFor(projectRoot, described, map[ManagedItem]string{described: alwaysMode}); got != filepath.Join(projectRoot, ".agents", "rules") {
		t.Fatalf("always target = %s", got)
	}
	stale := a.staleLinkPaths(projectRoot, described, map[ManagedItem]string{described: alwaysMode})
	if len(stale) != 1 || stale[0] != filepath.Join(projectRoot, ".agents", "rules-routed", "described.md") {
		t.Fatalf("stale = %v", stale)
	}
	skill := ManagedItem{Kind: "skill", RelativePath: "writing/write-doc"}
	if got := a.targetRootFor(projectRoot, skill, nil); got != filepath.Join(projectRoot, ".agents", "skills-routed") {
		t.Fatalf("skill target = %s", got)
	}
	if got := a.staleLinkPaths(projectRoot, skill, nil); got != nil {
		t.Fatalf("skill stale = %v", got)
	}
}

func TestInspectDestinationStates(t *testing.T) {
	ruleRoot := t.TempDir()
	writeFile(t, ruleRoot, "r.md", "---\ndescription: x\n---\n")
	source := filepath.Join(ruleRoot, "r.md")
	projectRoot := t.TempDir()
	targetRoot := filepath.Join(projectRoot, ".agents", "rules-routed")

	if state, detail := inspectDestinationState(targetRoot, ruleRoot, "r.md"); state != "missing" || detail != "not present" {
		t.Fatalf("missing = %q %q", state, detail)
	}
	if err := os.MkdirAll(targetRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(source, filepath.Join(targetRoot, "r.md")); err != nil {
		t.Fatal(err)
	}
	if state, detail := inspectDestinationState(targetRoot, ruleRoot, "r.md"); state != "linked" || detail != "already linked" {
		t.Fatalf("linked = %q %q", state, detail)
	}
	if err := os.Remove(filepath.Join(targetRoot, "r.md")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(ruleRoot, "other.md"), filepath.Join(targetRoot, "r.md")); err != nil {
		t.Fatal(err)
	}
	if state, detail := inspectDestinationState(targetRoot, ruleRoot, "r.md"); state != "relink" || detail != "different symlink target" {
		t.Fatalf("relink = %q %q", state, detail)
	}
	if err := os.Remove(filepath.Join(targetRoot, "r.md")); err != nil {
		t.Fatal(err)
	}
	writeFile(t, targetRoot, "r.md", "real file\n")
	if state, detail := inspectDestinationState(targetRoot, ruleRoot, "r.md"); state != "conflict" || detail != "existing path" {
		t.Fatalf("conflict = %q %q", state, detail)
	}
}

func TestInspectBlockedAncestor(t *testing.T) {
	ruleRoot := t.TempDir()
	writeFile(t, ruleRoot, "nested/r.md", "x\n")
	projectRoot := t.TempDir()
	// `.agents` is a file, so every destination under it is blocked.
	writeFile(t, projectRoot, ".agents", "not a directory\n")
	state, detail := inspectDestinationState(filepath.Join(projectRoot, ".agents", "rules"), ruleRoot, "nested/r.md")
	if state != "conflict" || detail != "blocked by .agents" {
		t.Fatalf("blocked = %q %q", state, detail)
	}
}

func TestNormalizeSelectionKeepsOneStackRule(t *testing.T) {
	items := []ManagedItem{
		{Kind: "rule", RelativePath: "bun.md"},
		{Kind: "rule", RelativePath: "stack-a.md"},
		{Kind: "rule", RelativePath: "stack-b.md"},
	}
	selection := map[ManagedItem]bool{items[0]: true, items[1]: true, items[2]: true}
	states := map[ManagedItem]destinationState{
		items[0]: {state: "missing"},
		items[1]: {state: "missing"},
		items[2]: {state: "linked"},
	}
	normalizeSelection(selection, items, states, ManagedItem{}, false)
	if !selection[items[0]] || selection[items[1]] || !selection[items[2]] {
		t.Fatalf("selection = %v", selection)
	}
	// A preferred item wins over a linked one.
	selection[items[1]] = true
	normalizeSelection(selection, items, map[ManagedItem]destinationState{
		items[0]: {state: "missing"},
		items[1]: {state: "relink"},
		items[2]: {state: "linked"},
	}, items[1], true)
	if !selection[items[1]] || selection[items[2]] {
		t.Fatalf("preferred selection = %v", selection)
	}
}

func TestApplySelectionLinksMovesAndRemoves(t *testing.T) {
	ruleRoot := t.TempDir()
	writeFile(t, ruleRoot, "keep.md", "---\ndescription: x\n---\n")
	writeFile(t, ruleRoot, "move.md", "---\ndescription: x\n---\n")
	writeFile(t, ruleRoot, "drop.md", "plain\n")
	projectRoot := t.TempDir()
	a := newTestApp(t, ruleRoot, "", projectRoot)

	items := []ManagedItem{
		{Kind: "rule", RelativePath: "drop.md"},
		{Kind: "rule", RelativePath: "keep.md"},
		{Kind: "rule", RelativePath: "move.md"},
	}
	// keep.md is already linked in rules-routed; move.md is linked in rules and
	// will be moved; drop.md was linked and is now deselected.
	routed := filepath.Join(projectRoot, ".agents", "rules-routed")
	always := filepath.Join(projectRoot, ".agents", "rules")
	if err := os.MkdirAll(routed, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(always, 0o755); err != nil {
		t.Fatal(err)
	}
	mustLink := func(source, destination string) {
		t.Helper()
		if err := os.Symlink(source, destination); err != nil {
			t.Fatal(err)
		}
	}
	mustLink(filepath.Join(ruleRoot, "keep.md"), filepath.Join(routed, "keep.md"))
	mustLink(filepath.Join(ruleRoot, "move.md"), filepath.Join(always, "move.md"))
	mustLink(filepath.Join(ruleRoot, "drop.md"), filepath.Join(always, "drop.md"))

	modes := map[ManagedItem]string{
		items[0]: alwaysMode,
		items[1]: routedMode,
		items[2]: routedMode,
	}
	// Initially move.md is linked in rules/, so its mode is always; switching
	// it to routed is what makes apply move the link.
	initialModes := map[ManagedItem]string{
		items[0]: alwaysMode,
		items[1]: routedMode,
		items[2]: alwaysMode,
	}
	selection := a.buildSelection(projectRoot, items, initialModes)
	if !selection[items[1]] || !selection[items[2]] || !selection[items[0]] {
		t.Fatalf("initial selection = %v", selection)
	}
	selected := []ManagedItem{items[1], items[2]}
	states := a.inspectStates(projectRoot, items, modes)
	if states[items[2]].state != "linked" && states[items[2]].state != "missing" {
		t.Fatalf("move state = %q", states[items[2]].state)
	}
	linked, moved, removed, unchanged, err := a.applySelection(projectRoot, items, selected, modes)
	if err != nil {
		t.Fatalf("applySelection: %v", err)
	}
	if len(linked) != 0 || len(moved) != 1 || len(removed) != 1 || len(unchanged) != 1 {
		t.Fatalf("linked=%v moved=%v removed=%v unchanged=%v", linked, moved, removed, unchanged)
	}
	if moved[0] != items[2] || removed[0] != items[0] || unchanged[0] != items[1] {
		t.Fatalf("classification order = %v %v %v", moved, removed, unchanged)
	}
	if _, err := os.Lstat(filepath.Join(always, "move.md")); err == nil {
		t.Fatal("stale link in rules/ was not removed")
	}
	if !symlinkResolvesTo(filepath.Join(routed, "move.md"), filepath.Join(ruleRoot, "move.md")) {
		t.Fatal("move.md was not linked into rules-routed")
	}
	if _, err := os.Lstat(filepath.Join(always, "drop.md")); err == nil {
		t.Fatal("deselected drop.md link was not removed")
	}
}

func TestApplySelectionRefusesRealFiles(t *testing.T) {
	ruleRoot := t.TempDir()
	writeFile(t, ruleRoot, "r.md", "x\n")
	projectRoot := t.TempDir()
	writeFile(t, projectRoot, ".agents/rules/r.md", "real\n")
	a := newTestApp(t, ruleRoot, "", projectRoot)
	item := ManagedItem{Kind: "rule", RelativePath: "r.md"}
	_, _, _, _, err := a.applySelection(projectRoot, []ManagedItem{item}, []ManagedItem{item}, map[ManagedItem]string{item: alwaysMode})
	want := "Refusing to overwrite existing non-symlink paths:\n- " + filepath.Join(projectRoot, ".agents", "rules", "r.md")
	if err == nil || err.Error() != want {
		t.Fatalf("conflict error = %v", err)
	}
}

func TestApplySelectionRejectsNonDirectoryAgents(t *testing.T) {
	ruleRoot := t.TempDir()
	writeFile(t, ruleRoot, "r.md", "x\n")
	projectRoot := t.TempDir()
	writeFile(t, projectRoot, ".agents", "file\n")
	a := newTestApp(t, ruleRoot, "", projectRoot)
	item := ManagedItem{Kind: "rule", RelativePath: "r.md"}
	_, _, _, _, err := a.applySelection(projectRoot, []ManagedItem{item}, []ManagedItem{item}, map[ManagedItem]string{item: alwaysMode})
	want := "Target path exists and is not a directory: " + filepath.Join(projectRoot, ".agents")
	if err == nil || err.Error() != want {
		t.Fatalf("agents error = %v", err)
	}
}
