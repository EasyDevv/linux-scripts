package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const doctorTOML = "[defaults]\ncooldown_days = 7\n\n[[tool]]\nname = \"aa\"\nmethod = \"vendor\"\nurl = \"https://example.com/aa.zip\"\nbin = \"aa\"\nversion = \"1.0.0\"\nenv = [\"AA_TOKEN\", \"AA_OTHER\"]\nprobe = [\"aa\", \"--version\"]\n\n[[tool]]\nname = \"bb\"\nmethod = \"vendor\"\nurl = \"https://example.com/bb.zip\"\nbin = \"bb\"\nversion = \"2.0.0\"\n\n[[tool]]\nname = \"cc\"\nmethod = \"vendor\"\nurl = \"https://example.com/cc.zip\"\nbin = \"cc\"\nversion = \"3.0.0\"\n"

func doctorExe(t *testing.T, dir, name string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := pathJoin(dir, name)
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func doctorScript(t *testing.T, dir, name, body string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := pathJoin(dir, name)
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func doctorLockEntry(version, bin string) LockEntry {
	return LockEntry{
		Method:      "vendor",
		Version:     version,
		Level:       "pinned",
		Bin:         bin,
		InstalledAt: "",
	}
}

func doctorRow(t *testing.T, report DoctorReport, name string) Row {
	t.Helper()
	for _, row := range report.Tools {
		if row.Name == name {
			return row
		}
	}
	t.Fatalf("missing row %s", name)
	return Row{}
}

func issueHas(issues []string, sub string) bool {
	for _, issue := range issues {
		if strings.Contains(issue, sub) {
			return true
		}
	}
	return false
}

func TestClassifiesOkUnmanagedMissingAndConflictsWithoutReadingEnvValues(t *testing.T) {
	root := t.TempDir()
	first := pathJoin(root, "first")
	second := pathJoin(root, "second")
	aa := doctorExe(t, second, "aa")
	doctorExe(t, first, "aa")
	bb := doctorExe(t, second, "bb")
	manifest, err := LoadStr(doctorTOML)
	if err != nil {
		t.Fatal(err)
	}
	lock := LockFile{Tools: map[string]LockEntry{}}
	lock.Tools["aa"] = doctorLockEntry("1.0.0", aa)
	lock.Tools["bb"] = doctorLockEntry("9.9.9", bb)
	path := first + string(os.PathListSeparator) + second
	report := inspect(&manifest, &lock, &path, func(name string) bool { return name == "AA_TOKEN" }, func([]string) *string {
		text := "1.0.0"
		return &text
	})
	aaRow := doctorRow(t, report, "aa")
	if aaRow.Status != "problem" || !issueHas(aaRow.Issues, "PATH 충돌") {
		t.Fatalf("aa %#v", aaRow)
	}
	if len(aaRow.Env) != 2 || aaRow.Env[0] != (EnvStatus{Name: "AA_TOKEN", Set: true}) || aaRow.Env[1] != (EnvStatus{Name: "AA_OTHER", Set: false}) {
		t.Fatalf("env %#v", aaRow.Env)
	}
	bbRow := doctorRow(t, report, "bb")
	if bbRow.Status != "problem" || !issueHas(bbRow.Issues, "lock 9.9.9") {
		t.Fatalf("bb %#v", bbRow)
	}
	if doctorRow(t, report, "cc").Status != "missing" {
		t.Fatalf("cc %#v", doctorRow(t, report, "cc"))
	}
	if strings.Join(report.Missing, ",") != "cc" || report.Problems != 3 {
		t.Fatalf("missing %v problems %d", report.Missing, report.Problems)
	}
	raw := mustDoctorJSON(t, report)
	if got := topKeys(t, raw); strings.Join(got, ",") != "tools,runtimes,missing,problems" {
		t.Fatalf("top keys %v", got)
	}
	var parsed map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		t.Fatal(err)
	}
	var tools []json.RawMessage
	if err := json.Unmarshal(parsed["tools"], &tools); err != nil {
		t.Fatal(err)
	}
	if got := topKeys(t, string(tools[2])); strings.Join(got, ",") != "name,method,status,installed,managed,path,version,locked_version,manifest_version,issues,env" {
		t.Fatalf("row keys %v", got)
	}
	if !strings.Contains(string(tools[2]), `"path": null`) || strings.Contains(raw, "AA_TOKEN=") {
		t.Fatalf("json null/secret %s", raw)
	}
}

func topKeys(t *testing.T, raw string) []string {
	t.Helper()
	dec := json.NewDecoder(strings.NewReader(raw))
	tok, err := dec.Token()
	if err != nil || tok != json.Delim('{') {
		t.Fatalf("object %v %v", tok, err)
	}
	var keys []string
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			t.Fatal(err)
		}
		keys = append(keys, key.(string))
		var skip json.RawMessage
		if err := dec.Decode(&skip); err != nil {
			t.Fatal(err)
		}
	}
	return keys
}

func TestInstalledWithoutALockEntryIsUnmanagedNotAProblem(t *testing.T) {
	root := t.TempDir()
	doctorExe(t, root, "cc")
	manifest, err := LoadStr(doctorTOML)
	if err != nil {
		t.Fatal(err)
	}
	report := inspect(&manifest, &LockFile{}, &root, func(string) bool { return false }, func([]string) *string { return nil })
	cc := doctorRow(t, report, "cc")
	if cc.Status != "unmanaged" || cc.Managed {
		t.Fatalf("cc %#v", cc)
	}
}

func TestAFailingProbeIsAProblem(t *testing.T) {
	root := t.TempDir()
	aa := doctorExe(t, root, "aa")
	manifest, err := LoadStr(doctorTOML)
	if err != nil {
		t.Fatal(err)
	}
	lock := LockFile{Tools: map[string]LockEntry{"aa": doctorLockEntry("1.0.0", aa)}}
	report := inspect(&manifest, &lock, &root, func(string) bool { return false }, func([]string) *string { return nil })
	row := doctorRow(t, report, "aa")
	if row.Status != "problem" || !issueHas(row.Issues, "프로브 실패") {
		t.Fatalf("aa %#v", row)
	}
}

func TestTableOutputCollapsesToTheFirstDataRow(t *testing.T) {
	text := "┌───┬───┐\n│ version │ commit │\n├───┼───┤\n│ v0.12.0 │ da7b6 │\n└───┴───┘\ntip"
	if got := pickLine(text); got == nil || *got != "v0.12.0 da7b6" {
		t.Fatalf("table %#v", got)
	}
	if got := pickLine("\n 1.2.3 \nx"); got == nil || *got != "1.2.3" {
		t.Fatalf("plain %#v", got)
	}
}

func TestProbeReturnsTheFirstLineAndNoneOnFailure(t *testing.T) {
	dir := t.TempDir()
	ok := doctorScript(t, dir, "ok", "#!/bin/sh\necho hello\necho second\n")
	bad := doctorScript(t, dir, "bad", "#!/bin/sh\nexit 3\n")
	errOnly := doctorScript(t, dir, "erronly", "#!/bin/sh\necho version-err >&2\n")
	if got := runProbe([]string{ok}); got == nil || *got != "hello" {
		t.Fatalf("ok %#v", got)
	}
	if runProbe([]string{bad}) != nil {
		t.Fatal("exit 3 should be none")
	}
	if got := runProbe([]string{errOnly}); got == nil || *got != "version-err" {
		t.Fatalf("stderr %#v", got)
	}
	missing := filepath.Join(dir, "definitely-not-a-binary-xyz")
	if runProbe([]string{missing}) != nil {
		t.Fatal("missing binary should be none")
	}
}

func TestProtoCopiesAreNotPathDuplicates(t *testing.T) {
	root := t.TempDir()
	t.Setenv("PROTO_HOME", root)
	t.Setenv("HOME", root)
	shim := doctorExe(t, pathJoin(root, "shims"), "aa")
	bin := doctorExe(t, pathJoin(root, "bin"), "aa")
	manifest, err := LoadStr(doctorTOML)
	if err != nil {
		t.Fatal(err)
	}
	lock := LockFile{Tools: map[string]LockEntry{"aa": doctorLockEntry("1.0.0", shim)}}
	path := pathJoin(root, "shims") + string(os.PathListSeparator) + pathJoin(root, "bin")
	report := inspect(&manifest, &lock, &path, func(string) bool { return false }, func([]string) *string {
		text := "1.0.0"
		return &text
	})
	row := doctorRow(t, report, "aa")
	if row.Status != "ok" || len(row.Issues) != 0 || row.Path == nil || *row.Path != shim {
		t.Fatalf("proto dup %#v bin %s", row, bin)
	}
}

func TestDoctorRenderUsesRustMarks(t *testing.T) {
	ver := "1.0.0"
	report := DoctorReport{
		Tools: []Row{{
			Name:    "aa",
			Status:  "ok",
			Version: &ver,
			Issues:  []string{},
			Env:     []EnvStatus{{Name: "AA_TOKEN", Set: true}, {Name: "AA_OTHER", Set: false}},
		}},
		Runtimes: []Runtime{{Name: "proto", Found: false}, {Name: "bun", Found: true}},
		Missing:  []string{},
		Problems: 0,
	}
	got := doctorRender(&report, false)
	if !strings.Contains(got, "aa    ok    1.0.0\n") {
		t.Fatalf("render %q", got)
	}
	if !strings.Contains(got, "env 설정: [AA_TOKEN] 미설정: [AA_OTHER]") {
		t.Fatalf("env line %q", got)
	}
	if !strings.Contains(got, "런타임: proto(없음) bun\n미설치 0개, 문제 0개\n") {
		t.Fatalf("summary %q", got)
	}
	if pad := fmt.Sprintf("%-4s", "밖"); pad != "밖   " {
		t.Fatalf("mark pad %q", pad)
	}
}

func mustDoctorJSON(t *testing.T, report DoctorReport) string {
	t.Helper()
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(report); err != nil {
		t.Fatal(err)
	}
	return buf.String()
}
