// args.go ports the parseArgs call and help() of ship.ts.
//
// The parser reproduces node:util parseArgs semantics as Bun 1.4 implements
// them, because the exact diagnostics are part of the CLI's visible behavior:
// unknown options, a missing string argument, an ambiguous argument, and
// "does not take an argument".
package app

import (
	"fmt"
	"strings"
)

// Options is the parsed command line.
type Options struct {
	Message     string
	MessageSet  bool
	NoPush      bool
	Repo        bool
	Public      bool
	Private     bool
	Help        bool
	Positionals []string
}

const unknownSuffix = ". To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- %q"

// Parse is parseArgs({allowPositionals: true, options: {...}}).
func Parse(args []string) (Options, error) {
	var o Options
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			o.Positionals = append(o.Positionals, args[i+1:]...)
			return o, nil
		}
		if strings.HasPrefix(arg, "--") {
			name, value, hasValue := strings.Cut(arg[2:], "=")
			switch name {
			case "message":
				if hasValue {
					o.Message, o.MessageSet = value, true
					continue
				}
				v, err := longValue(args, &i)
				if err != nil {
					return Options{}, err
				}
				o.Message, o.MessageSet = v, true
			case "no-push", "repo", "public", "private", "help":
				if hasValue {
					return Options{}, fmt.Errorf("Option '--%s' does not take an argument", name)
				}
				switch name {
				case "no-push":
					o.NoPush = true
				case "repo":
					o.Repo = true
				case "public":
					o.Public = true
				case "private":
					o.Private = true
				case "help":
					o.Help = true
				}
			default:
				return Options{}, unknownOption("--" + name)
			}
			continue
		}
		if len(arg) > 1 && arg[0] == '-' {
			cluster := arg[1:]
			for j := 0; j < len(cluster); j++ {
				switch cluster[j] {
				case 'h':
					o.Help = true
				case 'm':
					if rest := cluster[j+1:]; rest != "" {
						o.Message, o.MessageSet = rest, true
						j = len(cluster)
						continue
					}
					v, err := shortValue(args, &i)
					if err != nil {
						return Options{}, err
					}
					o.Message, o.MessageSet = v, true
					j = len(cluster)
				default:
					// Bun reports a lone "-x" with its dash and a clustered
					// letter without one.
					token := string(cluster[j])
					if len(cluster) == 1 {
						token = "-" + token
					}
					return Options{}, unknownOption(token)
				}
			}
			continue
		}
		o.Positionals = append(o.Positionals, arg)
	}
	return o, nil
}

func unknownOption(token string) error {
	return fmt.Errorf("Unknown option '%s'%s", token, fmt.Sprintf(unknownSuffix, token))
}

const missingValue = "Option '-m, --message <value>' argument missing"

func longValue(args []string, i *int) (string, error) {
	return optionValue(args, i, "--message", "Option '--message' argument is ambiguous.\nDid you forget to specify the option argument for '--message'?\nTo specify an option argument starting with a dash use '--message=-XYZ'.")
}

func shortValue(args []string, i *int) (string, error) {
	return optionValue(args, i, "-m", "Option '-m' argument is ambiguous.\nDid you forget to specify the option argument for '-m'?\nTo specify an option argument starting with a dash use '--message=-XYZ' or '-m-XYZ'.")
}

func optionValue(args []string, i *int, _ string, ambiguous string) (string, error) {
	if *i+1 >= len(args) {
		return "", fmt.Errorf("%s", missingValue)
	}
	next := args[*i+1]
	if len(next) > 1 && next[0] == '-' {
		return "", fmt.Errorf("%s", ambiguous)
	}
	*i++
	return next, nil
}

// Help is help(): the same rows, padding on the plain text so ANSI codes do
// not skew the columns. color selects styling; the caller decides.
func Help(color bool) string {
	s := func(code string) string {
		if !color {
			return ""
		}
		return "\x1b[" + code + "m"
	}
	bold, green, dim, nc := s("1"), s("0;32"), s("2"), s("0")
	head := func(label string) string { return s("1;36") + label + nc }
	flag := func(text string) string { return green + text + nc }
	arg := func(text string) string { return dim + text + nc }
	row := func(flags, args, text string) string {
		width := 24 - len(flags)
		if args != "" {
			width -= len(args) + 1
		}
		if width < 2 {
			width = 2
		}
		gap := " " + arg(args)
		if args == "" {
			gap = ""
		}
		return "  " + flag(flags) + gap + strings.Repeat(" ", width) + text
	}
	note := func(text string) string { return strings.Repeat(" ", 26) + dim + text + nc }

	lines := []string{
		bold + "ship" + nc + " — stage, commit, and push in one step",
		"",
		head("USAGE"),
		"  ship " + arg("[options]") + strings.Repeat(" ", 15) + "commit every change and push",
		"  ship repo " + arg("[name] [options]") + "   connect or create a GitHub repo, then push",
		"",
		head("COMMIT"),
		row("-m, --message", "<text>", "commit message"),
		note("default: names of the 5 most-changed files"),
		row("    --no-push", "", "commit only"),
		"",
		head("GITHUB"),
		row("    --repo", "[name]", "no remote → create or connect without asking"),
		note("name defaults to the repository directory"),
		row("    --public", "", "visibility of a new repository"),
		row("    --private", "", "(default)"),
		"",
		head("GENERAL"),
		row("-h, --help", "", "show this help"),
		"",
		head("NOTES"),
		"  On a clean tree, ship pushes commits that no remote has yet.",
		"  With no remote on a terminal, ship asks before creating a repository.",
		"  " + flag("ship repo") + " replaces an existing origin; " + flag("ship --repo") + " never does.",
		"",
		head("EXAMPLES"),
		"  ship",
		`  ship -m "Fix login redirect"`,
		"  ship --no-push",
		"  ship --repo my-app --public",
		"  ship repo",
	}
	return strings.Join(lines, "\n")
}
