# Rule 라우팅 · 캐시 안전 · 경로 트리거 인계

## 결론

| 항목 | 상태 |
|---|---|
| 6개 작업 | **모두 구현·검증 완료** |
| 커밋 | **안 함** (네 저장소 모두 작업 트리에만 있음) |
| find_skill | **v3 승격** (`~/.config/decision/config.json`, daemon 재시작함) |
| 항상 로드 rule | `pc-spec`, `clarity` 두 개만 |
| 캐시 | 대화 중 system prompt 불변 확인 (3턴 실측) |
| 다음 행동 | 아래 "다음 작업" 표 1번부터 |

다음 작업:

| # | 할 일 | 근거 |
|---|---|---|
| 1 | 사용자 확인 후 저장소별 커밋 | 커밋은 요청 시에만 |
| 2 | `holdDowngradeAboveTokens`를 가격 기준으로 변경 | Grok→DeepSeek 하향은 0.3요청 안에 본전 (§4) |
| 3 | 인터랙티브 pi에서 `web_enable` 캐시 깨짐 재현 | 3턴 실측 turn 2 원인 |
| 4 | Claude Code가 `paths:` rule을 실제로 지연 로드하는지 확인 | 미검증 |
| 5 | sns-publisher, ebook-scroller 깨진 `skill.md` symlink 정리 | fork A 미처리 |
| 6 | dashboard에 `stack-svelte-rust` 연결 추가 | `stack-svelte-tauri`가 전제 |
| 7 | 매주 `bun cache-report.ts` 로 적중률·손실 확인 | 목표 적중 96%+, 손실 5%- |

## 1. 작업별 결과

| # | 요청 | 결과 |
|---|---|---|
| 1 | docs-archive를 routed로 | `~/.agents/rules-routed/docs-archive.md`, `skills: [write-doc]`, `paths: ["docs/**"]` |
| 2 | learn, write-a-rule 등 역할 정리 | write-a-rule, rule-vs-skill, learn routing, write-a-skill, `~/.agents/AGENTS.md`, pi 문서 |
| 3 | 프로젝트 rule 분류 + 공유 템플릿 | 16개 프로젝트, 약 85 KB 상시 로드 제거, dashboard 템플릿 수정 |
| 4 | decision `.product` | LOOP.md + intent 8개, decision-model 계획서 이동 |
| 5 | 캐시 비용식 + 코드 수정 | 문서, `cache-report.ts`, 턴 메시지 전달, 카탈로그 고정 |
| 6 | 경로 트리거 하이브리드 | 스크립트 우선 + Jev, eval 3회 통과, v3 승격 |

## 2. 경로 트리거 동작

```text
prompt / touch
   |
   v
paths 글롭 매칭 (script, 약 3 ms)
   |-- rule 매칭  -> 바로 선택 (p=1, "rule X via path Y")
   |-- skill 매칭 -> Jev bool 질문에 반드시 추가
   |
   v
Jev (나머지 후보)       touch 전용(빈 prompt + paths)은 Jev 생략
```

- 코드: daemon `features/path-trigger.ts`, `features/find-skill.ts` (`limits.scriptFirst`), `prompts/find_skill/v3.json`.
- slash command 판정은 `/word` 단독만: `/design/draft …`는 경로로 본다 (`features/model-route.ts`).
- eval 59건 3회: recall 0.961–0.965 (v2 0.939–0.948), precision 동일. 보고서 `docs/eval/261018-find_skill-v3-vs-v2.md`.

## 3. 캐시 안전 전달

| 경로 | 바뀐 점 |
|---|---|
| pi `before_agent_start` | rule·skill 힌트는 `decision-skill-hint` 턴 메시지로 |
| pi `tool_result` | read/edit/write 경로로 find_skill 호출, rule을 결과 끝에 붙임 |
| pi 카탈로그 | 첫 사용자 턴에 trim 고정 (`catalogFreeze`) |
| pi `session_compact` | rule 재전달 (`redeliver`) |
| pi find_tool | 컨텍스트 30k 초과 시 자동 추가 보류 (`findTool.holdAboveTokens`) |
| Claude 플러그인 | Read/Edit/Write 훅이 `paths`로 touch 컨텍스트 전달 |

- 예외: 옛 `inject:true` rule은 여전히 system prompt에 렌더된다.
- 실측: turn 2·3 system prompt 바이트 동일, turn 3 $0.00020 (cacheRead 24,320). turn 2 $0.00343 깨짐은 pi-web-access `web_enable` 등장 탓.

## 4. 비용식 요점

```text
요청 비용   c  = (U*p_in + R*p_cr + W*p_cw + O*p_out) / 1e6
깨짐 비용      = N * (p_in - p_cr)
본전 요청 수 k* = (N / dS) * (1/r - 1)      r = p_cr / p_in
```

| 모델 | r | 의미 |
|---|---|---|
| DeepSeek V4.1 Flash | 0.02 | 깨지면 그 길이만큼 50배 |
| Grok | 0.25 | 깨짐 손해가 상대적으로 작음 |

- system prompt 변경은 세션 첫 턴과 compaction 직후만 허용.
- DeepSeek 피크(평일 KST 10–13, 15–19시)는 단가 2배: eval 등 대량 작업은 그 밖에.
- 7일 기준선: 90세션, 적중 96.3%, $196.7, 깨짐 167회 손실 $18.8 (9.6%), 모델 전환 7회 약 $1.22.

## 5. 손댄 파일

| 저장소 / 위치 | 주요 파일 |
|---|---|
| decision daemon (`~/.local/share/scripts/dev/decision/`, 미추적) | `catalog.ts`, `features/path-trigger.ts`, `features/find-skill.ts`, `features/model-route.ts`, `cache-report.ts`, `prompts/find_skill/v3.json`, `evals/find_skill.jsonl`, `.product/`, `docs/` |
| pi (`~/.pi/agent/`) | `extensions/decision/{index,skills,client,config}.ts` + 테스트, `config.jsonc`, `extensions/AGENTS.md`, `docs/agent-rules.md`, `.agents/rules-routed/` |
| Claude 플러그인 (`~/.agents/plugins/decision/hooks/`) | `decision.ts`, `register.ts`, `register.test.ts` |
| 공유 (`~/.agents/`) | `rules-routed/`, `rules-optional/` description, `skills/write-a-rule`, `skills/write-a-skill`, `skills/_manual/learn`, `skills/write-doc`, `AGENTS.md` |
| 프로젝트 16개 | symlink를 `.agents/rules-routed/`로 이동, 로컬 rule 일부 routed |
| dashboard | `template.rs` `rule_link_dir()`, `catalog.rs` 경로, `tests.rs`, `product-loop` → `product-loop-dashboard` |

- `~/.pi/agent`, `~/.agents` 작업 트리에는 이번 세션 이전 변경도 섞여 있다: 커밋 전에 나눠 볼 것.

## 6. 검증 명령

| 대상 | 명령 | 결과 |
|---|---|---|
| daemon | `bun test` (decision 폴더) | 118 pass |
| pi decision | `bun test extensions/decision` | 45 pass |
| Claude 플러그인 | `claude plugin test .` | 34 pass |
| dashboard | `cargo test -p dashboard --lib projects::` | 92/92 |
| pi gate | `bun run check` | 기존 포맷 5건만 실패 (baseline 미변경) |
| 문서 | `check-doc.ts` | 문서 4개 `doc ok` |

## Backlog

| 미검증 / 열린 질문 | 확인 방법 |
|---|---|
| Claude Code가 `paths:` rule을 매칭 파일 접근 때만 로드하는지 | 새 세션에서 `/context`로 rule 목록 비교 후 `docs/` 파일 Read |
| `web_enable` 깨짐이 인터랙티브 세션에서도 생기는지 | 인터랙티브 pi 3턴 후 `bun cache-report.ts` |
| 가격 기준 하향 보류 규칙의 임계값 | `docs/plan/261018-cache-cost.md` 식으로 모델 쌍별 k* 계산 |
| 플러그인 파일 포맷 | 공유 Prettier와 스타일이 달라 그대로 둠: 별도 결정 필요 |
| `paths` 글롭이 넓어져 오탐이 생기는지 | eval에 경로 오탐 케이스 추가 후 precision 확인 |

관련 문서:

- `docs/plan/261018-cache-cost.md`
- `docs/plan/261018-path-trigger-hybrid.md`
- `docs/plan/261018-decision-model.md`
- `docs/rules/261018-project-rules-routing.md`
- `docs/eval/261018-find_skill-v3-vs-v2.md`
