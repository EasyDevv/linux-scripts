# pi-worker 자율도 — 워커 안에서도 독립 pi처럼 병렬로 일한다
> 상태: P1~P4 구현·라이브 확인 완료(261024, 미커밋), P5 벤치는 `docs/backlog`에 결과 기록 대기 · 잇는 기획: `docs/backlog/261023-pi-worker-delegation-eval.md` · 대상: `~/.agents/plugins/pi`, `~/.pi/agent/extensions/{subagent,decision,file-lock}`

## Intent

### 확정 상태
Clarity 10/10 (261024, 사용자 확정). `.product` surface 없음.

### Problem
- 지금 워커(`pi -p --no-session` 자식)는 `--tools read,grep,find,ls[,bash,edit,write]`만 갖고, `subagent` 도구가 없으며 깊이 1로 막혀 있어 자기 안에서 병렬로 일할 수 없다.
- 그래서 병렬이 필요하면 Claude(오케스트레이터)가 워커를 여러 번 부르거나 직접 해야 하고, 그만큼 호출·컨텍스트 토큰이 든다.
- find_skill/find_tool이 꺼져 있어 워커가 `bun-webview` 같은 스킬을 못 찾고 raw CDP로 우회했다 (261024 세션 `2f0f19e4`: 워커가 `wv.ts` 대신 직접 짠 CDP 스크립트로 브라우저 검증).
- read/write 두 mode가 도구 목록·하위 에이전트 규칙을 이중으로 만들어 레이어가 늘었다.

### Outcome
- 워커 한 호출 안에서 하위 pi 에이전트를 최대 4개 동시에 띄워 병렬로 일한다 (깊이: Claude → 워커 → 하위, 하위는 더 못 띄움).
- 워커가 독립 pi와 같은 도구셋(subagent, MCP, 확장 도구)과 find_skill/find_tool/guard를 쓴다.
- 병렬 write 하위가 같은 파일을 동시에 고치지 못하게 파일 lock이 막고, 세션이 비정상 종료돼도 lock이 남지 않는다.
- `mode` 파라미터가 사라진다. 끄기 옵션 `autonomy:"off"`로 호출별로 예전의 제한된 워커를 쓸 수 있다.
- 순차 대 중첩 병렬의 ms·cost를 같은 작업으로 측정한 수치가 남는다.

### Users and systems
- 사용자 1명(easydevv), Claude Code 오케스트레이터, pi 워커 자식과 그 하위 에이전트.
- 바뀌는 파일:
  - `~/.agents/plugins/pi/hooks/worker.ts`, `worker.test.ts`, `register.tsx`, `types/index.d.ts`, `evals/scenarios.jsonl`, `evals/bench.ts`(신규), `.claude-plugin/plugin.json`(버전)
  - `~/.config/pi-worker/config.json` (`readTools`/`writeTools`/`defaultMode`/`allowWrite` 제거, `baseTools` 추가)
  - `~/.pi/agent/extensions/subagent/depth.ts`, `depth.test.ts`, `index.ts`
  - `~/.pi/agent/extensions/decision/index.ts` (+ 테스트)
  - `~/.pi/agent/extensions/file-lock/` (신규)

### Constraints
| 영역 | 한계 |
|---|---|
| 우선순위 | 속도 우선 |
| 비용 | 상한을 두지 않는다 (결정, `docs/backlog/261024-pi-worker-no-cost-cap.md`). ledger는 관찰만 |
| 시간 | 기존 idle 5분 / wrap-up 12분 / kill 15분을 하위 포함 전체에 그대로 적용 |
| 구조 | 깊이 2, 워커당 동시 하위 4 (`subagent/config.json` `parallel.concurrency: 4` 이미 충족), 하위는 spawn 불가, 오케스트레이터 `MAX_TASKS` 4 유지 → 최대 동시 16 |
| 기본값 | autonomy 기본 on, 호출별 `autonomy:"off"`로 끔 |
| 라우팅 | find_skill/find_tool/guard만 켠다. model_route·세션모델·autoLint·알림은 계속 끈다 |
| 쓰기 충돌 | 파일 lock은 `edit`/`write` 도구만. bash 쓰기(`sed -i`, `>`)는 못 막고 문서화한다 |
| 범위 | lock은 `PI_SUBAGENT=1` 프로세스만 대상 (대화형 pi가 파일을 몇 시간씩 잡지 않게). Claude 쪽 편집은 대상 아님 |

### Out of scope
- 비용(USD) 상한·예산 차단 (결정: 두지 않음).
- bash 파일 쓰기 감지·lock.
- `MAX_TASKS` 상향 (4 유지).
- 하위 에이전트마다 git worktree 격리 (보류, 재논의: lock이 부족하다고 판명될 때).
- 벤치 결과가 나쁠 때 기본값을 off로 되돌리는 자동 규칙 (관찰만, 판단은 사용자).

### Verification
- `bun test ~/.agents/plugins/pi/hooks/worker.test.ts` — mode 제거, argv(`--tools` 없음/있음), env(`PI_SUBAGENT_MAX_DEPTH`).
- `~/.pi/agent/extensions/subagent/test.sh` — depth 환경 오버라이드.
- `file-lock/lock.test.ts` — 경합, 재진입, stale 회수(죽은 pid), pid 재사용(starttime 불일치).
- `evals/bench.ts` — 같은 4개 독립 작업을 autonomy off(순차) 대 on(중첩 병렬)로 돌려 ms·cost 비교, 결과를 backlog에 기록.
- 라이브 확인: 워커 한 호출에서 하위 spawn, find_skill 호출, 같은 파일 동시 edit 차단 로그.

### Open questions
없음.

본문과 달라진 것(이 절이 이긴다)
- **기본값 변경 (261024, 사용자 확정, 벤치 근거 `docs/backlog/261024-pi-worker-nested-bench.md`)**: `autonomy` 기본은 **off**. 병렬은 오케스트레이터가 `tasks`로 조각마다 워커를 따로 띄운다. `autonomy: on`은 조각이 작업 중에야 드러날 때만 opt-in하며, on의 도구는 lean(`onTools`: base7 + `subagent`, `find_skill`, `find_tool`)과 하위 `worker-sub`가 기본이다. 근거: 15회 중 모델이 스스로 하위를 띄운 적 0회, full은 같은 결과에 비용 1.3~3.5배(자식당 입력 22.6k 대 lean 5k), 명시 지시로 띄운 중첩 병렬은 이득이 없거나 작고 비쌌고 `tasks` 병렬은 단일 실행에서 heavy4 189s→89s였으나 3회 반복에서는 재현되지 않았다(off 102s, fan 48~147s, 1회 실패). 반복에서 `tasks`가 확실히 빠른 쪽은 tests4(53s→42s, 비용 2배)뿐이다.
- Intent의 Outcome 1·2·`기본값` 행(autonomy 기본 on)은 위 결정이 이긴다. 깊이 2·동시 4·lock·`MAX_TASKS` 4는 그대로.
- §2.2: 별도 `maxDepthFor`와 `index.ts` 변경 없이 `depth.ts`의 `depthBlock`이 `PI_SUBAGENT_MAX_DEPTH`를 직접 읽는다 (`effectiveMaxDepth`).
- §2.3: `return`을 쪼개는 대신 부모가 `PI_SUBAGENT_SKILLS=1`을 준 자식만 find_skill/find_tool을 등록한다. 일반 `subagent` 자식은 그대로 건너뛴다. 이 자식은 model 고정(`modelPinned`)으로 취급해 model_route가 꺼진다.
- 행·헤더 표시는 `· auto:on` / `auto:off` (`[worker standard · auto:on · …]`).

## 1. 지금 있는 것 (261024 확인)
| 항목 | 위치 | 이번 작업에 쓸 수 있나 |
|---|---|---|
| 워커 argv: `pi --mode json -p --no-session --tools <read\|write 목록>` | `hooks/worker.ts:252-256` | `--tools` 제거/교체 대상 |
| 자식 env `PI_SUBAGENT=1`, `PI_SUBAGENT_DEPTH=1` | `hooks/worker.ts:277-280` | `PI_SUBAGENT_MAX_DEPTH=2` 추가 |
| mode 정의·검증·프롬프트·행 표시 | `worker.ts:13-14, 39-43, 87-90, 184, 216-226, 250, 585, 635, 651, 670, 682`, `register.tsx:249-283, 389` | 모두 제거 |
| 깊이 게이트 `MAX_DEPTH=1`, `depthBlock(maxDepth, env)` | `subagent/depth.ts:7-27` | 환경 오버라이드를 더할 자리 |
| `maxDepth`는 `loadMaxDepth()`로 한 번 읽고 `tool_call`에서 차단 | `subagent/index.ts:669-675` | 오버라이드를 여기서 반영 |
| 자식 env는 `...process.env` 상속 + `PI_SUBAGENT_DEPTH+1` | `subagent/index.ts:507-510` | `PI_SUBAGENT_MAX_DEPTH`가 하위로 전파됨 |
| 병렬 `maxTasks 8`, `concurrency 4` | `subagent/config.json` | 동시 4는 이미 충족 |
| decision 확장: `registerLoop`, `registerGuard`는 PI_SUBAGENT 앞에서 등록, 그 뒤 `return` | `decision/index.ts:373-376` | guard는 이미 자식에 적용 |
| find_skill/find_tool 도구 등록은 `return` 뒤 | `decision/index.ts:1137, 1166` | return 앞으로 분리 필요 |
| 파일 lock 확장 | 없음 | 신규 |
| 비용 상한 | 없음 (ledger는 `LedgerRow`로 관찰만, `worker.ts:498-521`) | 결정: 두지 않음 |

## 2. 설계

### 2.1 mode 폐지, autonomy 도입
- `mode` 파라미터와 설정(`readTools`, `writeTools`, `defaultMode`, `allowWrite`)을 제거한다. 행 표시는 `Worker(title) · tier`.
- `autonomy` (`"on"` 기본, `"off"`):
  - on: `--tools`를 넘기지 않아 기본 활성 도구(내장 + 확장 + MCP)를 모두 쓴다. env에 `PI_SUBAGENT_MAX_DEPTH=2`.
  - off: `--tools <baseTools>` (`read,grep,find,ls,bash,edit,write`), `PI_SUBAGENT_MAX_DEPTH` 없음 → 기존과 같은 제한 워커.
- 조사만 시킬 땐 브리프에 "수정 금지"를 적는다 (지금 브리프가 이미 그렇게 한다). 도구 수준의 읽기 전용 보장은 사라지며 이는 수용한 트레이드오프다.
- 보고 프롬프트(`reportPrompt`)는 "하위 에이전트를 써서 서로 겹치지 않는 파일 경로로 나눠 병렬로 하라"를 추가한다.

### 2.2 깊이는 워커에만 2
- `depth.ts`에 `maxDepthFor(configured, env)`: `PI_SUBAGENT_MAX_DEPTH`가 양의 정수면 그 값, 아니면 `configured`.
- 전역 `config.jsonc`의 `maxDepth`를 올리지 않는다. 대화형 pi의 subagent는 그대로 깊이 1.
- 흐름:
```text
Claude ── worker 호출 ──▶ pi 자식 (PI_SUBAGENT=1, DEPTH=1, MAX_DEPTH=2)
                              └─ subagent ×≤4 ──▶ 하위 (DEPTH=2) ── subagent 시도 → 차단
```

### 2.3 라우팅은 find_skill/find_tool만 자식에게
- `decision/index.ts:376`의 `return`을 쪼갠다: find_skill/find_tool 도구(`:1137`, `:1166`)와 그에 필요한 `before_agent_start` 힌트는 자식에도 등록하고, model_route(`input` 훅 `:846`)·세션모델·contributor 경로는 `PI_SUBAGENT`에서 계속 건너뛴다.
- guard는 이미 자식에 걸려 있다 (`:373-375`). 변경 없음.

### 2.4 file-lock 확장
- 대상: `PI_SUBAGENT=1`인 프로세스의 `edit`/`write` `tool_call` (`event.input.path`).
- 키: `realpath(path)`의 sha1. 디렉터리: `$XDG_RUNTIME_DIR/pi-file-locks` (없으면 `/tmp/pi-file-locks-<uid>`).
- 점유: `mkdir <key>`(원자적) 후 `owner.json` `{pid, startTicks, path, ts}`. 해당 프로세스가 끝날 때(`session_shutdown`)까지 보유 → 하위가 자기 파일의 소유자가 된다 (읽고-수정-쓰기 사이 덮어쓰기 방지).
- 충돌: 다른 프로세스가 점유 중이면 3초(200ms 폴링) 대기 후 `block`: "다른 하위가 이 파일을 수정 중입니다 (pid N). 다른 파일을 먼저 하거나 보고에 남기세요."
- 같은 pid 재진입은 통과.
- stale 회수: owner pid가 죽었거나 `/proc/<pid>/stat` starttime이 다르면(pid 재사용) 폴더를 지우고 다시 점유. `owner.json`이 아직 없는 새 폴더는 2초까지 점유 중으로 본다.
- 한계(문서화): bash 쓰기, Claude 편집은 못 막는다.

### 2.5 벤치
- `evals/bench.ts`: 서로 독립인 4개 작업(예: 모듈 4개에 각각 테스트 파일 작성)을 같은 모델·티어로 (a) autonomy off 한 자식이 순차로, (b) autonomy on 한 자식이 하위 4개로 처리. `pi --mode json` 이벤트에서 `ms`, `cost`, `toolCalls`를 `worker.ts`의 파서로 집계.
- 결과는 판정 없이 `docs/backlog/`에 기록한다 (사용자가 판단, 기본값 on 유지).

## 3. 단계
| 단계 | 범위 | 테스트 |
|---|---|---|
| P1 깊이 오버라이드 | `subagent/depth.ts`, `index.ts` — `PI_SUBAGENT_MAX_DEPTH` | `depth.test.ts`: 환경 값 우선, 잘못된 값은 무시, 깊이 2에서 허용·3에서 차단 |
| P2 find_skill 자식 등록 | `decision/index.ts` return 분리 | 기존 decision 테스트 + 자식 env에서 find_skill/find_tool 등록, model_route 미등록 |
| P3 file-lock | `file-lock/index.ts`, `lock.ts`, `lock.test.ts` | 경합 차단, 재진입, 죽은 pid 회수, starttime 불일치 회수, PI_SUBAGENT 아닐 때 무동작 |
| P4 워커 개편 | `worker.ts`, `register.tsx`, `types`, 설정, `plugin.json` 버전 | `worker.test.ts`: mode 제거, autonomy on/off argv·env, 행 표시 |
| P5 벤치·문서 | `evals/bench.ts`, scenarios의 `mode` 필드 제거, backlog 기록 | 벤치 실행, `evals/run.sh` 한 라운드 |
P1~P3은 독립, P4는 P1·P2 뒤, P5는 P3·P4 뒤.

공통 완료 조건(단계마다): 단계 테스트 통과 → 실제 `pi -p` 자식에서 해당 동작 라이브 확인(A1~A4) → 사용자 최종 확인. 테스트가 실패하거나 동작이 계획과 다르면 그 단계를 멈추고 보고한다.

## 확인할 가정
| # | 가정 | 확인 방법 |
|---|---|---|
| A1 | `--tools` 없이 띄운 `pi -p` 자식의 활성 도구에 `subagent`, `find_skill`이 들어 있다 | `pi --mode json -p --no-session "list your tool names"` 출력. 261024 부분 확인: `subagent`, serena_*, web_search, todo, interactive_shell, enqueue_task 있음, `find_skill` 없음(P2 대상). 도구 설명이 자식 컨텍스트를 키우므로 벤치의 cost에서 확인 |
| A2 | `edit`/`write` `tool_call`의 경로는 `event.input.path` | **확인됨(261024)**: 라이브 자식 2개가 `shared.txt`를 동시에 고치려 할 때 한쪽이 `[file-lock] … pid N` 으로 막혔다 |
| A3 | 자식이 `session_shutdown`에서 확장 정리 코드를 실행한다 (`timeout`이 SIGTERM으로 끊어도) | **확인됨(261024)**: 정상 종료와 SIGTERM(`timeout` 기본)은 lock 해제. SIGKILL은 lock이 남지만 다음 워커가 stale로 회수해 덮어씀(라이브). SIGTERM 후 하위 pi 프로세스는 부모와 함께 사라짐. 남는 것: pi bash 도구가 띄운 손자(`sleep` 등)는 부모가 죽어도 고아로 남는다(기존 동작, base 워커도 동일) |
| A4 | decision 데몬이 자식에서 find_skill 요청을 받는다 (인증·소켓 접근) | **확인됨(261024)**: `find_skill("drive a browser page with bun-webview")`가 `browser`, `bun-webview` 스킬과 SKILL.md 경로를 돌려줌 |
| A5 | 동시 16 프로세스가 프로바이더 rate limit에 걸리지 않는다 | 벤치 중 429/재시도 로그 |

## 변경 이력
- 261024: 최초 작성. 사용자 확정(grilling 3라운드). 정정: guard는 이미 자식에 적용 중 (`decision/index.ts:373-376`), 깊이는 전역 `maxDepth` 대신 워커 env 오버라이드로 한정.

- 261024 (벤치 후 결정): 기본 off, 병렬은 `tasks`, `onTools`/`subagentAgent` 설정 추가(`WorkerConfig`), `~/.pi/agent/agents/worker-sub.md`(base7만 가진 하위), 비용 집계에 하위 usage 포함(`Outcome.nested`, 헤더 `(incl. N subagents $x)`, ledger `subagents`), 툴 설명·DELEGATION에 병렬 기준(독립 조각 3개 이상, 각 1분 이상이면 조각마다 task).
- 261024 (구현): P1 `subagent/depth.ts`, P2 `decision/index.ts`, P3 `file-lock/`, P4 `worker.ts`·`register.tsx`·테스트·`plugin.json` 0.3.0·`~/.config/pi-worker/config.json`, 평가 `judge.py`·`scenarios.jsonl`에서 mode 제거, `evals/bench.ts` 추가. 테스트: `claude plugin test ~/.agents/plugins/pi` 36 pass, `file-lock` 11 pass, `depth` 2 pass. 라이브: 자식 한 호출에서 find_skill, 병렬 하위 2개, 같은 파일 lock 차단, 깊이 2에서 손자 spawn 차단(둘 다 `limit is 2`)을 27초에 확인.
- 261024 (발견): 입력이 열린 stdin에서 `pi -p`를 직접 띄우면 출력 없이 무한 대기한다(10분 낭비). 수동 실험과 `bench.ts`는 `stdin: ignore`/`< /dev/null`을 쓴다. 워커 본체는 `$.process.spawn`으로 이미 동작 중.
- 261024 (반복 검증): 3회 반복(tests4/heavy4/discover)에서 중첩 병렬(leanP)이 전부 졌다(off 대비 2~2.5배 느리고 비용 3~4배, discover 포함). 기본 off 결정 유지. 플러그인 0.3.0 설치 후 `evals/run.sh r4` 12/12 통과($1.28), 병렬 시나리오에서 `tasks` 배치 사용 확인. A3(킬 테스트)는 `docs/backlog/261024-pi-worker-nested-bench.md`에 기록.

## 참고
- `~/.agents/plugins/pi/hooks/worker.ts`, `guard/worker-guard.js`
- `~/.pi/agent/extensions/subagent/{depth.ts,index.ts,config.json}`
- `~/.pi/agent/extensions/decision/index.ts`
- `docs/backlog/261023-pi-worker-delegation-eval.md`, `docs/backlog/261024-pi-worker-no-cost-cap.md`
- 발단 세션: Claude `2f0f19e4-5292-43d4-a036-a5de4edd59d2` (워커가 bun-webview 대신 raw CDP 사용)
