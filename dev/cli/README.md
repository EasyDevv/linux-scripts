# cli

proto 위에 얹는 CLI 도구 설치·점검 관리자(Go · Bubble Tea). 목록은 `tools.toml`이고, 설계와 기록은 `../../docs/plan/261102-cli.md`.

| 명령 | 동작 |
| --- | --- |
| `cli` | TTY에서 카테고리(cloud·payment·database·ai·social·security)별 체크박스 목록. 처음엔 아무것도 선택되지 않음. `space` 선택, `a` 전체선택, `n` 전체해제, `↑↓`/`jk` 이동, `g`/`G` 처음·끝. 선택 항목에 `i` 설치, `x` 삭제, `u` 업데이트, `c` 업데이트 확인, Enter는 작업 메뉴, `q` 취소. 비TTY는 도움말, 종료 코드 1 |
| `cli list [--json]` | 목록, 방식, 우선순위, PATH 설치 여부 |
| `cli install <이름…> [--yes] [--dry-run]` | 7일 cooldown과 체크섬·서명·고정 해시 게이트를 통과해야 설치(prerelease 버전은 거부). 통과 못 하면 종료 코드 2 |
| `cli remove <이름…> [--yes]` | `lock.json`에 기록된 항목만 삭제 |
| `cli update [이름…] [--check] [--rollback]` | `--check`는 후보 조회만(읽기 전용). 교체는 설치와 같은 게이트를 거치고, `--rollback`은 직전 버전을 다시 설치 |
| `cli audit [--json]` | 목록 정책 점검 + `osv-scanner`(Go 바이너리, bun 전역 lock, 이 모듈의 go.mod·go.sum). 위반·취약점이 있으면 종료 코드 2 |
| `cli doctor [--json]` | 설치·버전·PATH 충돌·lock 일치·환경변수 이름 설정 여부(값은 읽지 않음)·프로브. 문제나 미설치가 있으면 종료 코드 1 |

설치 방식: release·vendor는 생성한 proto 플러그인(`~/.local/share/cli/plugins`)과 `.protolock` 교차 대조, bun은 `bun add -g --ignore-scripts --minimum-release-age`, go는 `go install`, cargo는 `cargo install --locked`.

환경변수(경로 재지정, 시험용): `CLI_MANIFEST`, `CLI_HOME`, `CLI_STATE`, `CLI_PREFIX`, `CLI_PROTO`, `CLI_BUN`, `CLI_GO`, `CLI_CARGO`, `CLI_OSV`.

종료 코드: 0 정상, 1 오류, 2 게이트 차단 또는 audit 발견.

`tools.toml`의 `category` 필드가 picker 묶음을 정한다(없거나 모르는 값은 `other`).

구현: Go 1.26+ · Bubble Tea v2(`internal/ui` picker) · 표준 라이브러리. 래퍼 `../cli.sh`가 `go build -C dev/cli -o bin/cli .` 후 `CLI_ROOT`를 정하고 실행한다. 빌드 산출물 `bin/`은 git에서 제외된다.

테스트: `cd dev/cli && go vet ./... && go test ./...`. Rust 원본 테스트와의 대응은 `TESTMAP.md`, 이전 계획은 `~/chat/docs/plan/261102-terminal-go-bubbletea.md`.
