package app

import (
	"strings"
	"testing"
)

// TestParseOptions covers the flag forms parseArgs accepted in ship.ts.
func TestParseOptions(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want Options
	}{
		{"empty", nil, Options{}},
		{"message long", []string{"--message", "fix login"}, Options{Message: "fix login", MessageSet: true}},
		{"message equals", []string{"--message=fix login"}, Options{Message: "fix login", MessageSet: true}},
		{"message short", []string{"-m", "fix login"}, Options{Message: "fix login", MessageSet: true}},
		{"message attached", []string{"-mfix"}, Options{Message: "fix", MessageSet: true}},
		{"message last wins", []string{"-m", "a", "-m", "b"}, Options{Message: "b", MessageSet: true}},
		{"no-push", []string{"--no-push"}, Options{NoPush: true}},
		{"repo positional", []string{"--repo", "app"}, Options{Repo: true, Positionals: []string{"app"}}},
		{"repo name subcommand", []string{"repo", "app", "--public"}, Options{Public: true, Positionals: []string{"repo", "app"}}},
		{"private", []string{"--private"}, Options{Private: true}},
		{"help short", []string{"-h"}, Options{Help: true}},
		{"help long", []string{"--help"}, Options{Help: true}},
		{"after terminator", []string{"--", "--foo"}, Options{Positionals: []string{"--foo"}}},
		{"lone dash is positional", []string{"-"}, Options{Positionals: []string{"-"}}},
		{"empty value", []string{"--message="}, Options{Message: "", MessageSet: true}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Parse(tc.args)
			if err != nil {
				t.Fatalf("Parse(%q) error: %v", tc.args, err)
			}
			if got.Message != tc.want.Message || got.MessageSet != tc.want.MessageSet ||
				got.NoPush != tc.want.NoPush || got.Repo != tc.want.Repo ||
				got.Public != tc.want.Public || got.Private != tc.want.Private || got.Help != tc.want.Help {
				t.Fatalf("Parse(%q) flags = %+v, want %+v", tc.args, got, tc.want)
			}
			if strings.Join(got.Positionals, "|") != strings.Join(tc.want.Positionals, "|") {
				t.Fatalf("Parse(%q) positionals = %q, want %q", tc.args, got.Positionals, tc.want.Positionals)
			}
		})
	}
}

// TestParseErrors pins the node:util messages ship.ts printed verbatim.
func TestParseErrors(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want string
	}{
		{
			"unknown long",
			[]string{"--bogus"},
			`Unknown option '--bogus'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--bogus"`,
		},
		{
			"unknown long drops value",
			[]string{"--bogus=1"},
			`Unknown option '--bogus'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--bogus"`,
		},
		{
			"unknown short",
			[]string{"-x"},
			`Unknown option '-x'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "-x"`,
		},
		{
			"unknown in cluster",
			[]string{"-hg"},
			`Unknown option 'g'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "g"`,
		},
		{"missing long", []string{"--message"}, "Option '-m, --message <value>' argument missing"},
		{"missing short", []string{"-m"}, "Option '-m, --message <value>' argument missing"},
		{"boolean with value", []string{"--public=1"}, "Option '--public' does not take an argument"},
		{
			"ambiguous long",
			[]string{"--message", "--"},
			"Option '--message' argument is ambiguous.\nDid you forget to specify the option argument for '--message'?\nTo specify an option argument starting with a dash use '--message=-XYZ'.",
		},
		{
			"ambiguous short",
			[]string{"-m", "--"},
			"Option '-m' argument is ambiguous.\nDid you forget to specify the option argument for '-m'?\nTo specify an option argument starting with a dash use '--message=-XYZ' or '-m-XYZ'.",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse(tc.args)
			if err == nil {
				t.Fatalf("Parse(%q) returned no error", tc.args)
			}
			if err.Error() != tc.want {
				t.Fatalf("Parse(%q) error =\n%q\nwant\n%q", tc.args, err.Error(), tc.want)
			}
		})
	}
}

// TestHelpPlain pins the layout ship.ts printed with color off.
func TestHelpPlain(t *testing.T) {
	help := Help(false)
	if strings.Contains(help, "\x1b[") {
		t.Fatalf("Help(false) contains ANSI escapes:\n%s", help)
	}
	want := []string{
		"ship — stage, commit, and push in one step",
		"USAGE",
		"  ship [options]               commit every change and push",
		"  ship repo [name] [options]   connect or create a GitHub repo, then push",
		"  -m, --message <text>    commit message",
		"                          default: names of the 5 most-changed files",
		"      --no-push           commit only",
		"      --repo [name]       no remote → create or connect without asking",
		"                          name defaults to the repository directory",
		"      --public            visibility of a new repository",
		"      --private           (default)",
		"  -h, --help              show this help",
		"  On a clean tree, ship pushes commits that no remote has yet.",
		"  With no remote on a terminal, ship asks before creating a repository.",
		"  ship repo replaces an existing origin; ship --repo never does.",
		"  ship -m \"Fix login redirect\"",
		"  ship repo",
	}
	for _, line := range want {
		if !strings.Contains(help, line) {
			t.Fatalf("Help(false) is missing %q:\n%s", line, help)
		}
	}
	if lines := strings.Count(help, "\n") + 1; lines != 31 {
		t.Fatalf("Help(false) has %d lines, want 31:\n%s", lines, help)
	}
}

// TestHelpColor keeps the SGR codes the TS help() emitted.
func TestHelpColor(t *testing.T) {
	help := Help(true)
	for _, want := range []string{"\x1b[1mship\x1b[0m", "\x1b[1;36mUSAGE\x1b[0m", "\x1b[0;32m-m, --message\x1b[0m"} {
		if !strings.Contains(help, want) {
			t.Fatalf("Help(true) is missing %q", want)
		}
	}
}
