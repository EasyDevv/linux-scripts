// args.go ports build_parser()/parse_args() to argparse's exact texts: the same
// help layouts, the same `netbird-setup: error:` diagnostics, and exit 2.
package app

import (
	"io"
	"strings"
)

// Args is the parsed command line.
type Args struct {
	Command   string
	Name      string
	Replace   bool
	Dest      string
	Roster    string
	AutoGroup string
	Apply     bool
}

const (
	prog = "netbird-setup"

	topUsage   = "usage: " + prog + " [-h] {issue,usb,list,employees} ..."
	issueUsage = "usage: " + prog + " issue [-h] [--replace] [name]"
	usbUsage   = "usage: " + prog + " usb [-h] [--dest DEST]"
	listUsage  = "usage: " + prog + " list [-h]"
	// employeesUsage is argparse's wrapped usage at 80 columns.
	employeesUsage = "usage: " + prog + " employees [-h] --roster ROSTER [--auto-group AUTO_GROUP]\n" +
		"                               [--apply]"
)

// helpBody is the epilog of the top-level help (HELP in the original).
const helpBody = `netbird-setup - issue NetBird setup keys and write a Windows USB installer

Usage:
  netbird-setup issue [NAME] [--replace]
  netbird-setup employees --roster PATH [--apply]
  netbird-setup usb [--dest PATH]
  netbird-setup list
  netbird-setup --help

Keys are stored as NAME=value in .env.netbird.setup.keys (for example EXAMPLE_ADMIN_PC=).
issue mints a one-off employees key (usage_limit 1, 7 days).
usb copies the key file and an interactive Windows installer onto a mounted USB.
The Windows script reads .env.netbird.setup.keys, lets you pick a key, then runs netbird up.

Non-TTY:
  issue requires NAME. Existing names need --replace.
  usb requires --dest.`

// topHelp is argparse's `netbird-setup --help` output.
const topHelp = topUsage + `

Issue NetBird setup keys and write a Windows USB installer.

positional arguments:
  {issue,usb,list,employees}
    issue               mint a one-off setup key
    usb                 write a Windows installer script to USB
    list                list stored key names
    employees           mint waiting one-off employee keys (7d, usage 1)

options:
  -h, --help            show this help message and exit

` + helpBody

const issueHelp = issueUsage + `

positional arguments:
  name        env name, e.g. GREEN_USER_01

options:
  -h, --help  show this help message and exit
  --replace   overwrite an existing NAME without prompting`

const usbHelp = usbUsage + `

options:
  -h, --help   show this help message and exit
  --dest DEST  USB mount or destination directory`

const listHelp = listUsage + `

options:
  -h, --help  show this help message and exit`

const employeesHelp = employeesUsage + `

options:
  -h, --help            show this help message and exit
  --roster ROSTER       JSON roster path
  --auto-group AUTO_GROUP
  --apply`

// ParseResult reports a handled command line: Exit is the process status and
// nothing else runs.
type ParseResult struct {
	Args    Args
	Exit    int
	Handled bool
}

// Parse walks argv the way argparse does. Help goes to stdout (exit 0);
// diagnostics go to stderr after a usage line (exit 2).
func Parse(argv []string, stdout, stderr io.Writer) ParseResult {
	if len(argv) == 0 {
		writeText(stderr, topHelp)
		return ParseResult{Exit: 2, Handled: true}
	}
	first := argv[0]
	if first == "-h" || first == "--help" {
		writeText(stdout, topHelp)
		return ParseResult{Exit: 0, Handled: true}
	}
	if strings.HasPrefix(first, "-") {
		return unrecognized(stderr, argv)
	}
	rest := argv[1:]
	switch first {
	case "issue":
		return parseIssue(rest, stdout, stderr)
	case "usb":
		return parseUSB(rest, stdout, stderr)
	case "list":
		return parseList(rest, stdout, stderr)
	case "employees":
		return parseEmployees(rest, stdout, stderr)
	}
	writeText(stderr, topUsage+"\n"+prog+": error: argument command: invalid choice: '"+first+
		"' (choose from 'issue', 'usb', 'list', 'employees')\n")
	return ParseResult{Exit: 2, Handled: true}
}

// unrecognized reports argparse's top-level `unrecognized arguments` error.
func unrecognized(stderr io.Writer, extra []string) ParseResult {
	writeText(stderr, topUsage+"\n"+prog+": error: unrecognized arguments: "+strings.Join(extra, " ")+"\n")
	return ParseResult{Exit: 2, Handled: true}
}

// subError prints a subcommand usage line and its diagnostic.
func subError(stderr io.Writer, usage, sub, message string) ParseResult {
	writeText(stderr, usage+"\n"+prog+" "+sub+": error: "+message+"\n")
	return ParseResult{Exit: 2, Handled: true}
}

// wantsHelp reports -h/--help anywhere in the subcommand arguments, as argparse
// does: the flag is honoured when it is reached, so the value of an option that
// takes one (`--dest -h`) is skipped and reported as a missing value instead.
func wantsHelp(args []string) bool {
	for index := 0; index < len(args); index++ {
		switch args[index] {
		case "-h", "--help":
			return true
		case "--dest", "--roster", "--auto-group":
			index++ // skip the value; parse* reports it when it is missing
		}
	}
	return false
}

// looksLikeOption reports a token argparse would read as an option rather than
// as the value of the preceding flag.
func looksLikeOption(arg string) bool { return strings.HasPrefix(arg, "-") && arg != "-" }

func parseIssue(args []string, stdout, stderr io.Writer) ParseResult {
	if wantsHelp(args) {
		writeText(stdout, issueHelp)
		return ParseResult{Exit: 0, Handled: true}
	}
	out := Args{Command: "issue"}
	positional := []string{}
	for _, arg := range args {
		switch {
		case arg == "--replace":
			out.Replace = true
		case strings.HasPrefix(arg, "-") && arg != "-":
			return unrecognized(stderr, []string{arg})
		default:
			positional = append(positional, arg)
		}
	}
	if len(positional) > 1 {
		return unrecognized(stderr, positional[1:])
	}
	if len(positional) == 1 {
		out.Name = positional[0]
	}
	return ParseResult{Args: out}
}

func parseUSB(args []string, stdout, stderr io.Writer) ParseResult {
	if wantsHelp(args) {
		writeText(stdout, usbHelp)
		return ParseResult{Exit: 0, Handled: true}
	}
	out := Args{Command: "usb"}
	for index := 0; index < len(args); index++ {
		arg := args[index]
		switch {
		case arg == "--dest":
			if index+1 >= len(args) || looksLikeOption(args[index+1]) {
				return subError(stderr, usbUsage, "usb", "argument --dest: expected one argument")
			}
			index++
			out.Dest = args[index]
		case strings.HasPrefix(arg, "--dest="):
			out.Dest = strings.TrimPrefix(arg, "--dest=")
		case strings.HasPrefix(arg, "-") && arg != "-":
			return unrecognized(stderr, []string{arg})
		default:
			return unrecognized(stderr, []string{arg})
		}
	}
	return ParseResult{Args: out}
}

func parseList(args []string, stdout, stderr io.Writer) ParseResult {
	if wantsHelp(args) {
		writeText(stdout, listHelp)
		return ParseResult{Exit: 0, Handled: true}
	}
	if len(args) > 0 {
		return unrecognized(stderr, args)
	}
	return ParseResult{Args: Args{Command: "list"}}
}

func parseEmployees(args []string, stdout, stderr io.Writer) ParseResult {
	if wantsHelp(args) {
		writeText(stdout, employeesHelp)
		return ParseResult{Exit: 0, Handled: true}
	}
	out := Args{Command: "employees"}
	rosterSet := false
	for index := 0; index < len(args); index++ {
		arg := args[index]
		switch {
		case arg == "--apply":
			out.Apply = true
		case arg == "--roster" || arg == "--auto-group":
			if index+1 >= len(args) || looksLikeOption(args[index+1]) {
				return subError(stderr, employeesUsage, "employees",
					"argument "+arg+": expected one argument")
			}
			index++
			if arg == "--roster" {
				out.Roster = args[index]
				rosterSet = true
			} else {
				out.AutoGroup = args[index]
			}
		case strings.HasPrefix(arg, "--roster="):
			out.Roster = strings.TrimPrefix(arg, "--roster=")
			rosterSet = true
		case strings.HasPrefix(arg, "--auto-group="):
			out.AutoGroup = strings.TrimPrefix(arg, "--auto-group=")
		case strings.HasPrefix(arg, "-") && arg != "-":
			return unrecognized(stderr, []string{arg})
		default:
			return unrecognized(stderr, []string{arg})
		}
	}
	if !rosterSet {
		return subError(stderr, employeesUsage, "employees",
			"the following arguments are required: --roster")
	}
	return ParseResult{Args: out}
}

// writeText writes without adding a newline; the texts carry their own.
func writeText(w io.Writer, text string) {
	if w == nil {
		return
	}
	if !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	_, _ = io.WriteString(w, text)
}
