# 디시전 모델 코어 (decision) 구현 계획

## 결론

| 질문 | 답 |
|---|---|
| 무엇을 만드나 | **`~/.local/share/scripts/dev/decision/`** — Bun HTTP 데몬. Jev 판정 + 공통 auth + 캐시 + 예산 장부 + decision log |
| 백엔드 | **OpenRouter 최신 Jev** (`typesafe/jev-1.14`, 입력 $0.042/MTok, `OPENROUTER_API_KEY`) → Zen 최신 Jev (`jev-1.13-free` → `jev-1.13`) → **`unavailable`**. decision model이 아닌 폴백은 쓰지 않음 |
| 기동 | **독립 systemd user unit `decision.service`**, `127.0.0.1:45130` 직결. 데몬이 죽으면 클라이언트는 fail-open |
| 기능 | `model_route` · `find_skill` (+ routed rules) · `find_tool` · `orchestrator` |
| 소비자 | pi 확장 `extensions/decision/` · Claude Code mod `~/.agents/plugins/decision/` |
| 제거 | `npm:pi-jev`, `npm:pi-jev-model-router` 및 이 repo의 jev 연결부 일체 (§8-3) |
| rules 재편 | always-on은 **`pc-spec`, `clarity`만**. `docs-archive` 포함 나머지는 **`~/.agents/rules-routed/`**, 프로젝트 전용과 공유 템플릿(`rules-optional`)은 `{projectRoot}/.agents/rules-routed/` ([프로젝트 지정](../rules/261018-project-rules-routing.md)) |
| 트리거 | **`paths:` 글롭 우선(스크립트), Jev 차순위**. find_skill v3 승격 ([하이브리드](261018-path-trigger-hybrid.md)) |
| 캐시 | rule·skill은 **턴 메시지·tool 결과로만**, 카탈로그는 첫 턴 고정. 기준선 적중 96.3%, break 초과 9.6% ([계산식](261018-cache-cost.md)) |
| 개선 방식 | 질문 프롬프트를 **버전 관리** → 오프라인 eval + pi/Claude 세션 감사로 비교 → 기준선 이상일 때만 승격 (§9) |
| 상태 | **M1–M4·상시 구현 완료** (2026-10-18). OpenRouter Jev 1.14로 4개 기능과 pi 세션 smoke 통과 (§11) |
| 다음 행동 | 7일 audit + `cache-report.ts --days 7`. 하향 보류 규칙을 가격 기준으로 (캐시 문서 Backlog) |

| 마일스톤 | 내용 | 종료 조건 |
|---|---|---|
| M1 ✅ | 코어 데몬, auth, 백엔드 체인, decision log, `model_route`, jev 패키지 제거 | `bun test` 통과, pi에서 tier 전환이 log에 기록됨, `bun run check` 통과 |
| M2 ✅ | `find_skill` + rules-routed 이동 + learn·write-a-rule·로더 수정 | 초기 프롬프트 `user_rules` 7.5KB → 1KB 이하, skill eval recall ≥ 0.9 |
| M3 ✅ | `find_tool` (가산 활성화) | 비활성 도구 스키마 제외, tool eval completion 저하 0 |
| M4 ✅ | `orchestrator` | 서브에이전트 분기 eval 정확도 ≥ 기준선, upstream 역할만 사용 |
| 상시 ✅ | eval·audit·프롬프트 버전 루프 | `decision eval`, `decision audit` 리포트가 매 버전 남음 |

| 버린 안 | 이유 |
|---|---|
| 매 step 도구 1개만 노출 (jev-eval-agent 방식) | 입력 토큰은 85–90% 줄지만 6개 과제 중 3개에서 completion 0.67–0.83으로 떨어짐 (§3) |
| `rules/skills-*/` 하위 폴더 | hook `lib.mjs`, `agents-rules.ts`, Claude 기본 로더가 모두 재귀로 읽어서 절감이 안 됨 |
| 패키지마다 키 해석 | pi-jev, router, `router-api-key.ts`에 흩어져 있던 것을 코어 한 곳으로 모음 |
| Rust actix 코어 | 판정 지연은 zen 왕복(370–714 ms)이 지배, 서버 처리는 1 ms 미만. 오류 분류에 필요한 pi-ai (`isRetryableAssistantError`, `models.classify`)가 TS 전용 |
| 채팅 LLM 폴백 (qwen3.8-flash, LithosAI DeepSeek ultra 등) | 사용자 결정: decision model만 쓴다. 측정상으로도 qwen은 find_skill에서 7–10 s, 질문 누락, 과선택 |
| executor 인스턴스 | dev 서버용 프록시·supervisor에 묶임. `service restart` 한 번에 같이 재시작되고, 프록시가 멈추면 함께 영향받음 |

## 2. 목표와 기준선

목표는 초기 컨텍스트를 줄이고 정확한 라우팅으로 토큰당 효율을 올리는 것이다. 기준선은 이 repo의 pi 세션 capture에서 쟀다 (`/tmp/pi-easy-harness/*/capture.json`, 2026-10-18, UTF-8 바이트) 🟢.

```text
system prompt total   35,286 B
├─ skills             13,135 B   ← find_skill 대상 (카탈로그 축약)
├─ user_rules          7,521 B   ← rules-routed 이동 대상 (pc-spec·docs-archive 434 B만 남음)
├─ guidelines          5,141 B
├─ tools               4,629 B   ← find_tool 대상 (비활성 도구 설명)
├─ project_context     1,674 B
├─ docs                1,409 B
└─ 기타                 1,777 B
```

→ 정적 프롬프트에서 줄일 수 있는 상한은 약 25KB(skills + rules + tools)이고, 가장 큰 덩어리는 skill 카탈로그다.

| 지표 | 측정 방법 | 목표 |
|---|---|---|
| 초기 프롬프트 바이트 | pi capture `sections`, Claude는 hook이 주입한 바이트 | M3 이후 −40% 이상 🟡 |
| 라우팅 정확도 | 기능별 eval 세트 precision / recall | §9-1 기준 |
| 작업 완수 | 세션 감사에서 재시도, 사용자 교정, 수동 `/model` 전환 횟수 | 기준선 이하 |
| 판정 비용·지연 | decision log `latencyMs`, `costUsd` | p95 ≤ 800 ms, 프롬프트당 Jev 1회 |

## 3. 외부 구현에서 가져올 것

조사일 2026-10-18. 로컬 클론은 `~/.ref/jev-eval-agent`, 나머지는 GitHub README와 소스 트리를 확인했다.

| repo | 가져올 것 | 버릴 것 |
|---|---|---|
| [pi-jev](https://github.com/TheoOliveira/pi-jev) (설치본) | skill 적용성 noul 질문 문구 (공통 주제만으로는 불충분), 가산 도구 활성화, 실패 시 활성화하지 않음 | 단일 `JEV_THRESHOLD` 0.65, tool-guard·compact·gate (백로그) |
| [pi-jev-model-router](https://github.com/da-vinci-noob/pi-jev-model-router) (설치본) | 질문 4개 (task_kind choice, complexity score, capability score, deep_reasoning noul) → 코드가 tier를 합성, kind floor, 결정 기록 | 자체 budget, tier chain, generated json, `skipModels` 패치 |
| [jev-eval-agent](https://github.com/vinilana/jev-eval-agent) | `{user_request, actions_taken, assistant_said}` 축약 state, `done` noul 게이트, top-k와 trace JSONL, 모드 A/B eval 구조 | 도구 1개만 노출하는 방식 (아래 표) |
| [jev-decision](https://github.com/Coding-Dev-Tools/jev-decision) | **조언일 뿐 권한이 아님**, 명시적 `unavailable` 결과, 하네스 공통 예산 장부, 질문 배치, 질문별 임계값 보정, 관련 state만 전송 | Python 런타임, MCP 설치기 |
| [jev-fuse](https://github.com/0xshikhar/jev-fuse) | 데몬형 프록시, **singleflight** 중복 제거, 해시 캐시, 감사 로그 | DuckDB, 셸 AST guard |
| [SystemOneHarness](https://github.com/HarnessRouter/SystemOneHarness) | 행동 등급별 신뢰도 게이트 (read / write / destructive), 단계별 trace | 환경 루프 전체 |
| [localjev](https://github.com/imteche/localjev) | LLM 폴백 확률의 한계: logprobs가 있는 non-thinking 모델에서만 보정됨 → 폴백 결과에 `calibrated: false` 표시 | LM Studio 의존 |

jev-eval-agent의 deepseek-v4.1-flash 결과 (repo의 `eval-results/`, 커밋된 값) 🟢:

| 과제 | llm-direct 입력 토큰 | jev-classifier 입력 토큰 | completion (direct → jev) |
|---|---|---|---|
| p1-marina | 36,200 | 2,898 | 1 → **0.67** |
| p4-viagem-completa | 66,597 | 11,487 | 1 → 1 |
| p5-reuniao-time | 37,611 | 7,876 | 1 → **0.83** |
| p6-financas | 36,607 | 5,302 | 1 → **0.75** |

→ 토큰 절감은 실제로 크지만, 도구를 하나만 노출하면 완수율이 깎인다. 그래서 `find_tool`은 **핵심 도구 고정 + top-k 가산**으로 간다.

## 4. 구조

```text
 pi session ─── extensions/decision/ ───┐
 Claude Code ── plugins/decision/ ──────┤  (UserPromptSubmit, PreToolUse)
                                        ▼
          HTTP JSON  127.0.0.1:45130, timeout 1.5 s
                                        ▼
          decision.service (systemd --user)  ~/.local/share/scripts/dev/decision
          ├─ auth        pi auth.json → opencode 키 (키는 데몬 밖으로 나가지 않음)
          ├─ index       skills · rules-routed · tools · subagent roles (파일 감시로 재색인)
          ├─ questions   prompts/<feature>/vN.json   ← 버전 관리되는 질문 정의
          ├─ backends    openrouter jev-1.14 → zen jev-free → zen jev → unavailable
          ├─ cache       state 해시 + 질문 버전 → 답 (TTL), singleflight
          ├─ budget      일 단위 장부 (하네스 공통)
          └─ log         ~/.local/state/decision/log-YYMMDD.jsonl
                                  │
                                  ▼
          decision eval / decision audit   (CLI, 같은 패키지)
```

- 판단은 Jev가 하고 임계값과 조합은 코드가 한다. 데몬은 tier, 스킬 이름, 도구 이름 같은 **추천만** 돌려주고, 적용(`setModel`, 도구 활성화, 컨텍스트 주입)은 각 하네스가 한다.
- 데몬이 없거나 시간이 초과되면 클라이언트는 아무것도 바꾸지 않는다. 클라이언트가 데몬을 띄우지 않고, systemd가 수명을 관리한다.
- unit: `~/.config/systemd/user/decision.service` (`ExecStart=~/.proto/bin/bun …/decision/main.ts serve`, `Restart=on-failure`, `RestartSec=2`, `WantedBy=default.target`). 키는 unit에 넣지 않고 데몬이 `auth.json`에서 읽는다. 로그는 journal (`journalctl --user -u decision`). 설치·갱신은 `decision service install|restart|status`로 감싼다.

## 5. 코어 인터페이스

### 5-1. HTTP

| 엔드포인트 | 입력 | 출력 |
|---|---|---|
| `POST /v1/decide` | `{state, questions, feature, promptVersion?}` | `{status: ok \| unavailable, backend, answers, calibrated, latencyMs, costUsd, decisionId}` |
| `POST /v1/model_route` | `{harness, sessionId, prompt, contextTokens, currentModel}` | `{tier, thinkingLevel, kind, reason, decisionId}` |
| `POST /v1/find_skill` | `{harness, sessionId, prompt, cwd, loaded[]}` | `{skills: [{name, path, p}], rules: [{path, p}], decisionId}` |
| `POST /v1/find_tool` | `{harness, sessionId, prompt, actions[], inactive[]}` | `{activate: [{name, p}], done, decisionId}` |
| `POST /v1/orchestrate` | `{harness, sessionId, task, roles[]}` | `{plan: single \| fanout \| staged, steps: [{role, task}], decisionId}` |
| `POST /v1/outcome` | `{decisionId, signal, detail}` | `204`. 하네스가 결과 신호를 보고 (§9-2) |
| `GET /health` | — | 백엔드 상태, 키 출처, 예산 잔액, 인덱스 크기 |

### 5-2. 백엔드 체인과 auth

| 단계 | 조건 | 비고 |
|---|---|---|
| jev | 키가 있고 예산이 남음 | `https://opencode.ai/zen/v1/systemone`. pi-ai 1.3.0 `models.classify` (classifier 모델 타입). id는 `zen/v1/models`를 6시간마다 읽어 최신 버전을 고름. zen은 아직 1.14를 내놓지 않음 (`jev-1.14-free`, `jev-latest` 요청은 400) |
| unavailable | 둘 다 실패 | 클라이언트는 현재 상태 유지 |

- 키 해석은 한 곳에서 한다: `auth.ts`의 `PiAuthStore`가 pi `auth.json`을 읽기 전용으로 쓰고 (mtime이 바뀌면 다시 읽음), `opencode` 요청은 `opencode-go` 키로 해석한다.
- classifier 결과에는 구조화된 상태가 없어 오류는 모두 60초 쿨다운. 오류 원문은 진단용으로 log `skipped`에 80자까지 남기되 분기에는 쓰지 않는다 (provider-errors rule).
- 임계값은 질문별로 `prompts/<feature>/vN.json`에 둔다. 공용 상수는 두지 않는다.

## 6. 기능별 설계

### 6-1. model_route

| 항목 | 설계 |
|---|---|
| 질문 | router의 4개를 그대로 쓴다 (task_kind, complexity, capability, deep_reasoning). 한 요청으로 배치 |
| 합성 | `demand = 0.55·complexity + 0.45·capability (+ reasoning)`, kind floor (plan / review는 `high` 이상) → `quick \| standard \| high \| premium` |
| thinking | tier와 함께 thinkingLevel도 추천. pi는 모델을 바꾸지 않을 때 thinking만 적용해 캐시를 유지 |
| pi 적용 | `models.profiles.<tier>` 사다리를 기존 `candidatesWithRemaining` + grade ladder로 걷는다. contributor 세션은 통과 (`session.contributor.match`) |
| Claude 적용 | 세션 모델은 hook으로 바꿀 수 없음 → `PreToolUse(Agent)`에서 `model` 입력을 tier에 맞게 고치고, 메인 세션에는 추천을 한 줄 주입 |
| 건너뜀 | 슬래시 명령, 짧은 응답 ("ㅇㅇ", "계속"), `PI_SUBAGENT=1` |

### 6-2. find_skill + routed rules

| 항목 | 설계 |
|---|---|
| 색인 | `~/.agents/skills`, `skills/_manual` 제외, 프로젝트 `.agents/skills`, `~/.agents/rules-routed`, `{projectRoot}/.agents/rules-routed` |
| 질문 | 후보마다 noul 한 개 (pi-jev 문구: 요청한 활동이 그 스킬의 활동인가, 공통 주제만으로는 불충분). 후보가 많으면 먼저 choice 한 번으로 카테고리를 좁힘 |
| pi 주입 | `before_agent_start`에서 선택된 rule 본문을 `<user_rules>` / `<project_rules>`에 추가. 스킬은 이름, 경로, 한 줄 설명만 |
| 카탈로그 축약 | pi: 카탈로그에서 선택된 스킬 + 고정 목록만 남기고 나머지는 `find_skill` 도구로 조회 (가능 여부는 백로그에서 확인) |
| Claude 주입 | `UserPromptSubmit` → `additionalContext`에 rule 본문과 추천 스킬 이름. 세션당 같은 rule은 한 번만 (기존 `claimed` 방식) |
| 도구 | 모델이 직접 부르는 `find_skill` 도구도 같은 엔드포인트를 씀 |

### 6-3. find_tool

| 항목 | 설계 |
|---|---|
| 고정 | read, edit, write, bash, grep 계열은 항상 활성 |
| 가산 | 비활성 도구 중 p ≥ 질문별 임계값인 top-k (기본 3)를 추가. 끄지는 않음 |
| state | jev-eval-agent 형식 `{user_request, actions_taken[], assistant_said[]}`, 결과는 600자로 자름 |
| 게이트 | `done` noul로 조기 종료 판단을 보조할 뿐 응답을 막지는 않음 (조언일 뿐 권한이 아님) |
| Claude | 내장 ToolSearch가 이미 deferred 도구를 처리 → 추천 이름만 주입. 효과가 없으면 Claude 쪽은 생략 |

### 6-4. orchestrator

| 항목 | 설계 |
|---|---|
| 질문 | `plan` choice (single / fanout / staged) + 단계별 역할 choice + `worth_parallel` noul |
| 역할 집합 | pi: `shared-sub-explore`, `shared-sub-general`, `shared-sub-debug`과 family upstream에 있는 역할만 (subagent rule). Claude: 현재 세션의 Agent 타입 |
| 실행 | 데몬은 계획만 돌려줌. pi는 `subagent` 도구, Claude는 모델에게 계획을 주입 |
| 기동 | 명시적 `/orchestrate`만. 자동 분기는 eval 결과를 본 뒤 결정 |

## 7. rules 재편

### 7-1. 이동 대상

| 파일 | 이동 위치 | 이유 |
|---|---|---|
| `pc-spec.md` | **always-on** 유지 | 142 B, 모든 작업의 사실 |
| `docs-archive.md` | **always-on** 유지 | 292 B, 모든 프로젝트의 docs 경로 |
| `clarity.md` | **always-on** 유지 | 2.1KB. 사용자 결정(2026-10-18)으로 `rules/`로 되돌림 |
| `pi-print.md` | `rules-routed/` | `pi -p`를 쓸 때만 |
| `design-themes.md`, `theme-ref.md`, `frontend-consistency.md`, `svelte-effects.md`, `product-loop.md` | `rules-routed/` | 프론트엔드·제품 작업 전용 |
| 이 repo `config-jsonc.md`, `provider-errors.md`, `subagent.md` | `.agents/rules-routed/` (project) | 해당 작업에서만 필요. `description:` frontmatter, project-rule eval 5건 추가 |

### 7-2. 형식

```text
~/.agents/rules-routed/<name>.md          전역, 디시전 모델이 고름
{projectRoot}/.agents/rules-routed/<name>.md   해당 프로젝트 전용, 같은 방식
```

- 본문은 rules 형식(H1 하나, 영어, kebab-case 이름)을 그대로 쓴다. frontmatter는 `description:` 한 줄과 선택 항목 `skills: [build-frontend]`(그 스킬이 선택되면 함께 로드)만 둔다.
- `rules-optional`의 `applyTo` glob 방식은 그대로 둔다. routed는 프롬프트 의미로, applyTo는 파일 경로로 로드된다.

### 7-3. 함께 바꿀 곳

| 대상 | 변경 |
|---|---|
| `~/.agents/AGENTS.md` | 폴더 표에 `rules-routed/` 행 추가 (`~/.claude/rules`로 링크하지 않음) |
| `~/.claude/skills/agents-rules/hooks/lib.mjs`, `extensions/agents-rules.ts` | `rules/`는 그대로 읽음. routed는 decision 주입 경로로만 들어옴 |
| `learn/references/routing.md` | Scope 표에 `Routed rules` 열 추가, 대상 토큰 `rule-routed:<name>` 추가, "always-on은 정말 전역 사실만" 기준 |
| `write-a-rule` | always-on / routed / applyTo 중 고르는 기준과 `description` 작성법 |
| `~/.local/share/scripts/meta/set-rules.py` | `rules-routed` 인식 여부 확인 후 맞춤 |
| 링크 | 옮기기 전에 `find ~ -type l -lname '*.agents/rules/<name>*'`로 링크 목록 확인 |

## 8. 하네스 연결과 기존 jev 제거

### 8-1. pi (`extensions/decision/`)

- `input` (M1 구현): model_route → tier의 `models.profiles` ladder를 `selectSessionModel`로 걷고 적용. 같은 tier는 유지, 컨텍스트가 `models.route.holdDowngradeAboveTokens`를 넘으면 하향을 미룬다. contributor 세션, `PI_SUBAGENT=1`, CLI `--model`/`--provider`/`--models`는 건드리지 않는다.
- `before_agent_start` (M2): find_skill → rule과 스킬 힌트 주입.
- 도구 `find_skill`, `find_tool`, 명령 `/decision status|why|off`, `/orchestrate`.
- `agent_settled`, `tool_result`에서 `/v1/outcome` 신호를 보냄 (§9-2).
- 결정은 transcript에 LLM에 보내지 않는 항목으로 남김 (router의 decision entry 방식).

### 8-2. Claude Code (`~/.agents/plugins/decision/`)

- ref-mention과 같은 구조 (`hooks/hooks.json` + TS, `dev-mods/<uuid>/`에 사본 설치).
- `UserPromptSubmit`: find_skill, routed rules, model 추천을 `additionalContext`로 주입.
- `PreToolUse(Agent)`: tier에 따라 `model` 입력을 바꾸고, Skill 사용과 도구 호출을 outcome으로 보고.

### 8-3. 제거 목록 (M1)

| 대상 | 처리 |
|---|---|
| `settings.json` `npm:pi-jev`, `npm:pi-jev-model-router` | 삭제 후 `npm/node_modules`에서 제거 |
| `pi-jev-model-router.json`, `.generated.json`, `-state.json` | 삭제 |
| `patches/pi-jev-model-router-skip-models.patch`, `patch:jev`, `sync:jev`, `scripts/sync-jev-routes.ts` | 삭제 |
| `extensions/lib/jev-routes.ts` + test, `free-model.ts`의 sync 단계 | 삭제 |
| `extensions/router-api-key.ts`, `lib/router-api-key.ts` + test | 코어 auth로 대체 후 삭제 |
| `scripts/check.ts`의 jev 일치 검사, `check-baseline.json` | 해당 항목 제거, 남은 부채만 다시 기록 |
| `config.jsonc` 주석, `extensions/AGENTS.md`, `CONTEXT.md`, `.agents/rules/config-jsonc.md` | jev router 문장을 decision으로 교체 |

## 9. 평가와 프롬프트 개선 루프

판정 품질은 질문 프롬프트로 정해진다. 그래서 질문을 버전으로 관리하고, 오프라인 eval과 실제 세션 감사 두 가지로 판정한다.

```text
 1. prompts/<feature>/vN.json ──► decision eval ──► 기준선 비교 ──► 승격 (current 포인터)
 2. 실사용 ──► pi/Claude 세션 + decision log ──► decision audit
 3. audit의 틀린 사례 ──► 사용자 확인 ──► evals/ 케이스 추가 ──► 1번으로
```

### 9-1. 오프라인 eval (`decision eval --feature <f> --version vN`)

| 기능 | 케이스 출처 | 정답 라벨 | 지표 | 승격 기준 |
|---|---|---|---|---|
| find_skill | 과거 프롬프트 | 실제 로드된 스킬 / rule | precision, recall | recall ≥ 0.9, precision ≥ 기준선 |
| find_tool | 과거 턴의 실제 도구 호출 | 필요했던 도구 | recall, 추가 도구 수 | recall ≥ 0.95 |
| model_route | 과거 프롬프트 + 결과 | 사람이 매긴 tier | 정확, 1단계 차이 비율 | ±1 이내 ≥ 0.9 |
| orchestrator | 위임이 있었던 세션 | single / fanout / staged | 정확도 | ≥ 기준선 |
| 공통 | — | — | ECE (보정), p95 지연, 비용 | 나빠지지 않음 |

- 케이스는 `evals/<feature>.jsonl`에 `{state, expected, source: sessionId}`로 둔다. 시크릿은 secret-masking과 같은 규칙으로 가린다.
- 모든 버전 리포트를 decision `docs/eval/YYMMDD-<feature>-vN.md`에 남긴다. 버전 하나가 한 지표에서 낫고 나머지에서 같거나 나을 때만 `current`를 옮긴다.

### 9-2. 세션 감사 (`decision audit --since 7d --harness pi|claude`)

decision log와 세션 transcript(`~/.pi/agent/sessions/**`, `~/.claude/projects/**/*.jsonl`)를 `sessionId`로 이어서, 판정이 맞았는지와 효율적이었는지를 신호로 판단한다.

| 기능 | 맞음 신호 | 틀림 신호 |
|---|---|---|
| find_skill | 추천 스킬을 같은 턴에 사용 | 추천 없이 `SKILL.md`를 직접 읽음 (놓침), 추천했는데 끝까지 안 씀 (잡음) |
| routed rule | 주입한 rule이 다룬 파일 유형을 실제로 편집 | rule이 다루는 실수를 사용자가 교정 ("다음에 반복하지 마") |
| find_tool | 활성화한 도구를 호출 | 도구 없음 오류, 모델이 `find_tool`을 다시 부름 |
| model_route | 재시도 없이 완료 | 사용자의 수동 `/model` 전환, 같은 작업 재요청, premium으로 짧은 응답 |
| orchestrator | 서브에이전트 결과가 최종 답에 쓰임 | 서브에이전트 실패, 결과 미사용 |
| 효율 | 턴당 입력 토큰, 판정 비용 대비 절감 | 판정 비용이 절감보다 큼 |

- 신호를 자동으로 분류한 뒤 애매한 건 Jev noul로 한 번 더 묻는다 ("이 턴에서 추천 스킬이 필요했는가"). 이 판정도 log에 남긴다.
- 리포트는 틀린 사례를 eval 케이스 후보로 내보낸다. **사용자가 확인한 것만** `evals/`에 들어간다.
- 세션 증거 수집은 `analyze-pi-sessions`의 `collect-session-evidence.py`를 재사용할 수 있는지 먼저 본다.

## 10. 가드레일

- 판정은 조언이다. 권한 허가, 명령 승인, 완료 인증에 쓰지 않는다. permission gate는 그대로 둔다.
- 데몬 장애, 시간 초과, 예산 소진은 fail-open이다. 모델, 도구, 컨텍스트를 바꾸지 않는다.
- API 키는 데몬 밖으로 나가지 않는다. 로그와 eval에 키, 토큰, 실제 도메인을 남기지 않는다 (`dev/AGENTS.md`).
- 도구는 끄지 않고 추가만 한다. 핵심 도구는 항상 활성이다.
- 서브에이전트 역할은 upstream에 있는 것만 쓴다.
- unit은 `decision.service` 하나만 다룬다. 다른 user unit과 executor는 건드리지 않는다.
- thinking·tool-guard·compact·gate는 이번 범위가 아니다.

## 11. 구현 결과 (2026-10-18)

| 영역 | 위치 | 상태 |
|---|---|---|
| 코어 | `~/.local/share/scripts/dev/decision/` (`features/*`, `catalog.ts`, `eval.ts`, `audit.ts`, `promote.ts`) | 테스트 107개 통과, 계약은 `CONTRACTS.md` |
| pi | `extensions/decision/` (`skills.ts`, `tools.ts`, `orchestrate.ts`, `config.ts`) | 테스트 41개 통과, 설정 `workloads.decision` |
| Claude Code | `~/.agents/plugins/decision/` 0.1.1 (mod: `prompt.submit`, `tool.call`) | 테스트 33개 통과, `agents-local`로 설치 |
| rules | `~/.agents/rules` 2개 + `~/.agents/rules-routed` 7개 | always-on 7,485 B → **434 B** |

| 기능 | Jev 실측 (seed eval, 라벨은 에이전트가 작성) | 지연 |
|---|---|---|
| model_route | tier 판정 정상 (M1) | 370–714 ms |
| find_skill | 41개 중 exact 0.76 · recall 0.96 · precision 0.92 (임계값 조정 전) | p50 760 ms, p95 1 s |
| find_tool | recall 0.94 · precision 0.95 · 잘못 켠 도구 0 | 약 390 ms |
| orchestrator | plan 0.92 · roleRecall 0.90 · rolePrecision 0.72 | 약 330 ms |

```text
pi system prompt (같은 프롬프트, stub 데몬)
  데몬 없음            25,704 B   skills 12,066 B
  rule 1개 주입         27,085 B   user_rules 476 → 1,857 B
  + trimCatalog         16,033 B   skills 925 B   (−41%)
```


OpenRouter Jev 1.14 smoke (2026-10-18, 데몬 경유) 🟢:

| 기능 | 입력 | 결과 | 지연 |
|---|---|---|---|
| model_route | API gateway 캐시 설계 | plan → **premium** | 576 ms |
| model_route | README 오타 수정 | write → **quick** | 371 ms |
| find_skill | svelte `$effect` 리셋 | rule `svelte-effects` 0.55 | 749 ms |
| find_skill | 프랑스 수도 | 없음 (none 1.00) | 398 ms |
| find_tool | Svelte 최신 변경사항 | `web_search` 0.93 | 378 ms |
| orchestrator | 세 모듈 에러 처리 비교 | fanout, explore 0.90 → general 0.73 | 365 ms |
| pi `-p` | svelte `$effect` 질문 | route quick, rule 주입, 답이 rule 내용과 일치 | — |
| eval | model_route 3건 | within1 1.0, p95 394 ms, $0.00012 | — |

기준선 eval (OpenRouter Jev 1.14, 전체 케이스):

| 기능 | 결과 | 판정 |
|---|---|---|
| model_route (38) | exact 0.842 · within1 1.0 · p95 576 ms | v1 유지 |
| find_skill (47) | v2 recall 0.956 · precision 0.943 (v1 0.934–0.950) | **v2 승격** (`skillThreshold` 0.6 → 0.5, 3회 중 2회 HOLDS, 1회는 p95 노이즈) |
| find_tool (26) | recall 0.904 · precision 0.917 | v1 유지 — v2(families) precision 0.81, v3(noneCeiling) recall 0.865–0.885로 기각 |
| orchestrator (24) | plan 0.917 · roleRecall 0.938 · rolePrecision 0.757 | v1 유지 |

세션 개선: find_tool을 입력 시점에 prefetch → 사용자 메시지 전 decision 지연 1.34 s → **0.59 s**.

```text
pi merged prompt (easy-harness capture, 같은 pong 프롬프트)
  기준선 (decision 전)          35,286 B
  rule 이동 후                  29,838 B
  AGENTS.md Clarity 사본 제거    29,149 B   project_context 1,674 → 898
  + trimCatalog (pong)          16,497 B   skills 14,389 → 1,737   (−53%)
  + trimCatalog (write-doc 질의) 16,929 B   skills 2,169 (write-doc 주입)
```

- trimCatalog 안전장치: 데몬이 답하지 못한 턴(`unavailable`)은 전체 카탈로그, 데몬이 색인하지 않는 패키지·`_manual` 스킬은 항상 유지.
- trim은 find_skill recall 누락을 비싸게 만든다: v1에서 "docs/plan 계획 문서" 질의가 write-doc p 0.55로 임계값 아래 → 카탈로그에서 숨겨져 모델이 "적용할 skill 없음". v2 승격 뒤 같은 질의에서 write-doc 주입·응답 확인.
- 남은 선로드: guidelines 4,760 · tools 4,035 · user_rules 2,674 (clarity, always-on 결정) · docs 1,409 (pi 내장) · harness 775.
- Claude Code Bash에서 `pi -p`는 stdin이 닫히지 않는 socket이라 간헐적으로 멈춘다 → 항상 `< /dev/null`.

→ Jev 무료 한도는 작다. 이번 세션에서 데몬 log 기준 성공 호출 282회 뒤 소진됐고 (subagent eval의 in-process 호출은 별도 log 없이 추가로 있었음) (429, 약 21시간 뒤 재시도), 유료 SKU는 Zen 잔액이 없어 402. 그동안 모든 하네스는 fail-open으로 아무것도 바꾸지 않았다. OpenCode Go 구독 경로(`/zen/go/v1/systemone`)는 Jev를 제공하지 않는다 ("Model is unavailable").

## Backlog

### 검증할 가정

- 🟡 **pi에서 skill 카탈로그를 hook으로 줄일 수 있다.** 확인: `before_agent_start`에서 `systemPromptOptions.skills`를 거르는 시험 확장을 만들고 capture `sections.skills`가 줄어드는지 본다.
- 🟡 **Claude Code `PreToolUse`가 Agent 도구의 `model`을 `updatedInput`으로 바꿀 수 있다.** 확인: 테스트 hook으로 `model: "haiku"`를 강제하고 서브에이전트 transcript의 모델 id를 본다.
- 🟡 **opencode zen `systemone`이 프롬프트당 배치 질문 6개 이내에서 p95 ≤ 800 ms를 낸다.** 2026-10-18 질문 4개로 370–714 ms (표본 10여 회). 확인: `decision bench` 100회 → log의 `latencyMs` 분포.
- 🟡 **jev-free가 한도(429)에 걸려도 유료 jev-1.13 + 60초 쿨다운으로 충분하다.** 2026-10-18 수동 probe에서 429 한 번. 확인: `decision audit`에서 backend별 비율을 본다.

- 🟡 **find_skill v2 (`skillThreshold` 0.5)가 trim 상태에서 실사용 누락을 막는다.** 확인: `decision audit --since 7d`에서 `find_skill` 도구 호출이나 "skill 없음" 응답 뒤 사용자가 스킬을 직접 부른 세션을 찾는다.
- 🟡 **orchestrator `rolePass` 0.5는 역할을 과하게 고른다 (precision 0.72).** 확인: `prompts/orchestrator/v2.json`에 0.7 → `decision eval --feature orchestrator --version v2 --against v1 --all`.
- 🟡 **easy-harness의 `applyTools`가 find_tool이 켠 도구를 다음 턴에 지우지 않는다.** 확인: 비기본 harness에서 `pi -p` 두 턴 → active tools 비교.
- 🟡 **Claude `session.compact` 뒤 rule 재주입이 동작한다.** 확인: 실제 `/compact` 뒤 다음 프롬프트 transcript에 `<routed_rule>` 재등장.
- 🟡 **seed eval 라벨이 사용자 판단과 맞다.** 확인: `evals/*.jsonl`을 사용자가 검토. 확인 전 eval 수치는 참고값.

### 열린 질문

- `trimCatalog`는 켰다(unavailable 턴은 전체 카탈로그). recall 누락이 audit에서 보이면 `keepSkills` 기본값(write-doc 등 핵심 스킬)을 둘지 정한다.
- staged 계획의 단계 순서: orchestrator는 확률 순으로 역할을 주므로 단계 순서(조사 → 수정)는 하네스가 정한다.

- find_tool을 Claude Code에도 둘지는 M3 eval 뒤에 정한다.
- orchestrator 자동 분기(`auto-agents`)는 M4 eval 뒤에 정한다.

### 다음

- `decision audit --since 7d` (일주일 사용 뒤).
- audit 후보(`candidates/*.jsonl`)를 사용자가 확인한 것만 `evals/`로 옮기고 v2 프롬프트를 시험.
- `bun run check`의 남은 실패 5건은 이번 작업 전부터 있던 format 부채 (`model-picker`, `opencode-go-limits`, `model-scores`). baseline 갱신으로 덮지 않는다.

## Changelog

- 2026-10-18: 문서를 decision 폴더로 이전, `.product` 추가. docs-archive routed, 18개 프로젝트·공유 템플릿 routed 이동, `paths:` 하이브리드(find_skill v3 승격), 캐시 안전 전달(턴 메시지·tool 결과, 카탈로그 첫 턴 고정, find_tool 30k 보류), `cache-report.ts` 기준선.
- 2026-10-18: 기준선 eval, find_skill v2 승격, find_tool v2/v3 기각, prefetch, trimCatalog 켬, clarity always-on 복귀, project rule 3개 routed 이동, capture 비교 추가.
- 2026-10-18: 기본 백엔드를 OpenRouter Jev 1.14로 전환, smoke 결과 추가.
- 2026-10-18: M2–M4·상시 구현 결과(§11), LLM 폴백 제거(사용자 결정), Jev 한도 소진 기록.
- 2026-10-18: M1 구현 사실 반영 — Bun 유지 이유, pi-ai classifier, qwen3.8-flash 폴백, 최신 Jev 자동 선택, CLI `--model` 유지.

## Sources

- 설치본: `npm/node_modules/pi-jev` (0.7.0), `npm/node_modules/pi-jev-model-router` (0.8.0), 이 repo의 `pi-jev-model-router.json`
- [vinilana/jev-eval-agent](https://github.com/vinilana/jev-eval-agent) — `~/.ref/jev-eval-agent/eval-results/`
- [Coding-Dev-Tools/jev-decision](https://github.com/Coding-Dev-Tools/jev-decision)
- [0xshikhar/jev-fuse](https://github.com/0xshikhar/jev-fuse)
- [HarnessRouter/SystemOneHarness](https://github.com/HarnessRouter/SystemOneHarness)
- [imteche/localjev](https://github.com/imteche/localjev)
- [kraayenjon/awesome-jev](https://github.com/kraayenjon/awesome-jev) — 가격, 한도, 엔드포인트
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
- 기준선: `/tmp/pi-easy-harness/*/capture.json` (2026-10-18)
