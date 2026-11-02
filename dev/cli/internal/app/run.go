// run.go ports cli-rust/src/lib.rs dispatch (run, list, install/remove, update,
// audit, doctor, picker entry). Command parsing stays in args.go.
//
// Exit codes: 0 ok, 1 error (including non-TTY with no command, which prints
// help), 2 gate block or audit findings. Run maps those through ExitCode.
// render names already taken: audit render, doctorRender, updateRender, pluginRender.

package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"cli/internal/ui"
)

// errHelp is ExitError { help: true }. Run prints help and exits 1, with no
// "error:" line — matching main.rs.
var errHelp = errors.New("help")

// Run is cli::run. args are os.Args[1:].
func Run(args []string) int {
	opts, err := Parse(args)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return ExitCode(err)
	}
	err = dispatch(opts, DefaultManifestPath())
	if err == nil {
		return ExitOK
	}
	if errors.Is(err, errHelp) {
		PrintHelp()
		return ExitError
	}
	fmt.Fprintf(os.Stderr, "error: %s\n", err.Error())
	return ExitCode(err)
}

func dispatch(opts Options, manifestPath string) error {
	switch opts.Command {
	case CommandHelp:
		PrintHelp()
		return nil
	case CommandList:
		return list(manifestPath, opts.JSON)
	case CommandDefault:
		if isTerminal(os.Stdin) && isTerminal(os.Stderr) {
			return pick(manifestPath)
		}
		return errHelp
	case CommandInstall:
		return installOrRemove(&opts, manifestPath, true)
	case CommandRemove:
		return installOrRemove(&opts, manifestPath, false)
	case CommandDoctor:
		return runDoctor(manifestPath, opts.JSON)
	case CommandAudit:
		return runAudit(manifestPath, opts.JSON)
	case CommandUpdate:
		return runUpdate(&opts, manifestPath)
	default:
		return fmt.Errorf("unknown command")
	}
}

func installOrRemove(opts *Options, manifestPath string, install bool) error {
	if len(opts.Names) == 0 {
		verb := "install"
		if !install {
			verb = "remove"
		}
		return fmt.Errorf("사용법: cli %s <이름…>", verb)
	}
	manifest, err := LoadPath(manifestPath)
	if err != nil {
		return err
	}
	paths, err := PathsFromEnv()
	if err != nil {
		return err
	}
	prompt := TtyPrompt{}
	env := Env{
		Paths:        &paths,
		ManifestPath: manifestPath,
		CooldownDays: manifest.CooldownDays,
		Yes:          opts.Yes,
		DryRun:       opts.DryRun,
		Prompt:       prompt,
		Now:          time.Now().UTC(),
	}
	var failures failures
	for _, name := range opts.Names {
		tool := lookupTool(&manifest, name)
		if tool == nil {
			return fmt.Errorf("%s: tools.toml 에 없는 도구", name)
		}
		var outcome Outcome
		if install {
			outcome, err = installTool(&env, tool)
		} else {
			outcome, err = removeTool(&env, name)
		}
		if err != nil {
			failures.record(name, err)
			continue
		}
		switch outcome.Kind {
		case OutcomeInstalled:
			fmt.Printf("%s %s 설치됨 (검증: %s)\n", name, outcome.Version, outcome.Level)
		case OutcomeAlreadyInstalled:
			fmt.Printf("%s %s 이미 설치됨\n", name, outcome.Version)
		case OutcomeDryRun:
			fmt.Printf("[dry-run] %s %s: %s\n", name, outcome.Version, outcome.Decision)
		case OutcomeRemoved:
			fmt.Printf("%s 삭제됨\n", name)
		}
	}
	return failures.finish()
}

// failures keeps going after one tool fails and reports the heaviest exit code.
type failures struct {
	count int
	code  int
}

func (f *failures) record(name string, err error) {
	code := ExitCode(err)
	fmt.Fprintf(os.Stderr, "error: %s 실패: %s\n", name, err.Error())
	f.count++
	if code > f.code {
		f.code = code
	}
}

func (f failures) finish() error {
	if f.count == 0 {
		return nil
	}
	msg := fmt.Errorf("%d개 도구 실패", f.count)
	if f.code == ExitBlocked {
		return &BlockedError{Err: msg, Code: ExitBlocked}
	}
	return msg
}

func runUpdate(opts *Options, manifestPath string) error {
	manifest, err := LoadPath(manifestPath)
	if err != nil {
		return err
	}
	paths, err := PathsFromEnv()
	if err != nil {
		return err
	}
	lock, err := LoadLockFile(paths.LockJSON())
	if err != nil {
		return err
	}
	now := time.Now().UTC()

	var selected []*Tool
	if len(opts.Names) == 0 {
		for i := range manifest.Tools {
			if _, ok := lock.Tools[manifest.Tools[i].Name]; ok {
				selected = append(selected, &manifest.Tools[i])
			}
		}
	} else {
		for _, name := range opts.Names {
			tool := lookupTool(&manifest, name)
			if tool == nil {
				return fmt.Errorf("%s: tools.toml 에 없는 도구", name)
			}
			selected = append(selected, tool)
		}
	}

	if opts.Check {
		candidates := checkAll(selected, &lock, now, manifest.CooldownDays)
		if candidates == nil {
			candidates = []Candidate{}
		}
		if opts.JSON {
			return writeJSON(candidates)
		}
		fmt.Print(updateRender(candidates))
		return nil
	}
	if len(selected) == 0 {
		fmt.Println("cli 로 설치한 도구가 없습니다")
		return nil
	}

	prompt := TtyPrompt{}
	env := Env{
		Paths:        &paths,
		ManifestPath: manifestPath,
		CooldownDays: manifest.CooldownDays,
		Yes:          opts.Yes,
		DryRun:       opts.DryRun,
		Prompt:       prompt,
		Now:          now,
	}
	var failures failures
	for _, tool := range selected {
		var outcome Outcome
		if opts.Rollback {
			outcome, err = rollbackTool(&env, tool)
		} else {
			fetch, ferr := newHttpFetch(ForTool(tool))
			if ferr != nil {
				return ferr
			}
			outcome, err = updateTool(&env, tool, fetch)
		}
		name := tool.Name
		if err != nil {
			failures.record(name, err)
			continue
		}
		switch outcome.Kind {
		case OutcomeInstalled:
			verb := "업데이트됨"
			if opts.Rollback {
				verb = "되돌림"
			}
			fmt.Printf("%s %s %s (검증: %s)\n", name, outcome.Version, verb, outcome.Level)
		case OutcomeAlreadyInstalled:
			fmt.Printf("%s %s 최신\n", name, outcome.Version)
		case OutcomeDryRun:
			fmt.Printf("[dry-run] %s %s: %s\n", name, outcome.Version, outcome.Decision)
		case OutcomeRemoved:
		}
	}
	return failures.finish()
}

func runAudit(path string, jsonOut bool) error {
	manifest, err := LoadPath(path)
	if err != nil {
		return err
	}
	paths, err := PathsFromEnv()
	if err != nil {
		return err
	}
	lock, err := LoadLockFile(paths.LockJSON())
	if err != nil {
		return err
	}
	root := moduleRoot()
	report := audit(&manifest, &lock, paths, root, func(target *Target, outFile string) ([]VulnFinding, error) {
		return runOsv(paths.OsvBin, target, outFile)
	})
	if jsonOut {
		if err := writeJSON(report); err != nil {
			return err
		}
	} else {
		fmt.Print(render(&report))
	}
	code := report.ExitCode()
	if code == 0 {
		return nil
	}
	policyErrors := 0
	for _, finding := range report.Policy {
		if finding.Severity == "error" {
			policyErrors++
		}
	}
	msg := fmt.Errorf("audit: 정책 위반 %d건, 취약 패키지 %d개, 오류 %d건", policyErrors, len(report.Vulns), len(report.Errors))
	if code == ExitBlocked {
		return &BlockedError{Err: msg, Code: ExitBlocked}
	}
	return msg
}

// moduleRoot is the Go stand-in for CARGO_MANIFEST_DIR (audit scans go.mod/go.sum
// there, not Cargo.lock). CLI_ROOT wins; otherwise the directory two levels
// above the executable (<root>/bin/cli).
func moduleRoot() string {
	if root, ok := os.LookupEnv("CLI_ROOT"); ok && root != "" {
		return root
	}
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if resolved, rerr := filepath.EvalSymlinks(exe); rerr == nil {
		exe = resolved
	}
	return parentDir(parentDir(exe))
}

func runDoctor(path string, jsonOut bool) error {
	manifest, err := LoadPath(path)
	if err != nil {
		return err
	}
	paths, err := PathsFromEnv()
	if err != nil {
		return err
	}
	lock, err := LoadLockFile(paths.LockJSON())
	if err != nil {
		return err
	}
	var pathVar *string
	if value, ok := os.LookupEnv("PATH"); ok {
		pathVar = &value
	}
	report := inspect(&manifest, &lock, pathVar, func(name string) bool {
		value, ok := os.LookupEnv(name)
		return ok && value != ""
	}, runProbe)
	if jsonOut {
		if err := writeJSON(report); err != nil {
			return err
		}
	} else {
		fmt.Print(doctorRender(&report, StdoutEnabled()))
	}
	if report.Problems > 0 {
		return fmt.Errorf("doctor: 문제 %d개 (미설치 포함)", report.Problems)
	}
	return nil
}

func list(path string, jsonOut bool) error {
	manifest, err := LoadPath(path)
	if err != nil {
		return err
	}
	var pathVar *string
	if value, ok := os.LookupEnv("PATH"); ok {
		pathVar = &value
	}
	rows := listRows(&manifest, pathVar)
	if jsonOut {
		return writeJSON(rows)
	}
	printTable(rows)
	return nil
}

func writeJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

func pick(path string) error {
	manifest, err := LoadPath(path)
	if err != nil {
		return err
	}
	installed := installedVersions()
	items := pickerItems(manifest.Tools, installed)
	outcome, err := ui.Run(items, ui.Options{Title: "도구", Mode: ui.ModeMulti})
	if err != nil {
		return pickerErr(err)
	}
	chosen := append([]string{}, outcome.Selected...)
	command, check, ok := actionForKey(outcome.Action)
	if !ok {
		summary := ""
		if len(chosen) == 1 {
			summary = chosen[0]
		} else {
			summary = fmt.Sprintf("%d개 선택", len(chosen))
		}
		command, check, err = pickAction(summary)
		if err != nil {
			return err
		}
	}
	return dispatch(Options{
		Yes:      false,
		DryRun:   false,
		JSON:     false,
		Check:    check,
		Rollback: false,
		Names:    chosen,
		Command:  command,
	}, path)
}

func pickerErr(err error) error {
	switch {
	case errors.Is(err, ui.ErrAborted):
		return fmt.Errorf("취소")
	case errors.Is(err, ui.ErrNotTTY):
		return errHelp
	case errors.Is(err, ui.ErrEmpty):
		return fmt.Errorf("select list is empty")
	default:
		return err
	}
}

func installedVersions() map[string]string {
	paths, err := PathsFromEnv()
	if err != nil {
		return map[string]string{}
	}
	lock, err := LoadLockFile(paths.LockJSON())
	if err != nil {
		return map[string]string{}
	}
	out := make(map[string]string, len(lock.Tools))
	for name, entry := range lock.Tools {
		out[name] = entry.Version
	}
	return out
}

type actionSpec struct {
	label   string
	command Command
	check   bool
}

var actions = []actionSpec{
	{"설치", CommandInstall, false},
	{"삭제", CommandRemove, false},
	{"업데이트 확인", CommandUpdate, true},
	{"업데이트", CommandUpdate, false},
}

// actionForKey maps i/x/c/u. Enter ("\r") and ui.ActionMenu are not actions —
// the work menu opens instead. ui.ActionAccept is also not a list-screen key.
func actionForKey(key string) (Command, bool, bool) {
	index := -1
	switch key {
	case "i":
		index = 0
	case "x":
		index = 1
	case "c":
		index = 2
	case "u":
		index = 3
	default:
		return 0, false, false
	}
	return actions[index].command, actions[index].check, true
}

func pickAction(name string) (Command, bool, error) {
	items := make([]ui.Item, len(actions))
	// Rust select_one("작업", section titled "{name} — 작업"). A known
	// category would become "other (n)"; ModeOne keeps this string as the header.
	section := name + " — 작업"
	for i, action := range actions {
		items[i] = ui.Item{ID: fmt.Sprintf("%d", i), Label: action.label, Category: section}
	}
	outcome, err := ui.Run(items, ui.Options{Title: "작업", Mode: ui.ModeOne})
	if err != nil {
		if errors.Is(err, ui.ErrAborted) {
			return 0, false, fmt.Errorf("취소")
		}
		return 0, false, err
	}
	if len(outcome.Selected) == 0 {
		return 0, false, fmt.Errorf("취소")
	}
	index := -1
	for i := range actions {
		if outcome.Selected[0] == fmt.Sprintf("%d", i) {
			index = i
			break
		}
	}
	if index < 0 {
		return 0, false, fmt.Errorf("취소")
	}
	return actions[index].command, actions[index].check, nil
}

type listRow struct {
	Name      string  `json:"name"`
	Method    string  `json:"method"`
	Priority  string  `json:"priority"`
	Group     string  `json:"group"`
	Installed bool    `json:"installed"`
	Version   *string `json:"version"`
}

func listRows(manifest *Manifest, pathVar *string) []listRow {
	rows := make([]listRow, 0, len(manifest.Tools))
	for i := range manifest.Tools {
		tool := &manifest.Tools[i]
		rows = append(rows, listRow{
			Name:      tool.Name,
			Method:    tool.Method.AsStr(),
			Priority:  tool.Priority,
			Group:     tool.Group,
			Installed: exeInPath(tool.ExeName(), pathVar),
			Version:   tool.Version,
		})
	}
	return rows
}

func printTable(rows []listRow) {
	enabled := StdoutEnabled()
	nameW := colWidth(rows, "name", func(row listRow) int { return len(row.Name) })
	methodW := colWidth(rows, "method", func(row listRow) int { return len(row.Method) })
	priorityW := colWidth(rows, "priority", func(row listRow) int { return len(row.Priority) })
	groupW := colWidth(rows, "group", func(row listRow) int { return len(row.Group) })
	fmt.Printf("%s %s %s %s %s\n",
		Paint(padRight("name", nameW), []string{BOLD, DIM}, enabled),
		Paint(padRight("method", methodW), []string{BOLD, DIM}, enabled),
		Paint(padRight("priority", priorityW), []string{BOLD, DIM}, enabled),
		Paint(padRight("group", groupW), []string{BOLD, DIM}, enabled),
		Paint("installed", []string{BOLD, DIM}, enabled),
	)
	for _, spec := range []struct {
		label string
		rank  int
	}{{"P1", 0}, {"P2", 1}, {"P3", 2}} {
		group := make([]listRow, 0)
		for _, row := range rows {
			if priorityRank(row.Priority) == spec.rank {
				group = append(group, row)
			}
		}
		if len(group) == 0 {
			continue
		}
		color := PriorityColor(spec.label)
		fmt.Println()
		fmt.Println(Paint(fmt.Sprintf("%s (%d)", spec.label, len(group)), []string{BOLD, color}, enabled))
		for _, row := range group {
			installed := "no"
			style := []string{DIM}
			if row.Installed {
				installed = "yes"
				style = []string{GREEN}
			}
			fmt.Printf("%s %s %s %s %s\n",
				Paint(padRight(row.Name, nameW), []string{color}, enabled),
				padRight(row.Method, methodW),
				padRight(row.Priority, priorityW),
				padRight(row.Group, groupW),
				Paint(installed, style, enabled),
			)
		}
	}
	other := make([]listRow, 0)
	for _, row := range rows {
		if priorityRank(row.Priority) > 2 {
			other = append(other, row)
		}
	}
	if len(other) == 0 {
		return
	}
	fmt.Println()
	fmt.Println(Paint(fmt.Sprintf("Other (%d)", len(other)), []string{BOLD, DIM}, enabled))
	for _, row := range other {
		installed := "no"
		if row.Installed {
			installed = "yes"
		}
		fmt.Printf("%s %s %s %s %s\n",
			padRight(row.Name, nameW),
			padRight(row.Method, methodW),
			padRight(row.Priority, priorityW),
			padRight(row.Group, groupW),
			installed,
		)
	}
}

func colWidth(rows []listRow, header string, field func(listRow) int) int {
	width := len(header)
	for _, row := range rows {
		if n := field(row); n > width {
			width = n
		}
	}
	return width
}

func priorityRank(priority string) int {
	switch priority {
	case "P1":
		return 0
	case "P2":
		return 1
	case "P3":
		return 2
	default:
		return 3
	}
}

var pickerCategories = []string{"cloud", "payment", "database", "ai", "social", "security"}

func categoryOfTool(tool *Tool) string {
	for _, category := range pickerCategories {
		if tool.Category == category {
			return category
		}
	}
	return "other"
}

type pickerChoice struct {
	label string
	note  string
}

type pickerSection struct {
	title   string
	choices []pickerChoice
}

func pickerSections(tools []Tool, installed map[string]string) []pickerSection {
	sections := make([]pickerSection, 0)
	labels := append(append([]string{}, pickerCategories...), "other")
	for _, label := range labels {
		choices := make([]pickerChoice, 0)
		for i := range tools {
			tool := &tools[i]
			if categoryOfTool(tool) != label {
				continue
			}
			note := "미설치"
			if version, ok := installed[tool.Name]; ok {
				note = "설치됨 " + version
			} else if tool.Status == StatusPending {
				note = "대기(pending)"
			}
			choices = append(choices, pickerChoice{label: tool.Name, note: note})
		}
		if len(choices) == 0 {
			continue
		}
		sections = append(sections, pickerSection{
			title:   fmt.Sprintf("%s (%d)", label, len(choices)),
			choices: choices,
		})
	}
	return sections
}

func pickerItems(tools []Tool, installed map[string]string) []ui.Item {
	items := make([]ui.Item, 0, len(tools))
	for _, section := range pickerSections(tools, installed) {
		category := section.title
		if i := strings.IndexByte(category, ' '); i >= 0 {
			category = category[:i]
		}
		for _, choice := range section.choices {
			items = append(items, ui.Item{
				ID:       choice.label,
				Label:    choice.label,
				Category: category,
				Detail:   choice.note,
			})
		}
	}
	return items
}

func lookupTool(manifest *Manifest, name string) *Tool {
	if manifest == nil {
		return nil
	}
	for i := range manifest.Tools {
		if manifest.Tools[i].Name == name {
			return &manifest.Tools[i]
		}
	}
	return nil
}

// exeInPath is exe_in_path. A nil path is Rust None. An empty PATH still
// searches the empty component (current directory), matching split_paths.
func exeInPath(exe string, pathVar *string) bool {
	if pathVar == nil {
		return false
	}
	if exe == "" || strings.Contains(exe, "/") || strings.ContainsRune(exe, 0) {
		return false
	}
	for _, dir := range strings.Split(*pathVar, string(os.PathListSeparator)) {
		if isExecutable(pathJoin(dir, exe)) {
			return true
		}
	}
	return false
}
