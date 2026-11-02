package app

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func auditEntry(method, level, digest, bin string) LockEntry {
	return LockEntry{
		Method:      method,
		Version:     "1.0.0",
		Source:      "",
		Digest:      digest,
		Level:       level,
		Package:     "p",
		Bin:         bin,
		InstalledAt: "",
		Previous:    nil,
	}
}

func auditTmp(t *testing.T, name string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), name)
	if err := os.MkdirAll(dir, 0o777); err != nil {
		t.Fatal(err)
	}
	return dir
}

const auditOSV = `{"results":[{"source":{"path":"/x/bin","type":"filesystem"},"packages":[
      {"package":{"name":"golang.org/x/net","version":"0.61.0","ecosystem":"Go"},"vulnerabilities":[{"id":"GO-1"},{"id":"GO-2"}]},
      {"package":{"name":"safe","version":"1.0.0","ecosystem":"Go"},"vulnerabilities":[]},
      {"package":{"name":"golang.org/x/net","version":"0.61.0","ecosystem":"Go"},"vulnerabilities":[{"id":"GO-1"}]}]}]}`

func TestParsesOnlyVulnerablePackagesOnce(t *testing.T) {
	found, err := parseOsvJSON(auditOSV, "t")
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 1 {
		t.Fatalf("len %d", len(found))
	}
	if found[0].Package != "golang.org/x/net" {
		t.Fatalf("package %q", found[0].Package)
	}
	if !reflect.DeepEqual(found[0].IDs, []string{"GO-1", "GO-2"}) {
		t.Fatalf("ids %#v", found[0].IDs)
	}
	if _, err := parseOsvJSON("nope", "t"); err == nil {
		t.Fatal("expected error")
	}
	empty, err := parseOsvJSON("{}", "t")
	if err != nil {
		t.Fatal(err)
	}
	if len(empty) != 0 {
		t.Fatalf("empty %#v", empty)
	}
}

func TestOsvArgsPickTheBinaryPluginOrALockfile(t *testing.T) {
	out := "/o.json"
	bin := osvArgs(Source{Kind: SourceBinaries, Path: "/d"}, out)
	if !sliceHas(bin, "--x-plugins=go/binary") {
		t.Fatalf("args %#v", bin)
	}
	if bin[len(bin)-1] != "/d" {
		t.Fatalf("last %q", bin[len(bin)-1])
	}
	lockf := osvArgs(Source{Kind: SourceLockfile, Path: "/l/bun.lock"}, out)
	if !reflect.DeepEqual(lockf[len(lockf)-2:], []string{"-L", "/l/bun.lock"}) {
		t.Fatalf("lock args %#v", lockf)
	}
}

func sliceHas(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}

func TestPolicyFlagsUnverifiableVendorPendingAndUnknownLockEntries(t *testing.T) {
	toml := "[defaults]\ncooldown_days = 7\n\n[[tool]]\nname = \"v1\"\nmethod = \"vendor\"\nurl = \"https://e.com/a.zip\"\nbin = \"v1\"\nversion = \"1.0.0\"\n\n[[tool]]\nname = \"v2\"\nmethod = \"vendor\"\nurl = \"https://e.com/b.zip\"\nbin = \"v2\"\nstatus = \"pending\"\n\n[[tool]]\nname = \"v3\"\nmethod = \"vendor\"\nurl = \"https://e.com/c.zip\"\nbin = \"v3\"\nversion = \"1.0.0\"\nsha256 = \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"\n"
	manifest, err := LoadStr(toml)
	if err != nil {
		t.Fatal(err)
	}
	lock := LockFile{Tools: map[string]LockEntry{}}
	lock.Tools["v3"] = auditEntry("vendor", "pinned", strings.Repeat("b", 64), "/x")
	lock.Tools["ghost"] = auditEntry("release", "checksum", "", "/y")
	findings := policyFindings(&manifest, &lock)
	has := func(tool, sev, text string) bool {
		for _, f := range findings {
			if f.Tool == tool && f.Severity == sev && strings.Contains(f.Message, text) {
				return true
			}
		}
		return false
	}
	if !has("v1", "error", "모두 없음") || !has("v2", "warn", "pending") || !has("v3", "error", "다름") || !has("v3", "warn", "고정 해시로만") || !has("ghost", "warn", "목록") {
		t.Fatalf("%#v", findings)
	}
}

func TestExitCodeIs2ForVulnsOrErrorsOnlyWhenNothingElse(t *testing.T) {
	report := Report{}
	if report.ExitCode() != 0 {
		t.Fatal(report.ExitCode())
	}
	report.Errors = append(report.Errors, "x")
	if report.ExitCode() != 1 {
		t.Fatal(report.ExitCode())
	}
	report.Vulns = append(report.Vulns, VulnFinding{Target: "t", Package: "p", Version: "1", IDs: []string{"A"}})
	if report.ExitCode() != 2 {
		t.Fatal(report.ExitCode())
	}
	warnOnly := Report{Policy: []PolicyFinding{{Tool: "t", Severity: "warn", Message: "m"}}}
	if warnOnly.ExitCode() != 0 {
		t.Fatal(warnOnly.ExitCode())
	}
}

func TestAFakeOsvScannerWithAKnownVulnerableModuleYieldsCode2(t *testing.T) {
	dir := auditTmp(t, "fake")
	t.Setenv("PROTO_HOME", filepath.Join(dir, "proto-home"))
	fake := filepath.Join(dir, "osv")
	script := "#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ \"$1\" = \"--output-file\" ]; then out=\"$2\"; fi; shift; done\ncat > \"$out\" <<'EOF'\n" + auditOSV + "\nEOF\nexit 1\n"
	if err := os.WriteFile(fake, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	paths := NewPaths(filepath.Join(dir, "home"), filepath.Join(dir, "state"), "proto")
	toolDir := paths.ProtoToolDir("lite", "1.0.0")
	if err := os.MkdirAll(toolDir, 0o777); err != nil {
		t.Fatal(err)
	}
	lock := LockFile{Tools: map[string]LockEntry{}}
	lock.Tools["lite"] = auditEntry("release", "checksum", "", "/s/lite")
	manifest, err := LoadStr("[defaults]\ncooldown_days = 7\n")
	if err != nil {
		t.Fatal(err)
	}
	bin := fake
	report := audit(&manifest, &lock, paths, "", func(target *Target, out string) ([]VulnFinding, error) {
		return runOsv(bin, target, out)
	})
	if !reflect.DeepEqual(report.Scanned, []string{"lite"}) {
		t.Fatalf("scanned %#v errors %#v skipped %#v", report.Scanned, report.Errors, report.Skipped)
	}
	if len(report.Vulns) != 1 {
		t.Fatalf("vulns %#v", report.Vulns)
	}
	if report.ExitCode() != 2 {
		t.Fatal(report.ExitCode())
	}
	if !strings.Contains(render(&report), "golang.org/x/net 0.61.0") {
		t.Fatalf("render %q", render(&report))
	}
}

func TestOsvFailureIsReportedAsAnErrorNotAFinding(t *testing.T) {
	dir := auditTmp(t, "fail")
	fake := filepath.Join(dir, "osv")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\necho boom >&2\nexit 7\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	target := Target{Label: "t", Source: Source{Kind: SourceLockfile, Path: "/x"}}
	_, err := runOsv(fake, &target, filepath.Join(dir, "o.json"))
	if err == nil || !strings.Contains(err.Error(), "exit 7") {
		t.Fatalf("%v", err)
	}
}

func TestModuleRootScansGoModOnly(t *testing.T) {
	dir := auditTmp(t, "mod")
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module example.com/cli\n\ngo 1.22\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "go.sum"), []byte(""), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "Cargo.lock"), []byte(""), 0o644); err != nil {
		t.Fatal(err)
	}
	var skipped []string
	got := targets(NewPaths(dir, dir, "proto"), &LockFile{}, dir, &skipped)
	var labels []string
	for _, target := range got {
		labels = append(labels, target.Label)
		if target.Source.Kind != SourceLockfile {
			t.Fatalf("kind %v", target.Source.Kind)
		}
	}
	if !reflect.DeepEqual(labels, []string{"cli(go.mod)"}) {
		t.Fatalf("%#v", labels)
	}
}
