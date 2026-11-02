package app

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const (
	testFP    = "0123456789abcdef0123456789abcdef01234567"
	testOther = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
)

func validsig(signing, primary string) string {
	return "[GNUPG:] VALIDSIG " + signing + " 2026-10-30 1761843528 0 4 0 1 8 00 " + primary + "\n"
}

func asGpg(t *testing.T, err error) *GpgError {
	t.Helper()
	var ge *GpgError
	if !errors.As(err, &ge) || ge == nil {
		t.Fatalf("got %v, want *GpgError", err)
	}
	return ge
}

func TestParseValidsigCases(t *testing.T) {
	if err := parseValidsig(validsig(testFP, testFP), testFP); err != nil {
		t.Fatalf("matching validsig: %v", err)
	}
	if err := parseValidsig(validsig(strings.ToUpper(testFP), testFP), testFP); err != nil {
		t.Fatalf("uppercase signing fingerprint: %v", err)
	}
	if err := parseValidsig(validsig(testOther, testFP), "  "+testFP+"  "); err != nil {
		t.Fatalf("primary match with padded expected: %v", err)
	}

	mismatch := asGpg(t, parseValidsig(validsig(testOther, testOther), testFP))
	if mismatch.Kind != GpgKindFingerprintMismatch || mismatch.Expected != testFP || mismatch.Actual != testOther {
		t.Fatalf("mismatch: %+v", mismatch)
	}
	if mismatch.Error() != "fingerprint mismatch: expected "+testFP+", got "+testOther {
		t.Fatalf("mismatch text: %q", mismatch.Error())
	}

	bad := asGpg(t, parseValidsig("[GNUPG:] BADSIG 0123456789ABCDEF Test <t@example.com>\n", testFP))
	if bad.Kind != GpgKindBadSignature || bad.Message != "BADSIG" {
		t.Fatalf("badsig: %+v", bad)
	}

	empty := asGpg(t, parseValidsig("", testFP))
	if empty.Kind != GpgKindBadSignature || empty.Message != "no VALIDSIG" {
		t.Fatalf("empty: %+v", empty)
	}
	goodsig := asGpg(t, parseValidsig("[GNUPG:] GOODSIG 0123456789ABCDEF Test\n", testFP))
	if goodsig.Kind != GpgKindBadSignature {
		t.Fatalf("goodsig: %+v", goodsig)
	}
	expired := asGpg(t, parseValidsig("[GNUPG:] EXPKEYSIG "+testFP+" Test\n"+validsig(testFP, testFP), testFP))
	if expired.Kind != GpgKindBadSignature || expired.Message != "EXPKEYSIG" {
		t.Fatalf("expkeysig must win over VALIDSIG: %+v", expired)
	}
	short := asGpg(t, parseValidsig(validsig(testFP, testFP), "short"))
	if short.Kind != GpgKindInvalidFingerprint || short.Error() != "invalid fingerprint" {
		t.Fatalf("short: %+v", short)
	}
}

func TestGpgVerifyRoundtripWhenGpgPresent(t *testing.T) {
	if _, err := exec.LookPath("gpg"); err != nil {
		t.Skip("gpg not found")
	}

	home, err := os.MkdirTemp("", "cli-gpg-test-")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(home, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		kill := exec.Command("gpgconf", "--kill", "all")
		kill.Env = childEnv(home)
		if stdin := devNull(); stdin != nil {
			kill.Stdin = stdin
			defer stdin.Close()
		}
		_ = kill.Run()
		_ = os.RemoveAll(home)
	})
	if err := os.WriteFile(filepath.Join(home, "gpg-agent.conf"), []byte("allow-loopback-pinentry\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	mustGpg(t, home,
		"--batch", "--pinentry-mode", "loopback", "--passphrase", "",
		"--quick-generate-key", "test <t@example.com>", "ed25519", "sign", "never",
	)
	listed := mustGpg(t, home, "--batch", "--with-colons", "--list-keys")
	fingerprint := fingerprintFromColons(t, listed)

	keyFile := filepath.Join(home, "pub.gpg")
	mustGpg(t, home, "--batch", "--export", "--output", keyFile)

	file := filepath.Join(home, "payload")
	if err := os.WriteFile(file, []byte("hello\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	sig := filepath.Join(home, "payload.sig")
	mustGpg(t, home,
		"--batch", "--pinentry-mode", "loopback", "--passphrase", "",
		"--detach-sign", "--output", sig, file,
	)

	if err := gpgVerify(gpgVerifyInput(file, sig, fingerprint, keyFile)); err != nil {
		t.Fatalf("valid signature: %v", err)
	}

	tampered, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	tampered[0] ^= 0x01
	if err := os.WriteFile(file, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	tamper := asGpg(t, gpgVerify(gpgVerifyInput(file, sig, fingerprint, keyFile)))
	if tamper.Kind != GpgKindBadSignature {
		t.Fatalf("tampered file: %+v", tamper)
	}

	if err := os.WriteFile(file, []byte("hello\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	wrong := testFP
	if strings.EqualFold(fingerprint, testFP) {
		wrong = testOther
	}
	mismatch := asGpg(t, gpgVerify(gpgVerifyInput(file, sig, wrong, keyFile)))
	if mismatch.Kind != GpgKindFingerprintMismatch {
		t.Fatalf("fingerprint mismatch: %+v", mismatch)
	}

	short := asGpg(t, gpgVerify(gpgVerifyInput(file, sig, "short", keyFile)))
	if short.Kind != GpgKindInvalidFingerprint {
		t.Fatalf("short fingerprint: %+v", short)
	}
}

func gpgVerifyInput(file, sig, fingerprint, keyFile string) *GpgVerify {
	return &GpgVerify{
		File:        file,
		Sig:         sig,
		Fingerprint: fingerprint,
		KeySource:   KeySource{Kind: KeySourceFile, Value: keyFile},
	}
}

func mustGpg(t *testing.T, home string, args ...string) []byte {
	t.Helper()
	cmd := exec.Command("gpg", args...)
	cmd.Env = childEnv(home)
	if stdin := devNull(); stdin != nil {
		cmd.Stdin = stdin
		defer stdin.Close()
	}
	out, err := cmd.Output()
	if err != nil {
		note := "gpg failed"
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			note = redactGpg(exitErr.Stderr)
		}
		t.Fatalf("gpg %s: %s", strings.Join(args, " "), note)
	}
	return out
}

func fingerprintFromColons(t *testing.T, stdout []byte) string {
	t.Helper()
	for _, line := range strings.Split(string(stdout), "\n") {
		parts := strings.Split(line, ":")
		if len(parts) == 0 || parts[0] != "fpr" || len(parts) <= 9 {
			continue
		}
		if isFingerprint(parts[9]) {
			return parts[9]
		}
	}
	t.Fatal("fingerprint")
	return ""
}

func redactGpg(stderr []byte) string {
	text := string(stderr)
	if strings.Contains(text, "-----BEGIN") || strings.Contains(text, "PRIVATE KEY") {
		return "gpg stderr redacted"
	}
	text = strings.Join(strings.Fields(text), " ")
	if text == "" {
		return "gpg failed"
	}
	if len(text) > 200 {
		text = text[:200]
	}
	return text
}
