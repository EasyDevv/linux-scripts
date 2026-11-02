// doctor.go ports cli-rust/src/doctor.rs.
//
// cli doctor: per-tool install, version, PATH clash, lock match, and env-name
// presence. Read-only. Env values are never read or recorded — only the name
// and whether the caller says it is set.
//
// Exported types: EnvStatus, Row, Runtime, DoctorReport.
// DoctorReport is doctor::Report. The Go name is prefixed because audit::Report
// is already Report in this package. doctorRender is doctor::render, prefixed
// like pluginRender, because audit::render is render.
// JSON keys and field order match serde (snake_case). Option is a pointer with
// no omitempty so None encodes as null. Empty slices are empty, never nil.
//
// whichAll, inspect, runProbe, doctorRender are package-internal.

package app

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

type EnvStatus struct {
	Name string `json:"name"`
	Set  bool   `json:"set"`
}

type Row struct {
	Name            string      `json:"name"`
	Method          string      `json:"method"`
	Status          string      `json:"status"`
	Installed       bool        `json:"installed"`
	Managed         bool        `json:"managed"`
	Path            *string     `json:"path"`
	Version         *string     `json:"version"`
	LockedVersion   *string     `json:"locked_version"`
	ManifestVersion *string     `json:"manifest_version"`
	Issues          []string    `json:"issues"`
	Env             []EnvStatus `json:"env"`
}

type Runtime struct {
	Name  string  `json:"name"`
	Found bool    `json:"found"`
	Path  *string `json:"path"`
}

// DoctorReport is doctor::Report.
type DoctorReport struct {
	Tools    []Row     `json:"tools"`
	Runtimes []Runtime `json:"runtimes"`
	Missing  []string  `json:"missing"`
	Problems int       `json:"problems"`
}

var doctorRuntimes = []string{"proto", "bun", "go", "cargo", "gpg"}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0
}

// whichAll is which_all. pathVar nil is Rust None (no PATH). An empty string is
// Some("") and still searches the empty component.
func whichAll(exe string, pathVar *string) []string {
	if pathVar == nil {
		return []string{}
	}
	if exe == "" || strings.Contains(exe, "/") || strings.ContainsRune(exe, 0) {
		return []string{}
	}
	found := []string{}
	for _, dir := range strings.Split(*pathVar, string(os.PathListSeparator)) {
		candidate := pathJoin(dir, exe)
		if isExecutable(candidate) && !anySameFile(found, candidate) {
			found = append(found, candidate)
		}
	}
	return found
}

func anySameFile(seen []string, candidate string) bool {
	for _, prior := range seen {
		if sameFile(prior, candidate) {
			return true
		}
	}
	return false
}

func sameFile(a, b string) bool {
	x, errX := filepath.EvalSymlinks(a)
	y, errY := filepath.EvalSymlinks(b)
	if errX == nil && errY == nil {
		return pathEqual(x, y)
	}
	return pathEqual(a, b)
}

func pathEqual(a, b string) bool {
	ac := rustComponents(a)
	bc := rustComponents(b)
	if len(ac) != len(bc) {
		return false
	}
	for i := range ac {
		if ac[i] != bc[i] {
			return false
		}
	}
	return true
}

// rustComponents matches Path equality: trailing slash is dropped, "." and ".."
// stay, a leading "/" is its own component. Empty path has no components.
func rustComponents(p string) []string {
	if p == "" {
		return nil
	}
	var out []string
	rest := p
	if strings.HasPrefix(rest, "/") {
		out = append(out, "/")
		rest = strings.TrimLeft(rest, "/")
	}
	rest = strings.TrimSuffix(rest, "/")
	if rest == "" {
		return out
	}
	for _, part := range strings.Split(rest, "/") {
		if part == "" {
			continue
		}
		out = append(out, part)
	}
	return out
}

func inspectTool(tool *Tool, lock *LockFile, pathVar *string, envSet func(string) bool, probe func([]string) *string) Row {
	matches := whichAll(tool.ExeName(), pathVar)
	var entry *LockEntry
	if lock != nil && lock.Tools != nil {
		if e, ok := lock.Tools[tool.Name]; ok {
			entry = &e
		}
	}
	installed := len(matches) > 0
	issues := make([]string, 0)
	hard := false

	env := make([]EnvStatus, 0, len(tool.Env))
	for _, name := range tool.Env {
		env = append(env, EnvStatus{Name: name, Set: envSet(name)})
	}

	var version *string
	if installed {
		if len(tool.Probe) > 0 {
			if text := probe(tool.Probe); text != nil {
				copied := *text
				version = &copied
			} else {
				issues = append(issues, fmt.Sprintf("프로브 실패: %s", strings.Join(tool.Probe, " ")))
				hard = true
			}
		}
		// proto keeps the same tool in shims and bin. Both under proto is not a duplicate.
		protoDir := ProtoRoot()
		others := make([]string, 0)
		for _, other := range matches[1:] {
			if pathHasPrefix(other, protoDir) && pathHasPrefix(matches[0], protoDir) {
				continue
			}
			others = append(others, other)
		}
		if len(others) > 0 {
			issues = append(issues, fmt.Sprintf("PATH 에 중복: %s", strings.Join(others, ", ")))
		}
	}

	if entry != nil {
		if tool.Version != nil {
			wanted := *tool.Version
			if strings.TrimLeft(wanted, "v") != strings.TrimLeft(entry.Version, "v") {
				issues = append(issues, fmt.Sprintf("lock %s ≠ 목록 %s", entry.Version, wanted))
				hard = true
			}
		}
		if _, err := os.Stat(entry.Bin); err != nil {
			issues = append(issues, fmt.Sprintf("기록된 실행 파일이 없음: %s", entry.Bin))
			hard = true
		} else if len(matches) > 0 && !sameFile(matches[0], entry.Bin) {
			issues = append(issues, fmt.Sprintf("PATH 충돌: %s 가 먼저 잡힘 (기록: %s)", matches[0], entry.Bin))
			hard = true
		}
	} else if installed {
		issues = append(issues, "cli 밖에서 설치됨 (cli install 로 이행 필요)")
	}

	status := "ok"
	if !installed {
		issues = append([]string{"미설치"}, issues...)
		status = "missing"
	} else if hard {
		status = "problem"
	} else if entry == nil {
		status = "unmanaged"
	}

	var path *string
	if len(matches) > 0 {
		first := matches[0]
		path = &first
	}
	var locked *string
	if entry != nil {
		v := entry.Version
		locked = &v
	}
	return Row{
		Name:            tool.Name,
		Method:          tool.Method.AsStr(),
		Status:          status,
		Installed:       installed,
		Managed:         entry != nil,
		Path:            path,
		Version:         version,
		LockedVersion:   locked,
		ManifestVersion: cloneString(tool.Version),
		Issues:          issues,
		Env:             env,
	}
}

func cloneString(p *string) *string {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}

// inspect is inspect. envSet reports presence only; it must not be used to print values.
func inspect(manifest *Manifest, lock *LockFile, pathVar *string, envSet func(string) bool, probe func([]string) *string) DoctorReport {
	tools := make([]Row, 0, len(manifest.Tools))
	for i := range manifest.Tools {
		tools = append(tools, inspectTool(&manifest.Tools[i], lock, pathVar, envSet, probe))
	}
	runtimes := make([]Runtime, 0, len(doctorRuntimes))
	for _, name := range doctorRuntimes {
		found := whichAll(name, pathVar)
		var path *string
		if len(found) > 0 {
			first := found[0]
			path = &first
		}
		runtimes = append(runtimes, Runtime{Name: name, Found: len(found) > 0, Path: path})
	}
	missing := make([]string, 0)
	problems := 0
	for _, row := range tools {
		if row.Status == "missing" {
			missing = append(missing, row.Name)
		}
		if row.Status == "missing" || row.Status == "problem" {
			problems++
		}
	}
	return DoctorReport{Tools: tools, Runtimes: runtimes, Missing: missing, Problems: problems}
}

// pickLine keeps one display line. A box table (│) uses the first row that has a digit.
func pickLine(text string) *string {
	lines := trimmedLines(text)
	var chosen string
	if strings.Contains(text, "│") {
		found := false
		for _, line := range lines {
			if strings.Contains(line, "│") && hasASCIIDigit(line) {
				chosen = line
				found = true
				break
			}
		}
		if !found {
			return nil
		}
	} else {
		if len(lines) == 0 {
			return nil
		}
		chosen = lines[0]
	}
	flat := strings.Join(splitBox(chosen), " ")
	flat = takeRunes(flat, 120)
	return &flat
}

func trimmedLines(text string) []string {
	out := make([]string, 0)
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		out = append(out, line)
	}
	return out
}

func hasASCIIDigit(s string) bool {
	for _, ch := range s {
		if ch >= '0' && ch <= '9' {
			return true
		}
	}
	return false
}

func splitBox(s string) []string {
	parts := make([]string, 0)
	var b strings.Builder
	flush := func() {
		if b.Len() > 0 {
			parts = append(parts, b.String())
			b.Reset()
		}
	}
	for _, ch := range s {
		if ch == '│' || unicode.IsSpace(ch) {
			flush()
			continue
		}
		b.WriteRune(ch)
	}
	flush()
	return parts
}

func takeRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	i := 0
	for count := 0; count < n && i < len(s); count++ {
		_, size := utf8.DecodeRuneInString(s[i:])
		i += size
	}
	return s[:i]
}

// runProbe is run_probe. argv is an argument array (never a shell string).
// Timeout is 10s. Success text is stdout then stderr, lossy UTF-8, first display line.
func runProbe(argv []string) *string {
	if len(argv) == 0 {
		return nil
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Stdin = nil
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return nil
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	deadline := time.Now().Add(10 * time.Second)
	ticker := time.NewTicker(30 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case err := <-done:
			if err != nil {
				return nil
			}
			text := lossyUTF8(stdout.Bytes()) + lossyUTF8(stderr.Bytes())
			return pickLine(text)
		case <-ticker.C:
			if time.Now().After(deadline) {
				if cmd.Process != nil {
					_ = cmd.Process.Kill()
				}
				<-done
				return nil
			}
		}
	}
}

func lossyUTF8(b []byte) string {
	return strings.ToValidUTF8(string(b), "\uFFFD")
}

// doctorRender is render. name width is byte length (Rust String::len). Format
// width counts runes, matching Rust's formatter.
func doctorRender(report *DoctorReport, colorOn bool) string {
	nameW := 4
	for _, row := range report.Tools {
		if len(row.Name) > nameW {
			nameW = len(row.Name)
		}
	}
	var out strings.Builder
	for _, row := range report.Tools {
		mark, style := doctorMark(row.Status)
		ver := "-"
		if row.Version != nil {
			ver = *row.Version
		}
		fmt.Fprintf(&out, "%-*s  %s  %s\n", nameW, row.Name, Paint(fmt.Sprintf("%-4s", mark), style, colorOn), ver)
		for _, issue := range row.Issues {
			fmt.Fprintf(&out, "%-*s    - %s\n", nameW, "", issue)
		}
		if len(row.Env) > 0 {
			set := make([]string, 0)
			unset := make([]string, 0)
			for _, item := range row.Env {
				if item.Set {
					set = append(set, item.Name)
				} else {
					unset = append(unset, item.Name)
				}
			}
			fmt.Fprintf(&out, "%-*s    env 설정: [%s] 미설정: [%s]\n", nameW, "", strings.Join(set, ", "), strings.Join(unset, ", "))
		}
	}
	out.WriteByte('\n')
	labels := make([]string, 0, len(report.Runtimes))
	for _, runtime := range report.Runtimes {
		label := runtime.Name
		if !runtime.Found {
			label += "(없음)"
		}
		labels = append(labels, label)
	}
	fmt.Fprintf(&out, "런타임: %s\n", strings.Join(labels, " "))
	fmt.Fprintf(&out, "미설치 %d개, 문제 %d개\n", len(report.Missing), report.Problems-len(report.Missing))
	return out.String()
}

func doctorMark(status string) (string, []string) {
	switch status {
	case "ok":
		return "ok", []string{GREEN}
	case "unmanaged":
		return "밖", []string{YELLOW}
	case "missing":
		return "없음", []string{DIM}
	default:
		return "문제", []string{RED, BOLD}
	}
}
