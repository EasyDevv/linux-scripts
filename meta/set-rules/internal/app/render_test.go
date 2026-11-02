// render_test.go asserts the frame text the picker draws and the summary, at
// the cheapest layer that can fail them.
package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFrameTextAndHangulWidth(t *testing.T) {
	ruleRoot := t.TempDir()
	writeFile(t, ruleRoot, "bun.md", "---\ndescription: x\n---\n")
	writeFile(t, ruleRoot, "plain.md", "no frontmatter\n")
	projectRoot := t.TempDir()
	a := newTestApp(t, ruleRoot, "", projectRoot)
	rawItems, err := listInstructionItems(a.ruleRoot, "")
	if err != nil {
		t.Fatal(err)
	}
	a.items = groupInstructionItems(rawItems)
	a.modes = a.initialRuleModes(projectRoot, a.items)
	a.selection = a.buildSelection(projectRoot, a.items, a.modes)
	a.entries, a.displayIndex = buildDisplayEntries(a.items)
	a.message = defaultMessage

	lines := a.Frame(100, 24, 0, 0)
	if len(lines) != headerLines+len(a.entries)+1 {
		t.Fatalf("frame lines = %d, want %d", len(lines), headerLines+len(a.entries)+1)
	}
	if !strings.HasPrefix(lines[0], "Rule source: "+a.ruleRoot) {
		t.Fatalf("rule source line = %q", lines[0])
	}
	if !strings.Contains(lines[2], "/.agents/{rules,rules-routed}") {
		t.Fatalf("rule target line = %q", lines[2])
	}
	if !strings.Contains(lines[5], "Selected: 0/2") || !strings.Contains(lines[5], "Linked 0 | Relink 0 | Conflict 0") {
		t.Fatalf("selected line = %q", lines[5])
	}
	if lines[len(lines)-1] != defaultMessage {
		t.Fatalf("message line = %q", lines[len(lines)-1])
	}
	found := false
	for _, line := range lines {
		if strings.Contains(line, "General (2)") {
			found = true
		}
	}
	if !found {
		t.Fatalf("general header missing from %q", lines)
	}
	// Width is measured in cells, so a Hangul label keeps its columns.
	if visibleWidth("한글") != 4 || visibleWidth("스택") != 4 {
		t.Fatalf("hangul cell width = %d, %d", visibleWidth("한글"), visibleWidth("스택"))
	}
	if got := fitToWidth("한글 스택", 5); visibleWidth(got) > 5 || !strings.HasSuffix(got, "…") {
		t.Fatalf("fit hangul = %q width %d", got, visibleWidth(got))
	}
	if got := fitToWidth("한글", 5); got != "한글" {
		t.Fatalf("fit under width = %q", got)
	}
}

func TestColorSwitch(t *testing.T) {
	// A temp file is not a terminal, so paint never adds SGR bytes here.
	if got := paint(true, "x", boldSeq); got != boldSeq+"x"+resetSeq {
		t.Fatalf("paint = %q", got)
	}
	if got := paint(false, "x", boldSeq); got != "x" {
		t.Fatalf("plain paint = %q", got)
	}
	if colorEnabled() {
		t.Fatal("colorEnabled on a non-tty stdout")
	}
	t.Setenv("NO_COLOR", "")
	if colorEnabled() {
		t.Fatal("NO_COLOR= (empty) must disable color")
	}
}

func TestSummaryText(t *testing.T) {
	ruleRoot := t.TempDir()
	projectRoot := t.TempDir()
	out := filepath.Join(t.TempDir(), "out")
	file, err := os.Create(out)
	if err != nil {
		t.Fatal(err)
	}
	a := newTestApp(t, ruleRoot, "/skills", projectRoot)
	a.stdout = file
	a.printSummary(projectRoot,
		[]ManagedItem{{Kind: "rule", RelativePath: "a/bun.md"}},
		nil,
		[]ManagedItem{{Kind: "skill", RelativePath: "writing/write-doc"}},
		nil,
	)
	file.Close()
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, want := range []string{
		"Target project: " + projectRoot + "\n",
		"Rule source: " + ruleRoot + "\n",
		"Skill source: /skills\n",
		"Linked: 1 | Moved: 0 | Removed: 1 | Unchanged: 0\n",
		"Linked:\n  - rule: bun\n",
		"Removed:\n  - skill: write-doc\n",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("summary missing %q in %q", want, text)
		}
	}
	if strings.Contains(text, "Moved:") && strings.Contains(text, "\nMoved:") {
		t.Fatalf("empty group printed: %q", text)
	}
}

func TestChooseRequiresTerminal(t *testing.T) {
	ruleRoot := t.TempDir()
	writeFile(t, ruleRoot, "r.md", "x\n")
	projectRoot := t.TempDir()
	a := newTestApp(t, ruleRoot, "", projectRoot)
	a.items = []ManagedItem{{Kind: "rule", RelativePath: "r.md"}}
	a.selection = map[ManagedItem]bool{a.items[0]: true}
	a.modes = map[ManagedItem]string{a.items[0]: alwaysMode}
	a.entries, a.displayIndex = buildDisplayEntries(a.items)
	// go test's stdin/stdout are not terminals: the guard must return before
	// any picker runs, so the call cannot block.
	_, confirmed, err := a.choose()
	if err == nil || err.Error() != "This script must run in an interactive terminal." {
		t.Fatalf("choose error = %v", err)
	}
	if confirmed {
		t.Fatal("choose confirmed without a terminal")
	}
}
