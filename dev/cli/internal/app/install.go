// install.go ports cli-rust/src/install.rs.
//
// Download, gate, then approve, then proto plugin add/install, then .protolock
// cross-check, then lock.json. A hash mismatch uninstalls that proto version.
// The temp download dir is always removed. --dry-run and a refused approval
// change nothing. --yes skips the install confirm only; a pin still needs a TTY.
// A non-TTY without --yes is an error. Guard has no Drop: Close is deferred.

package app

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

const DefaultKeyserver = "hkps://keyserver.ubuntu.com"

// OutcomeKind is the install/update result tag.
type OutcomeKind string

const (
	OutcomeInstalled        OutcomeKind = "installed"
	OutcomeAlreadyInstalled OutcomeKind = "already_installed"
	OutcomeDryRun           OutcomeKind = "dry_run"
	OutcomeRemoved          OutcomeKind = "removed"
)

// Outcome is install::Outcome. Level is set for Installed. Decision is set for DryRun.
type Outcome struct {
	Kind     OutcomeKind
	Version  string
	Level    string
	Decision string
}

// Prompt is install::Prompt. Interactive is false when stdin or stderr is not a TTY.
type Prompt interface {
	Interactive() bool
	Confirm(message string) bool
}

// TtyPrompt reads y/Y/yes/YES from stdin. Anything else, including a read error, is no.
type TtyPrompt struct{}

func (TtyPrompt) Interactive() bool {
	return isTerminal(os.Stdin) && isTerminal(os.Stderr)
}

func (TtyPrompt) Confirm(message string) bool {
	fmt.Fprintf(os.Stderr, "%s [y/N] ", message)
	_ = os.Stderr.Sync()
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return false
	}
	if err != nil && line == "" {
		return false
	}
	switch strings.TrimSpace(line) {
	case "y", "Y", "yes", "YES":
		return true
	default:
		return false
	}
}

// Env is install::Env. Paths is a pointer because pkg plans take *Paths.
type Env struct {
	Paths        *Paths
	ManifestPath string
	CooldownDays uint32
	Yes          bool
	DryRun       bool
	Prompt       Prompt
	Now          time.Time
}

func expand(template, version string) string {
	return strings.ReplaceAll(template, "{version}", version)
}

// approve asks before a write. --yes skips the prompt. Non-TTY without --yes is an error.
func approve(env *Env, message string) error {
	if env.Yes {
		return nil
	}
	if env.Prompt == nil || !env.Prompt.Interactive() {
		return fmt.Errorf("승인이 필요합니다: 터미널에서 실행하거나 --yes 를 붙이세요")
	}
	if env.Prompt.Confirm(message) {
		return nil
	}
	return fmt.Errorf("취소")
}

func installTool(env *Env, tool *Tool) (Outcome, error) {
	return installToolWith(env, tool, false)
}

// installToolWith replaces an installed version when replace is true (update, rollback).
func installToolWith(env *Env, tool *Tool, replace bool) (Outcome, error) {
	lock, err := LoadLockFile(env.Paths.LockJSON())
	if err != nil {
		return Outcome{}, err
	}
	if entry, ok := lock.Tools[tool.Name]; ok {
		if tool.Version != nil && strings.TrimLeft(*tool.Version, "v") == strings.TrimLeft(entry.Version, "v") {
			return Outcome{Kind: OutcomeAlreadyInstalled, Version: entry.Version}, nil
		}
		if !replace {
			return Outcome{}, fmt.Errorf("%s %s 가 이미 설치됨. 버전을 바꾸려면 cli update %s", tool.Name, entry.Version, tool.Name)
		}
	}

	if tool.Version != nil && isPrerelease(*tool.Version) {
		return Outcome{}, blockedPrerelease(*tool.Version)
	}

	if tool.Method == MethodBun || tool.Method == MethodGo || tool.Method == MethodCargo {
		return install(env, tool, replace)
	}

	policy := ForTool(tool)
	hc, err := client(policy)
	if err != nil {
		return Outcome{}, err
	}
	fetch, err := newHttpFetch(policy)
	if err != nil {
		return Outcome{}, err
	}

	pending := tool.Status == StatusPending
	var version string
	switch {
	case tool.Version != nil && *tool.Version != "":
		version = *tool.Version
	case pending && tool.Method == MethodVendor:
		latest, err := latestCandidate(tool, fetch)
		if err != nil {
			return Outcome{}, fmt.Errorf("%s: version_from 이 없으면 tools.toml 에 version 을 직접 적어야 합니다: %w", tool.Name, err)
		}
		version = latest
	default:
		return Outcome{}, fmt.Errorf("%s: tools.toml 에 version 이 없습니다", tool.Name)
	}

	var artifactURL, artifactName string
	var checksumURL, sigURL, tag *string
	var published time.Time
	if tool.Method == MethodRelease {
		if tool.Repo == nil {
			return Outcome{}, fmt.Errorf("missing repo")
		}
		repo := *tool.Repo
		releaseTag, publishedAt, err := releaseInfo(tool, version, fetch)
		if err != nil {
			return Outcome{}, err
		}
		published = publishedAt
		tag = &releaseTag
		base := "https://github.com/" + repo + "/releases/download/" + releaseTag
		if tool.Asset == nil {
			return Outcome{}, fmt.Errorf("missing asset")
		}
		asset := expand(*tool.Asset, version)
		if tool.Checksum == nil {
			return Outcome{}, fmt.Errorf("missing checksum")
		}
		checksum := expand(*tool.Checksum, version)
		artifactURL = base + "/" + asset
		artifactName = asset
		sumURL := base + "/" + checksum
		checksumURL = &sumURL
		if tool.Sig != nil {
			signed := base + "/" + expand(*tool.Sig, version)
			sigURL = &signed
		}
	} else {
		if tool.URL == nil {
			return Outcome{}, fmt.Errorf("missing url")
		}
		artifactURL = *tool.URL
		artifactName = urlTail(artifactURL, "artifact")
		published, err = publishedAt(tool, version, fetch)
		if err != nil {
			return Outcome{}, err
		}
		sigURL = tool.SigURL
	}

	// Cooldown before download. A blocked artifact is not fetched.
	if err := checkCooldown(published, env.Now, env.CooldownDays); err != nil {
		var violation *CooldownViolation
		if errors.As(err, &violation) {
			return Outcome{}, blockedFromCooldown(violation)
		}
		return Outcome{}, err
	}

	tmp := env.Paths.TmpDir(tool.Name)
	_ = os.RemoveAll(tmp)
	if err := os.MkdirAll(tmp, 0o777); err != nil {
		return Outcome{}, err
	}
	defer os.RemoveAll(tmp)
	return gateAndInstall(env, tool, version, &policy, hc, artifactURL, artifactName, checksumURL, sigURL, tag, published, tmp)
}

func gateAndInstall(
	env *Env,
	tool *Tool,
	version string,
	policy *HostPolicy,
	hc *httpClient,
	artifactURL, artifactName string,
	checksumURL, sigURL, tag *string,
	published time.Time,
	tmp string,
) (Outcome, error) {
	artifact := pathJoin(tmp, artifactName)
	fmt.Fprintf(os.Stderr, "내려받는 중: %s\n", artifactURL)
	if err := download(hc, policy, artifactURL, artifact); err != nil {
		return Outcome{}, err
	}

	var checksumsText *string
	var checksumFile *string
	if checksumURL != nil {
		text, err := getText(hc, policy, *checksumURL)
		if err != nil {
			return Outcome{}, err
		}
		checksumsText = &text
		path := pathJoin(tmp, urlTail(*checksumURL, "checksums"))
		if err := os.WriteFile(path, []byte(text), 0o666); err != nil {
			return Outcome{}, err
		}
		checksumFile = &path
	}
	var sigFile *string
	if sigURL != nil {
		path := pathJoin(tmp, urlTail(*sigURL, "sig"))
		if err := download(hc, policy, *sigURL, path); err != nil {
			return Outcome{}, err
		}
		sigFile = &path
	}

	var sig *SigInput
	if sigFile != nil {
		input := SigInput{
			SigFile:   *sigFile,
			KeySource: keySource(env, tool),
		}
		if checksumFile != nil {
			input.SignedFile = *checksumFile
			input.Covers = SigCoversChecksumFile
		} else {
			input.SignedFile = artifact
			input.Covers = SigCoversArtifact
		}
		sig = &input
	}

	decision, err := evaluate(&GateInput{
		Tool:          tool,
		Artifact:      artifact,
		ChecksumsText: checksumsText,
		AssetName:     artifactName,
		Sig:           sig,
		Published:     published,
		Now:           env.Now,
		CooldownDays:  env.CooldownDays,
	})
	if err != nil {
		return Outcome{}, err
	}

	var level Level
	var sha256 string
	switch decision.Kind {
	case DecisionAllowed:
		level = decision.Level
		sha256 = decision.SHA256
	case DecisionNeedsPin:
		sha256 = decision.SHA256
		if env.DryRun {
			return Outcome{
				Kind:     OutcomeDryRun,
				Version:  version,
				Decision: fmt.Sprintf("pin 승인 필요 (sha256 %s)", sha256),
			}, nil
		}
		// --yes does not approve a new pin. A non-TTY cannot pin.
		if env.Prompt == nil || !env.Prompt.Interactive() {
			return Outcome{}, fmt.Errorf("%s: sha256 고정 승인은 터미널에서만 할 수 있습니다 (%s)", tool.Name, sha256)
		}
		question := fmt.Sprintf("%s %s 의 sha256 %s 을 tools.toml 에 고정할까요?", tool.Name, version, sha256)
		if !env.Prompt.Confirm(question) {
			return Outcome{}, blockedNoVerification()
		}
		pinnedVersion := version
		if err := writePin(env.ManifestPath, tool.Name, sha256, &pinnedVersion); err != nil {
			return Outcome{}, err
		}
		level = LevelPinned
	default:
		return Outcome{}, fmt.Errorf("unknown gate decision %s", decision.Kind)
	}

	if env.DryRun {
		return Outcome{
			Kind:     OutcomeDryRun,
			Version:  version,
			Decision: fmt.Sprintf("통과: %s (sha256 %s)", level.AsStr(), sha256),
		}, nil
	}

	if err := approve(env, fmt.Sprintf("%s %s (%s) 를 설치할까요?", tool.Name, version, level.AsStr())); err != nil {
		return Outcome{}, err
	}

	// A first install of a pending tool pins the verified version and hash.
	if tool.Status == StatusPending {
		pinnedVersion := version
		if err := writePin(env.ManifestPath, tool.Name, sha256, &pinnedVersion); err != nil {
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
	pluginFile := env.Paths.PluginFile(tool.Name)
	rendered, err := pluginRender(tool, version, tag)
	if err != nil {
		return Outcome{}, err
	}
	if err := os.WriteFile(pluginFile, []byte(rendered), 0o666); err != nil {
		return Outcome{}, err
	}
	proto := Proto{Paths: env.Paths}
	if err := proto.PluginAdd(tool.Name, pluginFile); err != nil {
		return Outcome{}, err
	}
	if err := proto.Install(tool.Name, version); err != nil {
		return Outcome{}, err
	}

	// Cross-check: the hash proto recorded must match the hash cli verified.
	text, readErr := os.ReadFile(env.Paths.Protolock())
	recorded, ok := "", false
	if readErr == nil {
		recorded, ok = protolockSha256(string(text), tool.Name, version)
	}
	if !ok {
		fmt.Fprintf(os.Stderr, "경고: .protolock 에 %s %s 기록이 없어 교차 대조를 건너뜀\n", tool.Name, version)
	} else if recorded != sha256 {
		_ = proto.Uninstall(tool.Name, version)
		return Outcome{}, blockedHash(ChecksumMismatch{Expected: sha256, Actual: recorded})
	}

	saved, err := LoadLockFile(env.Paths.LockJSON())
	if err != nil {
		return Outcome{}, err
	}
	if saved.Tools == nil {
		saved.Tools = map[string]LockEntry{}
	}
	saved.Tools[tool.Name] = LockEntry{
		Method:      tool.Method.AsStr(),
		Version:     version,
		Source:      artifactURL,
		Digest:      sha256,
		Level:       level.AsStr(),
		Package:     "",
		Bin:         env.Paths.Shim(tool.ExeName()),
		InstalledAt: formatRFC3339(env.Now),
		Previous:    previousOf(&saved, tool.Name, version),
	}
	if err := saved.Save(env.Paths.LockJSON()); err != nil {
		return Outcome{}, err
	}
	return Outcome{Kind: OutcomeInstalled, Version: version, Level: level.AsStr()}, nil
}

// previousOf is the previous version when the lock has a different one (rollback target).
func previousOf(lock *LockFile, name, newVersion string) *string {
	if lock == nil || lock.Tools == nil {
		return nil
	}
	entry, ok := lock.Tools[name]
	if !ok || entry.Version == newVersion {
		return nil
	}
	version := entry.Version
	return &version
}

func keySource(env *Env, tool *Tool) KeySource {
	if tool.KeyFile != nil {
		return KeySource{Kind: KeySourceFile, Value: pathJoin(manifestDir(env.ManifestPath), *tool.KeyFile)}
	}
	return KeySource{Kind: KeySourceKeyserver, Value: DefaultKeyserver}
}

// manifestDir is Path::parent, or "." when parent is None (empty path or "/").
func manifestDir(path string) string {
	if path == "" || path == "/" {
		return "."
	}
	return parentDir(path)
}

// urlTail is rsplit('/').next().unwrap_or(fallback). An empty last segment is kept.
func urlTail(raw, fallback string) string {
	i := strings.LastIndex(raw, "/")
	if i < 0 {
		if raw == "" {
			return fallback
		}
		return raw
	}
	return raw[i+1:]
}

func isPkg(method string) bool {
	return method == "bun" || method == "go" || method == "cargo"
}

func removeTool(env *Env, name string) (Outcome, error) {
	lock, err := LoadLockFile(env.Paths.LockJSON())
	if err != nil {
		return Outcome{}, err
	}
	entry, ok := lock.Tools[name]
	if !ok {
		return Outcome{}, fmt.Errorf("%s: cli 가 설치한 기록이 없습니다 (lock.json)", name)
	}
	if env.DryRun {
		decision := ""
		if isPkg(entry.Method) {
			decision = describeRemoval(env.Paths, &entry)
		} else {
			decision = fmt.Sprintf("삭제 대상: proto %s %s, 플러그인 %s", name, entry.Version, env.Paths.PluginFile(name))
		}
		return Outcome{Kind: OutcomeDryRun, Version: entry.Version, Decision: decision}, nil
	}
	var question string
	if isPkg(entry.Method) {
		question = fmt.Sprintf("%s %s 를 삭제할까요? (%s)", name, entry.Version, describeRemoval(env.Paths, &entry))
	} else {
		question = fmt.Sprintf("%s %s 를 삭제할까요? (proto 설치본, 전역 핀, 플러그인 %s, lock 기록)", name, entry.Version, env.Paths.PluginFile(name))
	}
	if err := approve(env, question); err != nil {
		return Outcome{}, err
	}
	guard, err := AcquireGuard(env.Paths.LockJSON())
	if err != nil {
		return Outcome{}, err
	}
	defer guard.Close()
	if isPkg(entry.Method) {
		if err := uninstall(env.Paths, &entry); err != nil {
			return Outcome{}, err
		}
		delete(lock.Tools, name)
		if err := lock.Save(env.Paths.LockJSON()); err != nil {
			return Outcome{}, err
		}
		return Outcome{Kind: OutcomeRemoved}, nil
	}
	proto := Proto{Paths: env.Paths}
	if err := proto.Uninstall(name, entry.Version); err != nil {
		return Outcome{}, err
	}
	_ = proto.PluginRemove(name)
	_ = os.Remove(env.Paths.PluginFile(name))
	delete(lock.Tools, name)
	if err := lock.Save(env.Paths.LockJSON()); err != nil {
		return Outcome{}, err
	}
	return Outcome{Kind: OutcomeRemoved}, nil
}
