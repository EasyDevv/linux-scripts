# 따옴표 안 원격 sudo가 interactive 터미널로 간 문제

## 결론

| 질문 | 답 |
|---|---|
| 무엇이 났나 | pi `01a16372`(property-portal)에서 `ssh ovh-vps '…'` 34건이 모두 interactive 터미널 오버레이로 감. 32건은 exit 0인데 ERROR로 집계됨 |
| 원인 | `permissions/bash.ts` `commandUnits`가 따옴표를 무시하고 `; \n &&`에서 자름. 원격 스크립트 안의 `sudo ss …`가 로컬 `sudo *` → interactive에 매치됨 |
| sudo 암호 때문이었나 | 아님. 원격 sudo는 tty 없이도 exit 0이었으므로 VPS는 NOPASSWD임. 터미널은 필요 없었음 |
| 같은 버그의 다른 위험 | `rewrite.ts` `splitSegments`도 같은 정규식을 써서, `ssh host 'cd x; rm -rf b'`의 원격 rm을 trash-put으로 바꿔 쓸 수 있었음 |
| 고친 것 | 따옴표와 이스케이프를 인식하는 `splitSegments`를 `bash.ts` 하나에 두고 gate와 rewriter가 함께 씀. 로컬 `sh/bash/zsh/dash/ksh/fish -c '…'`와 `eval`은 안쪽 unit도 gate함 |
| decision 필요 여부 | 아님. pi permissions 확장의 결정적 버그 |

## 증거

| 항목 | 값 |
|---|---|
| 세션 | pi `01a16372-24a0-722b-bb02-cad12425d2ad`, JSONL 84~339행 |
| 대표 명령 | 89행: `ssh -o BatchMode=yes ovh-vps 'set +e\n…\nsudo ss -lntp \| grep 3000\n…'` |
| 알림 | `[permission] ran in the interactive terminal (exit 0)` |
| replay (수정 후) | 실패 목록의 pi `[permission]` 명령 39건 → ssh 36건은 shell, 로컬 `sudo pacman` 3건만 TERMINAL |

## 바꾼 파일

- `~/.pi/agent/extensions/permissions/bash.ts`: `splitSegments`, `commandUnits` 재귀, `localScript`
- `~/.pi/agent/extensions/permissions/rewrite.ts`: 자체 분할기를 없애고 `splitSegments` 사용
- `~/.pi/agent/extensions/permissions/policy.test.ts`, `rewrite.test.ts`: 테스트 3개 추가
- `~/.pi/agent/extensions/permissions/AGENTS.md`: Units 항목 추가

## 검사

- `bun test extensions/permissions`: 53 pass / 2 fail / 1 error. 기준선(수정 전)은 50 / 2 / 1. 실패는 환경에 `@earendil-works/pi-coding-agent` 패키지가 없어서 나는 것으로, 수정 전에도 같음
- `bun run check`: lint 신규 14건이 수정 전과 같고 permissions 쪽 신규는 0건. tests 0 new failures

## 같은 리뷰에서 판정한 것 (No write)

- decision guard 79건 전부 맞는 판정: quote_glob 56건(`--include=*.ext`), pkill_self 2건, wait_loop 1건, wide_search 18건. `find ~`는 depth 3에서 31초, 4에서 78초, 6에서 120초를 넘겨 `MAX_DEPTH=3`이 타당함
- 제안 요청에 먼저 질문한 것(dashboard `a3caf080:631,655`): 명확화 목적이라 맞는 판정이라는 사용자 판단
- pi worker: 10-23 00:37 KST에 수정한 뒤로 실패 0건(수정 전에는 600초 타임아웃 4건). 무거운 세션 f2ed53ff는 반복 디버깅이라 위임 대상이 아님. 표본이 작음

## Backlog

- `tool-errors.py`: `[permission] ran in the interactive terminal (exit 0)`을 실패로 세지 않게 하기 (사용자가 이번엔 선택하지 않음). 그때까지는 `improve-decision-workflow/references/signals.md`의 `permission-overlay run (pi)` 행으로 사람이 판정함. `tool-errors.py --since 7d`에서 이 형태가 top kind로 계속 뜨면 스크립트로 올림
- `~/.ssh/config` `ovh-vps`에 ControlMaster/ControlPersist를 두어 연속 ssh가 한 세션을 쓰게 하기 (사용자가 이번엔 선택하지 않음)
- `"$(sudo …)"`처럼 큰따옴표 안의 명령 치환은 로컬에서 실행되지만 unit으로 보지 않음(수정 전과 동일). 필요하면 `$(…)`와 백틱 안을 재귀 검사
- pi worker 위임 판정은 데이터가 더 쌓이면 `subagent-use.py --since 2026-10-22T15:37:00Z`로 다시 보기
