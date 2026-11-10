package app

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"pk/internal/ui"
)

// Command is one packaged script launch. Args are forwarded after the script
// name, so `pk test --watch` becomes `bun run test --watch`.
type Command struct {
	PM     string
	Script string
	Args   []string
	Dir    string
}

// Env is the process surface of Run. The zero value uses the real terminal,
// working directory, state file, and package manager; tests replace fields.
type Env struct {
	Stdout    io.Writer
	Stderr    io.Writer
	Getwd     func() (string, error)
	StatePath string
	Pick      func([]ui.Item, ui.Options) (ui.Result, error)
	Exec      func(Command) int
	Now       func() time.Time
}

func (e Env) withDefaults() Env {
	if e.Stdout == nil {
		e.Stdout = os.Stdout
	}
	if e.Stderr == nil {
		e.Stderr = os.Stderr
	}
	if e.Getwd == nil {
		e.Getwd = os.Getwd
	}
	if e.StatePath == "" {
		e.StatePath = defaultStatePath()
	}
	if e.Pick == nil {
		e.Pick = ui.Run
	}
	if e.Exec == nil {
		e.Exec = runCommand
	}
	if e.Now == nil {
		e.Now = time.Now
	}
	return e
}

// Run parses args, finds the package, then either lists, picks, or runs one
// script. The returned int is the process exit code.
func Run(args []string, env Env) int {
	env = env.withDefaults()
	opts, err := parseArgs(args)
	if err != nil {
		fmt.Fprintln(env.Stderr, usageHint(err))
		return exitUsage
	}
	if opts.help {
		fmt.Fprint(env.Stdout, helpText)
		return exitOK
	}
	if opts.version {
		fmt.Fprintf(env.Stdout, "pk %s\n", Version)
		return exitOK
	}

	start := opts.dir
	if start == "" {
		start, err = env.Getwd()
		if err != nil {
			fmt.Fprintf(env.Stderr, "pk: 현재 디렉터리를 알 수 없습니다: %v\n", err)
			return exitFailure
		}
	}
	pkg, err := Discover(start)
	if err != nil {
		fmt.Fprintf(env.Stderr, "pk: %v\n  --pkg <dir> 로 시작 경로를 지정할 수 있습니다\n", err)
		return exitFailure
	}
	if opts.pm != "" {
		pkg.PM = opts.pm
	}

	state := loadStore(env.StatePath)
	recent := state.top(pkg.Dir, pkg.Names(), recentLimit)

	// --json is only meaningful as a list format, so it implies --list.
	if opts.list || opts.json {
		if err := printList(env.Stdout, pkg, recent, opts.json); err != nil {
			fmt.Fprintf(env.Stderr, "pk: %v\n", err)
			return exitFailure
		}
		return exitOK
	}

	if opts.script != "" {
		if !hasScript(pkg, opts.script) {
			fmt.Fprintf(env.Stderr, "pk: %s에 %q 스크립트가 없습니다\n  사용 가능: %s\n",
				pkg.File, opts.script, joinNames(pkg.Names()))
			return exitFailure
		}
		return launch(env, &state, pkg, opts.script, opts.forward)
	}

	items := buildItems(pkg, recent)
	chosen, pickErr := env.Pick(items, ui.Options{
		Title:    displayName(pkg),
		Subtitle: shortPath(pkg.Dir),
		Color:    colorFlag(opts.color),
	})
	switch {
	case errors.Is(pickErr, ui.ErrAborted):
		fmt.Fprintln(env.Stderr, "pk: 취소했습니다")
		return exitAbort
	case errors.Is(pickErr, ui.ErrNotTTY):
		fmt.Fprintln(env.Stderr, "pk: 인터랙티브 터미널이 아닙니다 — pk --list 또는 pk <script>를 쓰세요")
		return exitFailure
	case errors.Is(pickErr, ui.ErrEmpty):
		fmt.Fprintf(env.Stderr, "pk: %s에 스크립트가 없습니다\n", pkg.File)
		return exitFailure
	case pickErr != nil:
		fmt.Fprintf(env.Stderr, "pk: %v\n", pickErr)
		return exitFailure
	}
	return launch(env, &state, pkg, chosen.ID, nil)
}

// launch records the run, then hands the terminal to the package manager.
// The record is written before the script starts so a long-running dev server
// still counts once it is interrupted.
func launch(env Env, state *store, pkg Package, name string, forward []string) int {
	state.bump(pkg.Dir, name, env.Now())
	if err := saveStore(env.StatePath, *state); err != nil {
		fmt.Fprintf(env.Stderr, "pk: 최근 기록을 저장하지 못했습니다: %v\n", err)
	}
	fmt.Fprintf(env.Stderr, "pk › %s run %s\n", pkg.PM, name)
	return env.Exec(Command{PM: pkg.PM, Script: name, Args: forward, Dir: pkg.Dir})
}

// runCommand runs the package manager in the package directory with the
// terminal attached, and reports its exit code.
func runCommand(cmd Command) int {
	args := append([]string{"run", cmd.Script}, cmd.Args...)
	proc := exec.Command(cmd.PM, args...)
	proc.Dir = cmd.Dir
	proc.Stdin = os.Stdin
	proc.Stdout = os.Stdout
	proc.Stderr = os.Stderr
	proc.Env = os.Environ()
	if err := proc.Run(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return exitErr.ExitCode()
		}
		fmt.Fprintf(os.Stderr, "pk: %s를 실행하지 못했습니다: %v\n", cmd.PM, err)
		return exitFailure
	}
	return exitOK
}

// buildItems puts Recent first, then the remaining scripts in file order.
func buildItems(pkg Package, recent []recentEntry) []ui.Item {
	commands := make(map[string]string, len(pkg.Scripts))
	for _, s := range pkg.Scripts {
		commands[s.Name] = s.Command
	}
	seen := make(map[string]bool, len(recent))
	items := make([]ui.Item, 0, len(pkg.Scripts))
	for _, entry := range recent {
		seen[entry.Name] = true
		items = append(items, ui.Item{
			ID:     entry.Name,
			Label:  entry.Name,
			Group:  fmt.Sprintf("Recent (%d)", len(recent)),
			Detail: fmt.Sprintf("×%d  %s", entry.Count, commands[entry.Name]),
		})
	}
	rest := make([]ui.Item, 0, len(pkg.Scripts))
	for _, s := range pkg.Scripts {
		if seen[s.Name] {
			continue
		}
		rest = append(rest, ui.Item{ID: s.Name, Label: s.Name, Detail: s.Command})
	}
	if len(rest) > 0 {
		group := fmt.Sprintf("Scripts (%d)", len(rest))
		for i := range rest {
			rest[i].Group = group
		}
	}
	return append(items, rest...)
}

func hasScript(pkg Package, name string) bool {
	for _, s := range pkg.Scripts {
		if s.Name == name {
			return true
		}
	}
	return false
}

func joinNames(names []string) string {
	out := ""
	for i, name := range names {
		if i > 0 {
			out += ", "
		}
		out += name
	}
	return out
}

func colorFlag(value string) *bool {
	switch value {
	case "always":
		on := true
		return &on
	case "never":
		off := false
		return &off
	default:
		return nil
	}
}

// displayName is the list title: the package name, or the directory when
// package.json has no name.
func displayName(pkg Package) string {
	if pkg.Name != "" {
		return pkg.Name
	}
	return filepath.Base(pkg.Dir)
}
