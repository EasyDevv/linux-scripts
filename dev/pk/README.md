# pk

package.json 스크립트 선택기(Go · Bubble Tea v2). 프로젝트 디렉터리에서 `pk`를 치면 가장 가까운
`package.json`의 스크립트를 화살표로 골라 실행하고, `pk`로 실행한 스크립트를 프로젝트별로 세어
상위 5개를 목록 맨 위 `Recent`에 둔다.

## 명령

| 명령 | 동작 |
| --- | --- |
| `pk` | 인라인 목록에서 이동(↑↓ j/k, g/G) 후 `enter`로 실행, `q`/`esc`/`ctrl+c`로 취소(130). 실행 전 `pk › bun run <script>` 한 줄을 stderr에 남긴다 |
| `pk <script> [인자…]` | 목록 없이 바로 실행. `pk test --watch` → `bun run test --watch` |
| `pk --list [--json]` | 목록만 출력. 최근 항목은 `*` 표시. 비TTY에서 쓰는 경로 |
| `pk --pkg <dir>` | 탐색 시작 경로 지정 |
| `pk --pm bun\|pnpm\|yarn\|npm` | 실행할 패키지 매니저 강제 |
| `pk --color auto\|always\|never` | 색 사용 여부 |

## 규칙

- package.json 탐색: 현재 디렉터리에서 상위로 올라가며 `scripts`가 있는 첫 파일. `apps/client` 같은
  모노레포 하위 디렉터리에서도 루트 스크립트를 찾는다. 상위 12단계까지 본다.
- 패키지 매니저: `packageManager` 필드 우선, 다음 잠금 파일(`bun.lock`, `pnpm-lock.yaml`,
  `yarn.lock`, `package-lock.json`), 없으면 `bun`.
- Recent: `pk`로 실행한 스크립트만 집계한다(픽커 선택과 `pk <script>` 모두). 상위 5개는 횟수 → 최근
  시각 → 이름 순. package.json에서 사라진 스크립트는 목록에서 빠진다. 기록은 실행 직전에 저장하므로
  dev 서버를 중간에 끊어도 한 번은 센다.
- 상태 파일: `~/.local/share/pk/recent.json` (`PK_STATE`로 경로 변경). 프로젝트당 20개까지만 남긴다.
  파일이 없거나 깨졌으면 빈 상태로 시작하고, 저장에 실패하면 경고만 하고 스크립트는 실행한다.
- 색: `NO_COLOR`가 설정됐거나 `TERM=dumb`이거나 stderr가 TTY가 아니면 끈다. Alt 조합은 KWin이
  소유하므로 바인딩하지 않는다.

## 종료 코드

| 코드 | 의미 |
| --- | --- |
| 0 | 정상 |
| 1 | 오류(package.json 없음, 스크립트 없음, 비TTY에서 픽커 요청, 자식 실행 실패) |
| 2 | 잘못된 인자 |
| 130 | 취소(q, esc, ctrl+c) |

## 구현

`main.go`는 `app.Run`만 부른다. `internal/app`은 인자 해석(`args.go`), package.json 탐색과 정렬된
scripts 파싱(`project.go`), 최근 기록(`recent.go`), 목록 출력(`list.go`), 픽커와 실행(`run.go`)을
맡는다. `internal/ui`는 인라인 목록이며 대체 화면을 쓰지 않는다: 목록은 stderr에 그리고, 선택 후
프로세스가 끝나면 같은 터미널에서 패키지 매니저가 돈다.

래퍼 `../pk.sh`가 `go build -C dev/pk -o bin/pk .` 후 실행한다. 빌드 산출물 `bin/`은 git에서 제외된다.

테스트: `cd dev/pk && go vet ./... && go test ./...`. 화면과 키는
`~/.agents/skills-routed/build/build-terminal/scripts/check-terminal.sh dev/pk`로 검사한다.
