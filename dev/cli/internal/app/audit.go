// audit.go ports cli-rust/src/audit.rs.
//
// policyFindings, targets, parseOsvJSON, osvArgs, runOsv, audit, render.
// Report.ExitCode is Report::exit_code (0 / ExitBlocked / ExitError).
//
// Equivalence: Rust scanned one crate Cargo.lock (label "cli(Cargo.lock)",
// argument was that file). Go scans go.mod under moduleRoot when it is a regular
// file (label "cli(go.mod)"); osv-scanner cannot pick an extractor for go.sum
// (exit 127 "could not determine extractor", 261102 check). An empty moduleRoot
// adds nothing. Callers pass the module directory, not a Cargo.lock path.
//
// osv-scanner is only ever exec.Command(bin, args...). Tests must not run
// the real scanner.

package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sort"
	"strings"
)

// PolicyFinding is a manifest/lock policy hit. Severity is "error" or "warn".
type PolicyFinding struct {
	Tool     string `json:"tool"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

// VulnFinding is one vulnerable package from osv-scanner JSON.
type VulnFinding struct {
	Target  string   `json:"target"`
	Package string   `json:"package"`
	Version string   `json:"version"`
	IDs     []string `json:"ids"`
}

// Report is the audit result. Nil slices are treated as empty.
type Report struct {
	Policy  []PolicyFinding `json:"policy"`
	Vulns   []VulnFinding   `json:"vulns"`
	Scanned []string        `json:"scanned"`
	Skipped []string        `json:"skipped"`
	Errors  []string        `json:"errors"`
}

// ExitCode is 0 when clean, ExitBlocked (2) for policy errors or vulns,
// ExitError (1) for scan errors only when nothing else failed.
func (r Report) ExitCode() int {
	violations := len(r.Vulns) > 0
	if !violations {
		for _, finding := range r.Policy {
			if finding.Severity == "error" {
				violations = true
				break
			}
		}
	}
	if violations {
		return ExitBlocked
	}
	if len(r.Errors) > 0 {
		return ExitError
	}
	return 0
}

// policyFindings checks the manifest and lock only (no network).
// Lock-only names follow sorted key order (Rust BTreeMap).
func policyFindings(manifest *Manifest, lock *LockFile) []PolicyFinding {
	out := make([]PolicyFinding, 0)
	push := func(tool, severity, message string) {
		out = append(out, PolicyFinding{Tool: tool, Severity: severity, Message: message})
	}
	if manifest != nil {
		for i := range manifest.Tools {
			tool := &manifest.Tools[i]
			if tool.Status == StatusPending {
				push(tool.Name, "warn", "버전·해시가 아직 고정되지 않음(pending)")
				continue
			}
			switch {
			case tool.Method == MethodRelease && tool.Checksum == nil:
				push(tool.Name, "error", "release 인데 체크섬 파일이 지정되지 않음")
			case tool.Method == MethodVendor && !hasVerification(tool):
				push(tool.Name, "error", "vendor 인데 서명·체크섬·고정 sha256 이 모두 없음")
			}
			if lock == nil || lock.Tools == nil {
				continue
			}
			entry, ok := lock.Tools[tool.Name]
			if !ok {
				continue
			}
			if tool.Version != nil {
				wanted := *tool.Version
				if trimLeadingV(wanted) != trimLeadingV(entry.Version) {
					push(tool.Name, "warn", fmt.Sprintf("lock %s ≠ 목록 %s", entry.Version, wanted))
				}
			}
			if entry.Level == "pinned" {
				push(tool.Name, "warn", "서명·체크섬 없이 고정 해시로만 검증됨")
			}
			if tool.SHA256 != nil && entry.Level == "pinned" && !eqIgnoreASCIICase(*tool.SHA256, entry.Digest) {
				push(tool.Name, "error", "lock 해시가 목록에 고정된 sha256 과 다름")
			}
		}
	}
	if lock == nil {
		return out
	}
	for _, name := range sortedLockNames(lock) {
		if manifest == nil || !manifestHasTool(manifest, name) {
			push(name, "warn", "lock 에는 있으나 목록(tools.toml)에 없음")
		}
	}
	return out
}

func hasVerification(tool *Tool) bool {
	if tool.SHA256 != nil || tool.Checksum != nil {
		return true
	}
	return tool.SigURL != nil && tool.GPGFingerprint != nil
}

func manifestHasTool(manifest *Manifest, name string) bool {
	for i := range manifest.Tools {
		if manifest.Tools[i].Name == name {
			return true
		}
	}
	return false
}

// SourceKind selects how osv-scanner is invoked.
type SourceKind int

const (
	// SourceBinaries is a directory scanned with the go/binary plugin.
	SourceBinaries SourceKind = iota
	// SourceLockfile is a lockfile passed with -L (bun.lock, go.mod).
	SourceLockfile
)

// Source is audit::Source. Path is the directory or lockfile.
type Source struct {
	Kind SourceKind
	Path string
}

// Target is one osv-scanner invocation.
type Target struct {
	Label  string
	Source Source
}

// targets collects scan inputs from the lock and, when moduleRoot is set,
// from go.mod in that directory (Rust: one Cargo.lock file).
func targets(paths Paths, lock *LockFile, moduleRoot string, skipped *[]string) []Target {
	out := make([]Target, 0)
	bunAdded := false
	for _, name := range sortedLockNames(lock) {
		entry := lock.Tools[name]
		switch entry.Method {
		case "release", "vendor":
			root := paths.ProtoToolDir(name, entry.Version)
			if isDir(root) {
				out = append(out, Target{Label: name, Source: Source{Kind: SourceBinaries, Path: root}})
			} else if skipped != nil {
				*skipped = append(*skipped, fmt.Sprintf("%s: 설치 폴더 %s 없음", name, root))
			}
		case "go":
			dir := paths.TmpDir("audit-" + name)
			if err := stageBinary(entry.Bin, dir); err != nil {
				if skipped != nil {
					*skipped = append(*skipped, fmt.Sprintf("%s: %s", name, err.Error()))
				}
			} else {
				out = append(out, Target{Label: name, Source: Source{Kind: SourceBinaries, Path: dir}})
			}
		case "bun":
			if !bunAdded {
				bunAdded = true
				lockfile := paths.BunGlobalLock()
				if isFile(lockfile) {
					out = append(out, Target{Label: "bun-global", Source: Source{Kind: SourceLockfile, Path: lockfile}})
				}
			}
		case "cargo":
			if skipped != nil {
				*skipped = append(*skipped, fmt.Sprintf("%s: cargo 바이너리는 의존성 정보가 없어 스캔하지 못함", name))
			}
		}
	}
	if moduleRoot != "" {
		for _, name := range []string{"go.mod"} {
			path := pathJoin(moduleRoot, name)
			if isFile(path) {
				out = append(out, Target{Label: "cli(" + name + ")", Source: Source{Kind: SourceLockfile, Path: path}})
			}
		}
	}
	return out
}

func stageBinary(bin, dir string) error {
	_ = os.RemoveAll(dir)
	if err := os.MkdirAll(dir, 0o777); err != nil {
		return err
	}
	name, ok := rustFileName(bin)
	if !ok {
		return fmt.Errorf("bin has no file name")
	}
	dest := pathJoin(dir, name)
	if err := os.Link(bin, dest); err != nil {
		if err := copyFile(bin, dest); err != nil {
			return fmt.Errorf("copy %s: %w", bin, err)
		}
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode().Perm())
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

// rustFileName matches Path::file_name (None for "", ".", "..", and trailing-slash roots).
func rustFileName(bin string) (string, bool) {
	if bin == "" {
		return "", false
	}
	s := strings.TrimRight(bin, "/")
	if s == "" {
		return "", false
	}
	base := s
	if i := strings.LastIndex(s, "/"); i >= 0 {
		base = s[i+1:]
	}
	if base == "" || base == "." || base == ".." {
		return "", false
	}
	return base, true
}

// parseOsvJSON keeps packages that have at least one vulnerability id.
// The same package name and version is kept once (first ids win).
func parseOsvJSON(text, label string) ([]VulnFinding, error) {
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		return nil, fmt.Errorf("osv-scanner 출력이 JSON 이 아님: %w", err)
	}
	out := make([]VulnFinding, 0)
	root, _ := value.(map[string]any)
	results, _ := root["results"].([]any)
	for _, result := range results {
		rm, _ := result.(map[string]any)
		packages, _ := rm["packages"].([]any)
		for _, pkg := range packages {
			pm, _ := pkg.(map[string]any)
			vulns, _ := pm["vulnerabilities"].([]any)
			ids := make([]string, 0)
			for _, vuln := range vulns {
				vm, _ := vuln.(map[string]any)
				id, ok := vm["id"].(string)
				if ok {
					ids = append(ids, id)
				}
			}
			if len(ids) == 0 {
				continue
			}
			name, version := "?", "?"
			if p, ok := pm["package"].(map[string]any); ok {
				if n, ok := p["name"].(string); ok {
					name = n
				}
				if v, ok := p["version"].(string); ok {
					version = v
				}
			}
			if findingHasPackage(out, name, version) {
				continue
			}
			out = append(out, VulnFinding{Target: label, Package: name, Version: version, IDs: ids})
		}
	}
	return out, nil
}

func findingHasPackage(out []VulnFinding, name, version string) bool {
	for i := range out {
		if out[i].Package == name && out[i].Version == version {
			return true
		}
	}
	return false
}

// osvArgs is the argv after the osv-scanner binary (never a shell string).
func osvArgs(source Source, outFile string) []string {
	args := []string{"scan", "source"}
	switch source.Kind {
	case SourceBinaries:
		args = append(args,
			"--x-no-default-plugins",
			"--x-plugins=go/binary",
			"--format", "json",
			"--output-file", outFile,
			source.Path,
		)
	default:
		args = append(args,
			"--format", "json",
			"--output-file", outFile,
			"-L", source.Path,
		)
	}
	return args
}

// runOsv runs osv-scanner once. Exit 0 and 1 (vulns) are success.
// Exit 128 (nothing to scan) is an empty result. Other codes are errors.
// The binary is invoked with an argument array only.
func runOsv(osvBin string, target *Target, outFile string) ([]VulnFinding, error) {
	_ = os.Remove(outFile)
	cmd := exec.Command(osvBin, osvArgs(target.Source, outFile)...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	err := cmd.Run()
	code := 0
	if err != nil {
		exitErr, ok := err.(*exec.ExitError)
		if !ok {
			return nil, fmt.Errorf("run %s: %w", osvBin, err)
		}
		code = exitErr.ExitCode()
	}
	switch code {
	case 0, 1:
		text, err := os.ReadFile(outFile)
		if err != nil {
			return nil, fmt.Errorf("%s: 결과 파일이 없음 (exit %d): %w", target.Label, code, err)
		}
		return parseOsvJSON(string(text), target.Label)
	case 128:
		return []VulnFinding{}, nil
	default:
		return nil, fmt.Errorf("%s: osv-scanner exit %d: %s", target.Label, code, stderrTail(stderr.String()))
	}
}

func stderrTail(stderr string) string {
	lines := splitKeepLines(stderr)
	if len(lines) > 4 {
		lines = lines[len(lines)-4:]
	}
	return strings.Join(lines, " | ")
}

// splitKeepLines matches str::lines: drop a trailing newline, keep other lines.
func splitKeepLines(s string) []string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.TrimSuffix(s, "\n")
	if s == "" {
		return nil
	}
	return strings.Split(s, "\n")
}

// audit runs policy checks and then scan for each target.
// moduleRoot replaces Rust crate_lock; see the file comment.
// scan is called instead of runOsv so tests can avoid a real scanner.
func audit(manifest *Manifest, lock *LockFile, paths Paths, moduleRoot string, scan func(*Target, string) ([]VulnFinding, error)) Report {
	report := Report{
		Policy:  policyFindings(manifest, lock),
		Vulns:   []VulnFinding{},
		Scanned: []string{},
		Skipped: []string{},
		Errors:  []string{},
	}
	found := targets(paths, lock, moduleRoot, &report.Skipped)
	outDir := paths.TmpDir("audit")
	if err := os.MkdirAll(outDir, 0o777); err != nil {
		report.Errors = append(report.Errors, fmt.Sprintf("임시 폴더: %s", err.Error()))
		return report
	}
	for i := range found {
		target := &found[i]
		outFile := pathJoin(outDir, "osv.json")
		vulns, err := scan(target, outFile)
		if err != nil {
			report.Errors = append(report.Errors, err.Error())
			continue
		}
		report.Scanned = append(report.Scanned, target.Label)
		report.Vulns = append(report.Vulns, vulns...)
	}
	_ = os.RemoveAll(outDir)
	if lock != nil {
		for name := range lock.Tools {
			_ = os.RemoveAll(paths.TmpDir("audit-" + name))
		}
	}
	return report
}

// render is the human-readable report (trailing summary line included).
func render(report *Report) string {
	if report == nil {
		report = &Report{}
	}
	var b strings.Builder
	for _, finding := range report.Policy {
		fmt.Fprintf(&b, "[정책/%s] %s: %s\n", finding.Severity, finding.Tool, finding.Message)
	}
	for _, vuln := range report.Vulns {
		fmt.Fprintf(&b, "[취약점] %s: %s %s — %s\n", vuln.Target, vuln.Package, vuln.Version, strings.Join(vuln.IDs, ", "))
	}
	for _, note := range report.Skipped {
		fmt.Fprintf(&b, "[건너뜀] %s\n", note)
	}
	for _, errText := range report.Errors {
		fmt.Fprintf(&b, "[오류] %s\n", errText)
	}
	fmt.Fprintf(&b, "스캔 %d건 · 정책 %d건 · 취약 패키지 %d개 · 오류 %d건\n",
		len(report.Scanned), len(report.Policy), len(report.Vulns), len(report.Errors))
	return b.String()
}

func sortedLockNames(lock *LockFile) []string {
	if lock == nil || len(lock.Tools) == 0 {
		return nil
	}
	names := make([]string, 0, len(lock.Tools))
	for name := range lock.Tools {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func trimLeadingV(s string) string {
	return strings.TrimLeft(s, "v")
}

func eqIgnoreASCIICase(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if ca >= 'A' && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if cb >= 'A' && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}
