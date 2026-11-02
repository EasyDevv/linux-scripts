package app

import (
	"bytes"
	"strings"
	"testing"
)

func TestParsesListJsonAndHelp(t *testing.T) {
	opts, err := Parse([]string{"list", "--json"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.Command != CommandList {
		t.Fatalf("command = %v, want List", opts.Command)
	}
	if !opts.JSON {
		t.Fatal("json flag not set")
	}

	opts, err = Parse([]string{"--json", "list", "--yes"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.Command != CommandList {
		t.Fatalf("command = %v, want List", opts.Command)
	}
	if !opts.Yes {
		t.Fatal("yes flag not set")
	}

	opts, err = Parse([]string{"-h"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.Command != CommandHelp {
		t.Fatalf("-h command = %v, want Help", opts.Command)
	}
	opts, err = Parse([]string{"install", "--help"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.Command != CommandHelp {
		t.Fatalf("install --help command = %v, want Help", opts.Command)
	}
	opts, err = Parse([]string{"install", "litestream"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.Command != CommandInstall {
		t.Fatalf("install command = %v, want Install", opts.Command)
	}
	opts, err = Parse(nil)
	if err != nil {
		t.Fatal(err)
	}
	if opts.Command != CommandDefault {
		t.Fatalf("empty command = %v, want Default", opts.Command)
	}
}

func TestRejectsUnknownCommandAndOption(t *testing.T) {
	// target/release/cli npm → "error: unknown command: npm"
	err := mustParseErr(t, []string{"npm"})
	if !strings.Contains(err, "unknown command") || err != "unknown command: npm" {
		t.Fatalf("unknown command error = %q", err)
	}
	// target/release/cli list --force → "error: unknown option: --force"
	err = mustParseErr(t, []string{"list", "--force"})
	if !strings.Contains(err, "unknown option") || err != "unknown option: --force" {
		t.Fatalf("unknown option error = %q", err)
	}
}

func mustParseErr(t *testing.T, args []string) string {
	t.Helper()
	_, err := Parse(args)
	if err == nil {
		t.Fatalf("Parse(%v) succeeded, want error", args)
	}
	return err.Error()
}

// TestWriteHelpMatchesRust locks the plain help text to target/release/cli --help
// (NO_COLOR / non-TTY). Color codes are checked separately against a PTY run.
func TestWriteHelpMatchesRust(t *testing.T) {
	// Rust --help with NO_COLOR (also the non-TTY path). Pin the env so a
	// TTY stdout cannot turn color on and fail this comparison.
	t.Setenv("NO_COLOR", "1")
	var buf bytes.Buffer
	if err := WriteHelp(&buf); err != nil {
		t.Fatal(err)
	}
	const want = "cli — 도구 설치·점검\n" +
		"\n" +
		"사용법:\n" +
		"  cli\n" +
		"  cli <명령> [옵션]\n" +
		"\n" +
		"명령\n" +
		"  list       목록과 설치 상태\n" +
		"  install    게이트 통과 후 설치\n" +
		"  remove     기록된 항목 삭제\n" +
		"  update     후보 조회와 교체\n" +
		"  audit      정책·취약점 점검\n" +
		"  doctor     설치·환경 점검\n" +
		"\n" +
		"공통 옵션\n" +
		"  --yes            승인 생략\n" +
		"  --dry-run        바꾸지 않고 계획만 표시\n" +
		"  --check          update: 후보만 조회\n" +
		"  --rollback       update: 직전 버전으로 되돌림\n" +
		"  --json           JSON으로 출력\n" +
		"  -h, --help       이 도움말\n"
	if buf.String() != want {
		t.Fatalf("help mismatch\n got: %q\nwant: %q", buf.String(), want)
	}
}
