// pkg.go ports cli-rust/src/pkg.rs.
//
// bun / go / cargo install and remove. Cooldown is checked here before the
// official command runs. State is written only to lock.json.
// Commands are argv arrays (no shell). Tests do not execute bun, go, or cargo.
//
// install returns install::Outcome and takes install::Env (stubbed until that
// port lands). Cooldown and hash failures are *BlockedError so ExitCode is
// ExitBlocked, matching gate::Blocked::Cooldown / HashMismatch display+code.
// Guard has no Drop: Close is deferred.

package app

import (
	"fmt"
	"os"
	"strings"
	"time"
)

// Plan is one external command: program, argv, extra env pairs.
type Plan struct {
	Program string
	Args    []string
	Envs    [][2]string
}

func bunInstallPlan(paths *Paths, pkg, version string, cooldownDays uint32) Plan {
	return Plan{
		Program: paths.BunBin,
		Args: []string{
			"add",
			"-g",
			pkg + "@" + version,
			// lifecycle scripts of dependencies are not run, and the same cooldown applies to them.
			"--ignore-scripts",
			fmt.Sprintf("--minimum-release-age=%d", uint64(cooldownDays)*86_400),
		},
	}
}

func bunRemovePlan(paths *Paths, pkg string) Plan {
	return Plan{
		Program: paths.BunBin,
		Args:    []string{"remove", "-g", pkg},
	}
}

func goInstallPlan(paths *Paths, module, version string) Plan {
	return Plan{
		Program: paths.GoBin,
		Args:    []string{"install", module + "@" + goVersion(version)},
		Envs:    [][2]string{{"GOBIN", paths.BinDir()}},
	}
}

func cargoInstallPlan(paths *Paths, pkg, version string) Plan {
	return Plan{
		Program: paths.CargoBin,
		Args: []string{
			"install",
			"--locked",
			"--root",
			paths.Prefix,
			pkg + "@" + version,
		},
	}
}

func cargoUninstallPlan(paths *Paths, pkg string) Plan {
	return Plan{
		Program: paths.CargoBin,
		Args:    []string{"uninstall", "--root", paths.Prefix, pkg},
	}
}

// goVersion prefixes v. Go modules are addressed as module@vX.Y.Z.
func goVersion(version string) string {
	if strings.HasPrefix(version, "v") {
		return version
	}
	return "v" + version
}

func plainVersion(version string) string {
	return strings.TrimPrefix(version, "v")
}

func run(paths *Paths, plan *Plan) error {
	return runExternal(plan.Program, plan.Args, paths.CliHome, plan.Envs)
}

// binPath is where the executable is placed.
func binPath(paths *Paths, tool *Tool) string {
	if tool.Method == MethodBun {
		return pathJoin(paths.BunGlobalBin(), tool.ExeName())
	}
	return pathJoin(paths.BinDir(), tool.ExeName())
}

func packageOf(tool *Tool) (string, error) {
	var value *string
	if tool.Method == MethodGo {
		value = tool.Module
	} else {
		value = tool.Package
	}
	if value != nil {
		text := strings.TrimSpace(*value)
		if text != "" {
			return text, nil
		}
	}
	return "", fmt.Errorf("%s: package/module 이 없습니다", tool.Name)
}

// bunLockIntegrity is the first sha512-… value after the "package@version" key in bun.lock.
func bunLockIntegrity(text, pkg, version string) (string, bool) {
	key := `"` + pkg + "@" + version + `"`
	idx := strings.Index(text, key)
	if idx < 0 {
		return "", false
	}
	rest := text[idx+len(key):]
	start := strings.Index(rest, "sha512-")
	if start < 0 {
		return "", false
	}
	var b strings.Builder
	for _, ch := range rest[start:] {
		if isIntegrityChar(ch) {
			b.WriteRune(ch)
			continue
		}
		break
	}
	return b.String(), true
}

func isIntegrityChar(ch rune) bool {
	if ch < 0x80 && ((ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) {
		return true
	}
	return ch == '+' || ch == '/' || ch == '=' || ch == '-'
}

func install(env *Env, tool *Tool, _ bool) (Outcome, error) {
	pkg, err := packageOf(tool)
	if err != nil {
		return Outcome{}, err
	}
	fetch, err := newHttpFetch(ForTool(tool))
	if err != nil {
		return Outcome{}, err
	}

	pending := tool.Status == StatusPending
	var version string
	switch {
	case tool.Version != nil && *tool.Version != "":
		version = plainVersion(*tool.Version)
	case pending:
		latest, err := latestCandidate(tool, fetch)
		if err != nil {
			return Outcome{}, err
		}
		version = plainVersion(latest)
	default:
		return Outcome{}, fmt.Errorf("%s: tools.toml 에 version 이 없습니다", tool.Name)
	}

	var published time.Time
	var integrity *string
	if tool.Method == MethodBun {
		published, integrity, err = npmVersionInfo(tool, version, fetch)
	} else {
		published, err = publishedAt(tool, version, fetch)
	}
	if err != nil {
		return Outcome{}, err
	}
	if err := checkCooldown(published, env.Now, env.CooldownDays); err != nil {
		return Outcome{}, &BlockedError{Err: err}
	}

	var plan Plan
	var level string
	switch tool.Method {
	case MethodBun:
		plan = bunInstallPlan(env.Paths, pkg, version, env.CooldownDays)
		level = "registry"
	case MethodGo:
		plan = goInstallPlan(env.Paths, pkg, version)
		level = "sumdb"
	default:
		plan = cargoInstallPlan(env.Paths, pkg, version)
		level = "locked"
	}

	if env.DryRun {
		return Outcome{
			Kind:    OutcomeDryRun,
			Version: version,
			Decision: fmt.Sprintf(
				"통과: cooldown %d일 이상 (%s), 실행: %s %s",
				env.CooldownDays,
				published.UTC().Format("2006-01-02"),
				plan.Program,
				strings.Join(plan.Args, " "),
			),
		}, nil
	}

	if err := approve(env, fmt.Sprintf("%s %s (%s) 를 설치할까요?", tool.Name, version, level)); err != nil {
		return Outcome{}, err
	}
	if pending {
		if err := writeVersion(env.ManifestPath, tool.Name, version); err != nil {
			return Outcome{}, err
		}
	}

	guard, err := AcquireGuard(env.Paths.LockJSON())
	if err != nil {
		return Outcome{}, err
	}
	defer guard.Close()
	if err := env.Paths.EnsureCliHome(); err != nil {
		return Outcome{}, err
	}
	if tool.Method == MethodGo || tool.Method == MethodCargo {
		if err := os.MkdirAll(env.Paths.BinDir(), 0o777); err != nil {
			return Outcome{}, err
		}
	}
	if err := run(env.Paths, &plan); err != nil {
		return Outcome{}, err
	}

	bin := binPath(env.Paths, tool)
	if _, err := os.Stat(bin); err != nil {
		return Outcome{}, fmt.Errorf("%s: 설치 후 실행 파일 %s 이 없습니다 (tools.toml 의 bin 이 실제 이름과 같은지 확인)", tool.Name, bin)
	}

	// bun: integrity recorded in the global lock must match the registry value.
	if tool.Method == MethodBun {
		if integrity != nil {
			text, err := os.ReadFile(env.Paths.BunGlobalLock())
			if err == nil {
				if actual, ok := bunLockIntegrity(string(text), pkg, version); ok {
					if actual != *integrity {
						_ = run(env.Paths, ptrPlan(bunRemovePlan(env.Paths, pkg)))
						return Outcome{}, &BlockedError{Err: ChecksumMismatch{Expected: *integrity, Actual: actual}}
					}
				} else {
					fmt.Fprintf(os.Stderr, "경고: bun.lock 에 %s@%s integrity 가 없어 교차 대조를 건너뜀\n", pkg, version)
				}
			}
		}
	}

	lock, err := LoadLockFile(env.Paths.LockJSON())
	if err != nil {
		return Outcome{}, err
	}
	if lock.Tools == nil {
		lock.Tools = map[string]LockEntry{}
	}
	var source string
	switch tool.Method {
	case MethodBun:
		source = "https://registry.npmjs.org/" + pkg
	case MethodGo:
		source = "https://proxy.golang.org/" + pkg
	default:
		source = "https://crates.io/crates/" + pkg
	}
	digest := ""
	if integrity != nil {
		digest = *integrity
	}
	lock.Tools[tool.Name] = LockEntry{
		Method:      tool.Method.AsStr(),
		Version:     version,
		Source:      source,
		Digest:      digest,
		Level:       level,
		Package:     pkg,
		Bin:         bin,
		InstalledAt: formatRFC3339(env.Now),
		Previous:    previousOf(&lock, tool.Name, version),
	}
	if err := lock.Save(env.Paths.LockJSON()); err != nil {
		return Outcome{}, err
	}
	return Outcome{Kind: OutcomeInstalled, Version: version, Level: level}, nil
}

func ptrPlan(plan Plan) *Plan { return &plan }

// describeRemoval is a human-readable removal plan.
func describeRemoval(paths *Paths, entry *LockEntry) string {
	switch entry.Method {
	case "bun":
		return "bun remove -g " + entry.Package
	case "cargo":
		return "cargo uninstall --root " + paths.Prefix + " " + entry.Package
	default:
		return "파일 삭제 " + entry.Bin
	}
}

func uninstall(paths *Paths, entry *LockEntry) error {
	switch entry.Method {
	case "bun":
		return run(paths, ptrPlan(bunRemovePlan(paths, entry.Package)))
	case "cargo":
		return run(paths, ptrPlan(cargoUninstallPlan(paths, entry.Package)))
	case "go":
		// go has no uninstall. Remove only the binary recorded in the lock.
		bin := entry.Bin
		if !pathHasPrefix(bin, paths.BinDir()) {
			return fmt.Errorf("%s 는 %s 밖이라 지우지 않습니다", bin, paths.BinDir())
		}
		err := os.Remove(bin)
		if err == nil || os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("remove %s: %w", bin, err)
	default:
		return fmt.Errorf("%s: 지원하지 않는 방식", entry.Method)
	}
}

// pathHasPrefix is Rust Path::starts_with: whole components, no Clean.
func pathHasPrefix(path, prefix string) bool {
	if strings.HasPrefix(path, "/") != strings.HasPrefix(prefix, "/") {
		return false
	}
	pc := pathComponents(path)
	fc := pathComponents(prefix)
	if len(fc) > len(pc) {
		return false
	}
	for i := range fc {
		if pc[i] != fc[i] {
			return false
		}
	}
	return true
}

func pathComponents(p string) []string {
	if p == "" || p == "/" {
		return nil
	}
	p = strings.TrimSuffix(p, "/")
	parts := strings.Split(p, "/")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "" {
			continue
		}
		out = append(out, part)
	}
	return out
}
