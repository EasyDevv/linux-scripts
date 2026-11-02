// args.go ports cli-rust/src/args.rs.
//
// Exported: Options, Command, CommandDefault/Help/List/Install/Remove/Update/Audit/Doctor,
// Parse, PrintHelp, WriteHelp. Process entry Run lives in run.go (lib.rs dispatch).

package app

import (
	"fmt"
	"io"
	"os"
	"strings"
)

type Options struct {
	Yes      bool
	DryRun   bool
	JSON     bool
	Check    bool
	Rollback bool
	Names    []string
	Command  Command
}

type Command int

const (
	CommandDefault Command = iota
	CommandHelp
	CommandList
	CommandInstall
	CommandRemove
	CommandUpdate
	CommandAudit
	CommandDoctor
)

// Parse is args::parse. -h/--help anywhere short-circuits to CommandHelp
// and ignores every other flag and positional.
func Parse(args []string) (Options, error) {
	for _, arg := range args {
		if arg == "-h" || arg == "--help" {
			return Options{Command: CommandHelp}, nil
		}
	}

	var (
		yes      bool
		dryRun   bool
		jsonOut  bool
		check    bool
		rollback bool
	)
	positionals := make([]string, 0)
	for _, arg := range args {
		switch arg {
		case "--yes":
			yes = true
		case "--dry-run":
			dryRun = true
		case "--json":
			jsonOut = true
		case "--check":
			check = true
		case "--rollback":
			rollback = true
		default:
			if strings.HasPrefix(arg, "-") {
				return Options{}, fmt.Errorf("unknown option: %s", arg)
			}
			positionals = append(positionals, arg)
		}
	}

	var command Command
	switch first(positionals) {
	case absent:
		command = CommandDefault
	case "list":
		if err := rejectExtra(positionals); err != nil {
			return Options{}, err
		}
		command = CommandList
	case "install":
		command = CommandInstall
	case "remove":
		command = CommandRemove
	case "update":
		command = CommandUpdate
	case "audit":
		if err := rejectExtra(positionals); err != nil {
			return Options{}, err
		}
		command = CommandAudit
	case "doctor":
		if err := rejectExtra(positionals); err != nil {
			return Options{}, err
		}
		command = CommandDoctor
	default:
		return Options{}, fmt.Errorf("unknown command: %s", positionals[0])
	}

	names := []string{}
	switch command {
	case CommandInstall, CommandRemove, CommandUpdate:
		names = append(names, positionals[1:]...)
	}
	return Options{
		Yes:      yes,
		DryRun:   dryRun,
		JSON:     jsonOut,
		Check:    check,
		Rollback: rollback,
		Names:    names,
		Command:  command,
	}, nil
}

const absent = "\x00"

func first(positionals []string) string {
	if len(positionals) == 0 {
		return absent
	}
	return positionals[0]
}

func rejectExtra(positionals []string) error {
	if len(positionals) > 1 {
		return fmt.Errorf("unexpected argument: %s", positionals[1])
	}
	return nil
}

// PrintHelp is args::print_help. Write errors are ignored, matching Rust.
func PrintHelp() {
	_ = WriteHelp(os.Stdout)
}

// WriteHelp is args::write_help. Color follows stdout (not the writer), matching Rust.
func WriteHelp(out io.Writer) error {
	enabled := StdoutEnabled()
	command := Paint("명령", []string{BOLD, CYAN}, enabled)
	flags := Paint("공통 옵션", []string{BOLD, YELLOW}, enabled)
	if _, err := fmt.Fprintln(out, Paint("cli — 도구 설치·점검", []string{BOLD}, enabled)); err != nil {
		return err
	}
	if _, err := fmt.Fprintln(out); err != nil {
		return err
	}
	if _, err := fmt.Fprintln(out, "사용법:"); err != nil {
		return err
	}
	if _, err := fmt.Fprintln(out, "  cli"); err != nil {
		return err
	}
	if _, err := fmt.Fprintln(out, "  cli <명령> [옵션]"); err != nil {
		return err
	}
	if _, err := fmt.Fprintln(out); err != nil {
		return err
	}
	if _, err := fmt.Fprintln(out, command); err != nil {
		return err
	}
	for _, item := range commandHelp {
		line := fmt.Sprintf("  %s %s",
			Paint(padRight(item[0], 10), []string{GREEN}, enabled),
			Paint(item[1], []string{DIM}, enabled),
		)
		if _, err := fmt.Fprintln(out, line); err != nil {
			return err
		}
	}
	if _, err := fmt.Fprintln(out); err != nil {
		return err
	}
	if _, err := fmt.Fprintln(out, flags); err != nil {
		return err
	}
	for _, item := range flagHelp {
		line := fmt.Sprintf("  %s %s",
			Paint(padRight(item[0], 16), []string{CYAN}, enabled),
			Paint(item[1], []string{DIM}, enabled),
		)
		if _, err := fmt.Fprintln(out, line); err != nil {
			return err
		}
	}
	return nil
}

var commandHelp = [][2]string{
	{"list", "목록과 설치 상태"},
	{"install", "게이트 통과 후 설치"},
	{"remove", "기록된 항목 삭제"},
	{"update", "후보 조회와 교체"},
	{"audit", "정책·취약점 점검"},
	{"doctor", "설치·환경 점검"},
}

var flagHelp = [][2]string{
	{"--yes", "승인 생략"},
	{"--dry-run", "바꾸지 않고 계획만 표시"},
	{"--check", "update: 후보만 조회"},
	{"--rollback", "update: 직전 버전으로 되돌림"},
	{"--json", "JSON으로 출력"},
	{"-h, --help", "이 도움말"},
}

func padRight(s string, width int) string {
	if len(s) >= width {
		return s
	}
	return s + strings.Repeat(" ", width-len(s))
}
