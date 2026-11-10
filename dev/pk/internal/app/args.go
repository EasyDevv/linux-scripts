package app

import (
	"fmt"
	"strings"
)

// isMissing and errors above are reported with these exit codes.
const (
	exitOK      = 0
	exitFailure = 1
	exitUsage   = 2
	exitAbort   = 130
)

// Version is the pk version printed by --version.
const Version = "0.1.0"

// options is one parsed command line.
type options struct {
	help    bool
	version bool
	list    bool
	json    bool
	dir     string
	pm      string
	color   string
	script  string
	forward []string
}

// parseArgs reads flags up to the script name; everything after it is
// forwarded to the package manager unchanged.
func parseArgs(args []string) (options, error) {
	var opts options
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "-h" || arg == "--help":
			opts.help = true
		case arg == "--version":
			opts.version = true
		case arg == "-l" || arg == "--list":
			opts.list = true
		case arg == "--json":
			opts.json = true
		case arg == "--":
			return opts, fmt.Errorf("스크립트 이름이 필요합니다")
		case arg == "--pkg" || arg == "--pm" || arg == "--color":
			if i+1 >= len(args) {
				return opts, fmt.Errorf("%s 값이 필요합니다", arg)
			}
			i++
			if err := opts.set(arg, args[i]); err != nil {
				return opts, err
			}
		case strings.HasPrefix(arg, "--pkg="), strings.HasPrefix(arg, "--pm="), strings.HasPrefix(arg, "--color="):
			name, value, _ := strings.Cut(arg, "=")
			if err := opts.set(name, value); err != nil {
				return opts, err
			}
		case strings.HasPrefix(arg, "-") && arg != "-":
			return opts, fmt.Errorf("알 수 없는 플래그: %s", arg)
		default:
			opts.script = arg
			rest := args[i+1:]
			// A leading `--` is the usual separator; drop it, keep the rest verbatim.
			if len(rest) > 0 && rest[0] == "--" {
				rest = rest[1:]
			}
			opts.forward = append(opts.forward, rest...)
			return opts, nil
		}
	}
	return opts, nil
}

func (o *options) set(name, value string) error {
	switch name {
	case "--pkg":
		if value == "" {
			return fmt.Errorf("--pkg 값이 비었습니다")
		}
		o.dir = value
	case "--pm":
		switch value {
		case "bun", "pnpm", "yarn", "npm":
			o.pm = value
		default:
			return fmt.Errorf("--pm 은 bun, pnpm, yarn, npm 중 하나입니다: %s", value)
		}
	case "--color":
		switch value {
		case "auto", "always", "never":
			o.color = value
		default:
			return fmt.Errorf("--color 는 auto, always, never 중 하나입니다: %s", value)
		}
	}
	return nil
}

// helpText is the full help: what pk does, then the flags, then the rules a
// caller needs to script it.
const helpText = `pk — package.json 스크립트 선택기

사용법
  pk                    가장 가까운 package.json의 스크립트를 목록에서 골라 실행
  pk <script> [인자…]    목록 없이 바로 실행 (bun run <script> 인자…)
  pk --list [--json]     목록만 출력 (비TTY에서 쓰는 경로)

플래그
  --pkg <dir>           탐색을 시작할 디렉터리 (기본: 현재 디렉터리)
  --pm <bun|pnpm|yarn|npm>   실행할 패키지 매니저 강제
  --color <auto|always|never>  색 사용 여부
  -l, --list            목록 출력
  --json                --list 결과를 JSON으로
  -h, --help            이 도움말
  --version             버전

키
  이동 : ↑/↓ j/k | 처음/끝 : g/G | 실행 : enter | 취소 : q

규칙
  최근 목록: pk로 실행한 스크립트를 프로젝트별로 세어 상위 5개를 맨 위에 둔다.
  상태 파일: ~/.local/share/pk/recent.json (PK_STATE로 경로 변경)
  package.json 탐색: 현재 디렉터리에서 상위로 올라가며 scripts가 있는 첫 파일.
  색: NO_COLOR가 설정됐거나 stderr가 TTY가 아니면 끈다.

종료 코드: 0 정상, 1 오류, 2 잘못된 인자, 130 취소

자세한 내용: pk --help
`

// usageHint prints one line plus the shortest hint, never the whole help.
func usageHint(err error) string {
	return fmt.Sprintf("pk: %v\n  pk --help 로 사용법을 봅니다", err)
}
