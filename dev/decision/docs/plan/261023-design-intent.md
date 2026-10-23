# decision 설계 의도 정렬

## Intent

- **Problem**: 세션 edc7666d 에서 "dashboard chat 창 입력 시 에러" 지시에 find_skill 이 bun-webview 를 띄우지 못했다. 에이전트는 재현하는 대신 질문했고, 그 답변은 라우팅되지 않았다. 그 뒤 고친 것들(스킬 description 에 라우팅 문구 추가, v6 기준 eval)은 설계 의도와 맞는지 따져 보지 않은 채 적용됐다.
- **Outcome**: decision 이 AGENTS.md 의 설계 의도대로 움직인다.
  - 사람이 쓴 문장은 모두 라우팅된다.
  - 후보는 3초 안에 모두 판정된다.
  - 라우팅 지식은 라우터 프롬프트와 eval 에 있다.
  - 장애 시에는 코드 폴백 힌트를 준다.
  - 데몬에는 전역 기능만 남고, dispatch 는 dashboard 로 옮긴다.
- **Affected**: `~/.local/share/scripts/dev/decision` (find_skill, 프롬프트, eval, CONTRACTS.md), Claude 플러그인 `~/.agents/plugins/decision/hooks/`, pi 확장 `~/.pi/agent/extensions/decision/`, `~/.agents/skills-routed` 의 description 3개, dashboard `apps/server/src/workflow/dispatch.rs`.
- **Constraints**:
  - 판단 기준은 품질이다. 토큰 상한은 두지 않는다.
  - find_skill 의 턴 시작 지연은 약 3초까지만 허용한다.
  - 확신하면 본문을 주입하고, 에이전트를 차단하지는 않는다.
  - 커밋과 프롬프트 승격(`~/.config/decision/config.json`)은 사용자가 승인한다.
- **Out of scope**: model_route, guard, loop 의 규칙 변경. find_tool 동작 변경.
- **Open questions**: 없음.
- **Confirmed** (261023, 소크라틱 3라운드):
  - 목적 = 행동 품질
  - 놓침이 과잉보다 나쁨
  - 확신 시 본문 주입
  - 사용자 글 전부 라우팅
  - 품질 무조건, 지연 ~3초
  - 라우팅 지식은 라우터 쪽
  - 검증 = eval + 세션 재생
  - 코어 = find_skill, model_route, guard + loop, find_tool
  - dispatch 는 dashboard 로 이전
  - 장애 시 코드 폴백

## 현재 상태 (261023 확인)

- 라이브 find_skill 은 **v4** 다(`~/.config/decision/config.json`). 오늘 eval 과 description 튜닝은 v6 으로 했다.
- **두 번째 스킬을 놓치는 구조.** 후보가 12개(`directBelow`)를 넘으면 1단계에서 "single candidate" choice 질문 하나로 좁힌다(`features/find-skill.ts:132,339`).
  - 남는 후보는 p ≥ 0.03 인 상위 6개뿐이다(`find-skill.ts:182-195`). 확률이 한 후보에 몰리므로 두 번째 스킬이 탈락한다(로그: `asked 2 of 56`).
  - Jev 호출은 최대 2회이고 직렬이다. 프롬프트당 1.0–1.5초, 최대 2.9초다(`docs/audit/261023-audit.md:11-15`).
- **장애 시 동작.** `paths:` 글롭만 동작하고(`find-skill.ts:306-311,343-366`), 그 밖에는 `unavailable` 이라 아무것도 주입되지 않는다.
- **주입 상한.** `injectMax` 1, `injectThreshold` 0.85, `maxSkills` 3 (`prompts/find_skill/v6.json:44-46`).
- **라우팅 공백.**
  - pi 의 steer/followUp 은 model_route 만 받는다. find_skill 이 다시 돌지 않는다(`index.ts:877,889`).
  - Claude 의 plan/권한 거절 피드백은 `auto-continuation` 으로 분류돼 제외된다(`hooks/decision.ts:427`).
- **dispatch.** dashboard 만 쓴다(`apps/server/src/workflow/dispatch.rs:299`). 데몬에는 범용 `POST /v1/decide` 가 이미 있다(`server.ts:76-95`).

## Phases

| # | 작업 | 확인 | 멈춤 조건 |
|---|---|---|---|
| 1 | find_skill v7: 1단계 single-choice 를 없애고 모든 후보를 한 번의 넓은 bool 호출로 판정한다. 라우팅 일반 규칙(붙여 넣은 페이로드 ≠ 요청, 실행 중 앱 오류 → 재현)을 criteria 에 넣는다. `injectMax` 2 | `decision eval --feature find_skill --version v7 --all`: recall ≥ v6, case 62 exact, 프롬프트당 p95 ≤ 3초 | 지연이 3초를 넘으면 병렬 분할(후보 n개씩 동시 호출)로 바꾼다 |
| 2 | build-frontend, bun-webview, shadcn-svelte description 에서 라우팅 문구를 빼고 기능만 남긴다 | v7 eval 무회귀 | 회귀가 나면 해당 판단을 v7 criteria 로 옮긴다 |
| 3 | 코드 폴백: Jev 가 unavailable 이면 키워드 매칭 상위 후보를 힌트로만 준다(본문 없음) | 단위 테스트(백엔드 없음), CONTRACTS.md 갱신 | — |
| 4 | 라우팅 공백: pi steer/followUp 에 find_skill, Claude auto-continuation 피드백 문장 | pi `bun test`, `claude plugin test` | 하네스가 텍스트를 노출하지 않으면 CONTRACTS.md 에 한계로 적는다 |
| 5 | dispatch 를 dashboard 로 이전: Rust 포트가 `/v1/decide` 를 호출하고, 데몬에서는 제거한다. eval 케이스는 cargo 테스트로 옮긴다 | dashboard `cargo test`, 데몬 `bun test` | — |
| 6 | v7 승격(사용자 승인) 후 원 지시를 `claude -p --model sonnet` 으로 재생한다 | 첫 턴에 bun-webview + shadcn-svelte, 질문 없음 | — |

## 가정

| 가정 | 확인 방법 |
|---|---|
| 후보 ~60개를 bool 로 한 번에 물어도 3초 안에 온다 | phase 1 eval 의 latency p95 |
| 1단계를 없애도 precision 이 크게 떨어지지 않는다 | v7 eval precision 을 v6 과 비교 |

## Changelog

- 261023: 작성. 소크라틱 3라운드 결과를 AGENTS.md "Design intent" 에 반영했다.
- 261023: phase 1–5 적용, phase 6 은 승격 승인을 기다린다.
  - **phase 1–2.** v7 은 단일 bool 호출로 모든 후보를 판정한다. 일반 규칙은 apply criteria 에 넣었고, 세 스킬의 description 에서 라우팅 문구를 뺐다.
    - 63케이스 결과: recall 0.873 (v6 0.858), precision 0.780 (0.849), exact 0.587 (0.714), p50 425 ms (746), 비용 3배.
    - 원 지시 케이스: v7 은 bun-webview + shadcn-svelte(+build-frontend) 를 잡고, 라우팅 문구가 빠진 v6 은 bun-webview 를 놓친다.
    - "필요한 한 단계도 true" 문구는 precision 0.70 까지 떨어뜨려 버렸다.
  - **phase 3.** 키워드 폴백. 결과에 `fallback: true` 를 달고 본문 없는 힌트로만 준다. 한계: 한↔영 동의어는 매칭하지 않는다.
  - **phase 4.** pi 의 steer/followUp 은 `queued.ts`, Claude 의 auto-continuation 피드백(isMeta 제외)은 find_skill 전용으로 라우팅한다.
  - **phase 5.** dispatch 를 dashboard `workflow/dispatch/jev.rs` 로 옮겼다. `/v1/decide` 를 쓰고, 데몬 쪽은 `archive/dispatch/` 로 보냈다.
  - **배포 순서.** dashboard `executor reload` 를 먼저 하고 그다음 `decision.service` 를 재시작해야 한다. 순서가 바뀌면 옛 dashboard 가 사라진 `/v1/dispatch` 를 불러 폴백으로 떨어진다.
  - **phase 6 (사용자 승인).**
    - `executor reload dashboard` 를 먼저 하고, find_skill v4 → v7 을 승격했다(recall floor 0.9 미달 경고는 사용자가 승인). 그다음 `decision service restart` 를 했다.
    - 라이브 확인: 원 지시에 bun-webview, shadcn-svelte, build-frontend 가 잡혔고, `/v1/dispatch` 는 404 를 돌려준다.
  - **루프 후속 (사용자 지시 1–4).**
    - **shadcn-svelte.** write-a-skill 기준으로 메인 gate 5단계를 두고 references 로 분리했다(SKILL.md 16,985 → 5,137자). 이제 본문 주입 상한(12,000) 안이다.
    - **v7 약점.**
      - svelte-effects 과잉은 프롬프트 탓이 아니었다. 규칙 frontmatter 의 `skills: [build-frontend]` 연결이 원인이었다(p 0.05 인데도 build-frontend 와 함께 선택됨). 연결을 끊었다.
      - #0 의 build-frontend 누락은 오전에 좁힌 description("asked to be built or restyled") 탓이었다. "Build, change or fix…" 로 넓혔다.
      - 버린 시도:
        - 규칙 전용 apply 질문(applyRule): 기존 recall −0.011.
        - 증상 일반화 문구: 세 세트 recall −0.016/−0.021/−0.031.
      - #0(`$effect가 리셋돼`, svelte-effects 0.40↔0.64)은 알려진 약점으로 남긴다.
    - **재현 우선.** 격리 샌드박스(Vite+Svelte, 심어 둔 JSON.parse 버그)에서 sonnet 으로 3회 돌렸다(`--add-dir ~/.agents`, Bash 허용).
      - 3회 모두 bun-webview SKILL.md → `browser open` → wv.ts 로 재현 → 수정 → 재검증 순으로 진행했고, 질문은 0회였다.
      - 첫 시도는 `acceptEdits` 의 디렉터리 밖 Read 거부로 막혔다.
    - **find_tool v6.** 원인은 gate(`needs_extra_tool`)가 확신 있는 선택(p 0.48–0.60)을 "grep 으로도 된다"며 거부하는 것이었다. v6 = v1 + `gateOverride 0.4`.
      - 기존 eval recall 3회: 0.904/0.942/0.904 (v1 0.923/0.865/0.904).
      - train: 0.792 (0.708).
      - holdout: precision 1.000 (0.875).
      - 사용자 승인으로 승격했고 데몬을 재시작했다(라이브: find_skill v7, find_tool v6). 승격 도구의 recall 하한 0.95 미달 경고(0.938)는 승인했다.
  - **후속.** 합성 시나리오 루프([261023-synthetic-routing-loop](261023-synthetic-routing-loop.md))를 sonnet 오케스트레이터로 새 터미널에서 시작했다.
