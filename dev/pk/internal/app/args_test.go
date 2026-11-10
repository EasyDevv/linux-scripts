package app

import (
	"reflect"
	"testing"
)

func TestParseArgsDefaults(t *testing.T) {
	opts, err := parseArgs(nil)
	if err != nil {
		t.Fatalf("parseArgs: %v", err)
	}
	if opts.script != "" || opts.list || opts.help || opts.version {
		t.Fatalf("opts = %+v", opts)
	}
}

func TestParseArgsFlagsBeforeScript(t *testing.T) {
	opts, err := parseArgs([]string{"--list", "--json", "--pkg", "/tmp/x", "--pm", "pnpm", "--color=never"})
	if err != nil {
		t.Fatalf("parseArgs: %v", err)
	}
	if !opts.list || !opts.json || opts.dir != "/tmp/x" || opts.pm != "pnpm" || opts.color != "never" {
		t.Fatalf("opts = %+v", opts)
	}
}

// Everything after the script name belongs to the script, including flags.
func TestParseArgsForwardsAfterScript(t *testing.T) {
	opts, err := parseArgs([]string{"test", "--watch", "--pkg", "ignored"})
	if err != nil {
		t.Fatalf("parseArgs: %v", err)
	}
	if opts.script != "test" {
		t.Fatalf("script = %q", opts.script)
	}
	if want := []string{"--watch", "--pkg", "ignored"}; !reflect.DeepEqual(opts.forward, want) {
		t.Fatalf("forward = %v, want %v", opts.forward, want)
	}
	if opts.dir != "" {
		t.Fatalf("dir = %q, flags after the script must not parse", opts.dir)
	}
}

func TestParseArgsDoubleDash(t *testing.T) {
	opts, err := parseArgs([]string{"dev", "--", "--host", "0.0.0.0"})
	if err != nil {
		t.Fatalf("parseArgs: %v", err)
	}
	if opts.script != "dev" || len(opts.forward) != 2 {
		t.Fatalf("opts = %+v", opts)
	}
}

func TestParseArgsRejectsUnknownFlag(t *testing.T) {
	if _, err := parseArgs([]string{"--nope"}); err == nil {
		t.Fatal("expected an error for an unknown flag")
	}
}

func TestParseArgsRejectsBadPMAndColor(t *testing.T) {
	if _, err := parseArgs([]string{"--pm", "cargo"}); err == nil {
		t.Fatal("expected an error for an unsupported package manager")
	}
	if _, err := parseArgs([]string{"--color", "rainbow"}); err == nil {
		t.Fatal("expected an error for an unsupported color mode")
	}
}

func TestParseArgsNeedsFlagValue(t *testing.T) {
	if _, err := parseArgs([]string{"--pkg"}); err == nil {
		t.Fatal("expected an error when the flag value is missing")
	}
}
