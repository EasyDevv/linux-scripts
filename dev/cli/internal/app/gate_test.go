package app

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const gateRelease = "[[tool]]\nname=\"lite\"\nmethod=\"release\"\nrepo=\"o/r\"\nversion=\"1.0.0\"\nasset=\"a.tar.gz\"\nchecksum=\"sums.txt\"\nbin=\"lite\"\n"
const gateVendor = "[[tool]]\nname=\"v\"\nmethod=\"vendor\"\nurl=\"https://example.com/v.zip\"\nbin=\"v\"\nversion=\"1\"\n"

func gateTool(t *testing.T, body string) Tool {
	t.Helper()
	manifest, err := LoadStr("[defaults]\ncooldown_days = 7\n\n" + body)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Tools) != 1 {
		t.Fatalf("tools: %d", len(manifest.Tools))
	}
	return manifest.Tools[0]
}

func gateSHA(t *testing.T, path string) string {
	t.Helper()
	sum, err := sha256File(path)
	if err != nil {
		t.Fatal(err)
	}
	return sum
}

func gateInput(tool *Tool, artifact string, sums *string) *GateInput {
	now := time.Now().UTC()
	return &GateInput{
		Tool:          tool,
		Artifact:      artifact,
		ChecksumsText: sums,
		AssetName:     "a.tar.gz",
		Published:     now.Add(-10 * 24 * time.Hour),
		Now:           now,
		CooldownDays:  7,
	}
}

func mustBlocked(t *testing.T, err error) *Blocked {
	t.Helper()
	if err == nil {
		t.Fatal("expected block")
	}
	var blocked *Blocked
	if !errors.As(err, &blocked) || blocked == nil {
		t.Fatalf("not Blocked: %v", err)
	}
	var wrapper *BlockedError
	if !errors.As(err, &wrapper) {
		t.Fatalf("not BlockedError: %v", err)
	}
	if ExitCode(err) != blocked.ExitCode() {
		t.Fatalf("ExitCode %d != Blocked.ExitCode %d", ExitCode(err), blocked.ExitCode())
	}
	return blocked
}

func TestChecksumMatchPassesAtChecksumLevel(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.tar.gz")
	if err := os.WriteFile(file, []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}
	sums := fmt.Sprintf("%s  a.tar.gz\n", gateSHA(t, file))
	tool := gateTool(t, gateRelease)
	decision, err := evaluate(gateInput(&tool, file, &sums))
	if err != nil {
		t.Fatal(err)
	}
	if decision.Kind != DecisionAllowed || decision.Level != LevelChecksum || decision.SHA256 != gateSHA(t, file) {
		t.Fatalf("%+v", decision)
	}
	if decision.Level.AsStr() != "checksum" {
		t.Fatal(decision.Level.AsStr())
	}
}

func TestYoungReleaseIsBlockedByCooldown(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.tar.gz")
	if err := os.WriteFile(file, []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}
	sums := fmt.Sprintf("%s  a.tar.gz\n", gateSHA(t, file))
	tool := gateTool(t, gateRelease)
	gate := gateInput(&tool, file, &sums)
	gate.Published = gate.Now.Add(-2 * 24 * time.Hour)
	err := mustEvaluateErr(t, gate)
	blocked := mustBlocked(t, err)
	if blocked.Kind != BlockedKindCooldown {
		t.Fatalf("%+v", blocked)
	}
	if ExitCode(err) != 2 {
		t.Fatalf("exit %d", ExitCode(err))
	}
}

func TestTamperedArtifactIsBlocked(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.tar.gz")
	if err := os.WriteFile(file, []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}
	sums := fmt.Sprintf("%s  a.tar.gz\n", gateSHA(t, file))
	if err := os.WriteFile(file, []byte("payloaD"), 0o644); err != nil {
		t.Fatal(err)
	}
	tool := gateTool(t, gateRelease)
	err := mustEvaluateErr(t, gateInput(&tool, file, &sums))
	blocked := mustBlocked(t, err)
	if blocked.Kind != BlockedKindHashMismatch {
		t.Fatalf("%+v", blocked)
	}
	if ExitCode(err) != 2 {
		t.Fatalf("exit %d", ExitCode(err))
	}
}

func TestChecksumFileWithoutTheAssetIsBlocked(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.tar.gz")
	if err := os.WriteFile(file, []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}
	sums := fmt.Sprintf("%s  other.tar.gz\n%s  third.zip\n", strings.Repeat("a", 64), strings.Repeat("b", 64))
	tool := gateTool(t, gateRelease)
	err := mustEvaluateErr(t, gateInput(&tool, file, &sums))
	blocked := mustBlocked(t, err)
	if blocked.Kind != BlockedKindChecksumMissing || blocked.Asset != "a.tar.gz" {
		t.Fatalf("%+v", blocked)
	}
	if blocked.Error() != "checksum file has no entry for a.tar.gz" {
		t.Fatal(blocked.Error())
	}
}

func TestReleaseWithoutAnyVerificationIsBlocked(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.tar.gz")
	if err := os.WriteFile(file, []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}
	tool := gateTool(t, gateRelease)
	err := mustEvaluateErr(t, gateInput(&tool, file, nil))
	blocked := mustBlocked(t, err)
	if blocked.Kind != BlockedKindNoVerification {
		t.Fatalf("%+v", blocked)
	}
	if ExitCode(err) != 2 {
		t.Fatalf("exit %d", ExitCode(err))
	}
	if blocked.Error() != "no checksum, signature or pinned sha256 available" {
		t.Fatal(blocked.Error())
	}
}

func TestVendorWithoutPinAsksForApproval(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "v.zip")
	if err := os.WriteFile(file, []byte("zip"), 0o644); err != nil {
		t.Fatal(err)
	}
	tool := gateTool(t, gateVendor)
	decision, err := evaluate(gateInput(&tool, file, nil))
	if err != nil {
		t.Fatal(err)
	}
	if decision.Kind != DecisionNeedsPin || decision.SHA256 != gateSHA(t, file) {
		t.Fatalf("%+v", decision)
	}
}

func TestVendorPinnedHashPassesAndMismatchBlocks(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "v.zip")
	if err := os.WriteFile(file, []byte("zip"), 0o644); err != nil {
		t.Fatal(err)
	}
	good := gateVendor + fmt.Sprintf("sha256=\"%s\"\n", gateSHA(t, file))
	toolOK := gateTool(t, good)
	decision, err := evaluate(gateInput(&toolOK, file, nil))
	if err != nil {
		t.Fatal(err)
	}
	if decision.Kind != DecisionAllowed || decision.Level != LevelPinned || decision.SHA256 != gateSHA(t, file) {
		t.Fatalf("%+v", decision)
	}
	if decision.Level.AsStr() != "pinned" {
		t.Fatal(decision.Level.AsStr())
	}
	bad := gateVendor + fmt.Sprintf("sha256=\"%s\"\n", strings.Repeat("0", 64))
	toolBad := gateTool(t, bad)
	err = mustEvaluateErr(t, gateInput(&toolBad, file, nil))
	if mustBlocked(t, err).Kind != BlockedKindHashMismatch {
		t.Fatal(err)
	}
}

func TestPinMustStillMatchWhenAChecksumAlsoPasses(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.tar.gz")
	if err := os.WriteFile(file, []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}
	sums := fmt.Sprintf("%s  a.tar.gz\n", gateSHA(t, file))
	text := gateRelease + fmt.Sprintf("sha256=\"%s\"\n", strings.Repeat("1", 64))
	tool := gateTool(t, text)
	err := mustEvaluateErr(t, gateInput(&tool, file, &sums))
	if mustBlocked(t, err).Kind != BlockedKindHashMismatch {
		t.Fatal(err)
	}
}

func TestSignedChecksumFileGivesSigLevelAndBadSigBlocks(t *testing.T) {
	if _, err := exec.LookPath("gpg"); err != nil {
		t.Log("gpg missing; skipped")
		return
	}
	dir := t.TempDir()
	file := filepath.Join(dir, "a.tar.gz")
	if err := os.WriteFile(file, []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}
	sumsPath := filepath.Join(dir, "sums.txt")
	sums := fmt.Sprintf("%s  a.tar.gz\n", gateSHA(t, file))
	if err := os.WriteFile(sumsPath, []byte(sums), 0o644); err != nil {
		t.Fatal(err)
	}
	key, sig, fingerprint := gateSign(t, dir, sumsPath)
	text := gateRelease + fmt.Sprintf("gpg_fingerprint=\"%s\"\nsig=\"sums.txt.sig\"\n", fingerprint)
	tool := gateTool(t, text)
	gate := gateInput(&tool, file, &sums)
	gate.Sig = &SigInput{
		SignedFile: sumsPath,
		SigFile:    sig,
		KeySource:  KeySource{Kind: KeySourceFile, Value: key},
		Covers:     SigCoversChecksumFile,
	}
	decision, err := evaluate(gate)
	if err != nil {
		t.Fatal(err)
	}
	if decision.Kind != DecisionAllowed || decision.Level != LevelSig || decision.SHA256 != gateSHA(t, file) {
		t.Fatalf("%+v", decision)
	}
	if decision.Level.AsStr() != "sig" {
		t.Fatal(decision.Level.AsStr())
	}

	if err := os.WriteFile(sumsPath, []byte(fmt.Sprintf("%s  a.tar.gz\n", strings.Repeat("f", 64))), 0o644); err != nil {
		t.Fatal(err)
	}
	gate = gateInput(&tool, file, &sums)
	gate.Sig = &SigInput{
		SignedFile: sumsPath,
		SigFile:    sig,
		KeySource:  KeySource{Kind: KeySourceFile, Value: key},
		Covers:     SigCoversChecksumFile,
	}
	err = mustEvaluateErr(t, gate)
	if mustBlocked(t, err).Kind != BlockedKindSig {
		t.Fatal(err)
	}
	if ExitCode(err) != 2 {
		t.Fatalf("exit %d", ExitCode(err))
	}
}

func mustEvaluateErr(t *testing.T, input *GateInput) error {
	t.Helper()
	_, err := evaluate(input)
	if err == nil {
		t.Fatal("expected block")
	}
	return err
}

func gateSign(t *testing.T, dir, file string) (string, string, string) {
	t.Helper()
	home := filepath.Join(dir, "gnupg")
	if err := os.MkdirAll(home, 0o700); err != nil {
		t.Fatal(err)
	}
	run := func(args ...string) []byte {
		t.Helper()
		cmd := exec.Command("gpg", append([]string{"--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase", ""}, args...)...)
		cmd.Env = append(os.Environ(), "GNUPGHOME="+home)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("gpg %v: %v: %s", args, err, out)
		}
		return out
	}
	run("--quick-generate-key", "gate <g@example.com>", "ed25519", "sign", "never")
	listing := exec.Command("gpg", "--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase", "", "--with-colons", "--list-keys")
	listing.Env = append(os.Environ(), "GNUPGHOME="+home)
	out, err := listing.Output()
	if err != nil {
		t.Fatal(err)
	}
	var fingerprint string
	seenPub := false
	for _, line := range strings.Split(string(out), "\n") {
		if !seenPub {
			if strings.HasPrefix(line, "pub") {
				seenPub = true
			}
			continue
		}
		if strings.HasPrefix(line, "fpr") {
			parts := strings.Split(line, ":")
			if len(parts) > 9 {
				fingerprint = parts[9]
			}
			break
		}
	}
	if fingerprint == "" {
		t.Fatalf("no fingerprint in %s", out)
	}
	sig := filepath.Join(dir, "sig.asc")
	run("--detach-sign", "--output", sig, file)
	key := filepath.Join(dir, "pub.gpg")
	run("--export", "--output", key, fingerprint)
	return key, sig, fingerprint
}

func TestGateBlocksHostViolation(t *testing.T) {
	tool := gateTool(t, gateVendor)
	err := ForTool(&tool).CheckURL("https://evil.example/payload")
	var host *HostBlocked
	if !errors.As(err, &host) || host == nil {
		t.Fatalf("host not blocked: %v", err)
	}
	if host.Reason == "" || host.URL != "https://evil.example/payload" {
		t.Fatalf("%+v", host)
	}
	blockedErr := blockedFromHost(host)
	blocked := mustBlocked(t, blockedErr)
	if blocked.Kind != BlockedKindHost {
		t.Fatalf("%+v", blocked)
	}
	if ExitCode(blockedErr) != ExitBlocked || blocked.ExitCode() != 2 {
		t.Fatalf("exit %d", ExitCode(blockedErr))
	}
	want := host.URL + " (" + host.Reason + ")"
	if blocked.Error() != want || blockedErr.Error() != want {
		t.Fatalf("msg %q want %q", blockedErr.Error(), want)
	}
	if strings.Contains(blocked.Error(), "host blocked:") {
		t.Fatal("host Display must not use HostBlocked.Error prefix")
	}
}

func TestGateBlocksBlankPinAndMissingFingerprint(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.tar.gz")
	if err := os.WriteFile(file, []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}
	blank := gateRelease + "sha256=\"   \"\n"
	tool := gateTool(t, blank)
	err := mustEvaluateErr(t, gateInput(&tool, file, nil))
	if mustBlocked(t, err).Kind != BlockedKindNoVerification || ExitCode(err) != 2 {
		t.Fatal(err)
	}

	sums := fmt.Sprintf("%s  a.tar.gz\n", gateSHA(t, file))
	signed := gateTool(t, gateRelease)
	gate := gateInput(&signed, file, &sums)
	gate.Sig = &SigInput{SignedFile: file, SigFile: file, Covers: SigCoversArtifact}
	err = mustEvaluateErr(t, gate)
	blocked := mustBlocked(t, err)
	if blocked.Kind != BlockedKindConfig || ExitCode(err) != ExitError {
		t.Fatalf("%s exit %d", blocked.Kind, ExitCode(err))
	}
	if blocked.Error() != "lite: sig given but gpg_fingerprint is empty" {
		t.Fatal(blocked.Error())
	}
}

func TestGateBlocksMissingArtifactAsIo(t *testing.T) {
	tool := gateTool(t, gateRelease)
	missing := filepath.Join(t.TempDir(), "absent.tar.gz")
	err := mustEvaluateErr(t, gateInput(&tool, missing, nil))
	blocked := mustBlocked(t, err)
	if blocked.Kind != BlockedKindIo || ExitCode(err) != ExitError {
		t.Fatalf("%s exit %d", blocked.Kind, ExitCode(err))
	}
	if blocked.Message == "" {
		t.Fatal("empty io message")
	}
}
