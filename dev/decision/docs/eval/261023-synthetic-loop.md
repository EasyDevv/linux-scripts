# 합성 시나리오 라우팅 루프 보고

계획: [261023-synthetic-routing-loop.md](../plan/261023-synthetic-routing-loop.md). 설계 의도: [AGENTS.md](../../AGENTS.md) "Design intent".

## 결론

- **채택한 변경: 없음.** 2회 개선 반복(find_skill 후보 4개, find_tool 후보 4개) 모두 채택 조건을 못 맞췄거나, 맞췄어도 겨냥한 실패가 줄지 않았다. 계획의 멈춤 조건(개선 2회 후에도 holdout 이 나아지지 않음)에 따라 멈췄다.
- **승격 권고: 이 루프에서 승격할 프롬프트는 없다.** `prompts/` 에는 새 파일이 남지 않았다(v8 은 비어 있다). 라이브 설정, 서비스, 커밋은 건드리지 않았다.
- 실제 세션에서 확인된 문제는 프롬프트가 아니라 **주입 상한 설정**(아래 "세션에서 나온 다른 발견")과 **v7 자체의 기준 미달**이다. 둘 다 사용자 결정 사항으로 넘긴다.

## 시나리오 분포

`evals/synthetic/` (라벨 = 그 작업에 실제로 필요한 것, 애매한 라벨엔 `note`). 축은 서로 겹친다.

| 대상 | 전체 | train / holdout | ko | en | mixed | followup | payload | 둘 필요 | 불필요(none) | app-error | project-path | trap | mid-task |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| find_skill | 40 | 24 / 16 | 21/11 | 2/2 | 1/3 | 2/2 | 1/2 | 2/2 | 4/4 | 3/1 | 3/4 | 4/4 | – |
| find_tool | 20 | 12 / 8 | 4/2 | 5/3 | 3/3 | 1/2 | 2/2 | 3/1 | 4/2 | – | – | 2/2 | 2/2 |

(각 칸은 train/holdout.) 한계: find_skill 은 한국어 쪽으로 치우쳤고(train 24 중 21), 모든 케이스의 cwd 가 같아 프로젝트별 카탈로그는 시험하지 못했다. 분할은 축별 층화 후 고정 라벨로 결정적이다. find_tool 의 모호한 라벨: #14 타입 에러 붙여넣기(none vs lsp_diagnostics), #20 followup(deep_research vs fetch_content), #15 링크 확인(fetch_content vs browser_navigate), #4 mid-task(lsp_references).

## 오프라인 기준선 (train)

| 대상 | recall | exact | precision | p95 ms | 놓친 케이스 |
|---|---|---|---|---|---|
| find_skill v7 | .979 | .458 | .682 | 651 | #19 (history 있는 후속 답변: browser, improve-ux 만 반환) |
| find_tool v1 (라이브) | .708 | .583 | 1.000 | 657 | web_search(#1), lsp_references(#2, #10), subagent(#6), LSP(#9) |
| find_tool v3 | .708 | .583 | 1.000 | 391 | v1 과 같은 5건 |

find_skill 의 과잉 주입은 recall 이 높은 대신 흔하다(`svelte-effects` 5건 이상, `browser` 4건, 형제 스킬 3건). find_tool 은 `needs_extra_tool` 이 0.06–0.11 로 나와 gate 0.12 에 막혀 none 이 된 케이스가 12건 중 5건이다.

## 실제 세션 (train 12개, Claude sonnet, 그림자 데몬 45131)

조건: 일회용 복사본에서 `claude -p --model sonnet --max-turns 6`, 허용 Read/Grep/Glob/Skill, Bash·Edit·Write 는 거부(시도는 트랜스크립트에 남는다). 후속 시나리오(#18, #19)는 실제 2턴. 공유 상태를 건드리려는 시도는 없었고, 첫 시나리오에서 그림자 로그에만 find_skill 항목이 생기고 라이브 로그에는 0건임을 확인했다. 주입 = 본문 포함, 힌트 = 이름·경로만.

| # | 주입(본문) | 힌트(p) | 실제로 읽거나 쓴 것 | 놓침(필요했는데 없음) | 불필요했던 것 | 질문함 | 라벨 |
|---|---|---|---|---|---|---|---|
| 0 | build-frontend, svelte-effects, frontend-consistency | bun-webview .67, shadcn-svelte .65 | svelte-effects 로 원인 진단 | 없음 | frontend-consistency | 예 | 유지 |
| 1 | frontend-consistency, svelte-effects | shadcn-svelte .96, build-frontend .78 | shadcn-svelte SKILL.md | 없음(본문은 길이 상한 때문에 힌트) | 규칙 2개 | 예 | 유지 |
| 4 | svelte-effects | shadcn-svelte .89, bun-webview .61 | shadcn-svelte SKILL.md | bun-webview 는 힌트만, Bash 거부로 재현 못 함 | svelte-effects | 예 | 유지 |
| 6 | 없음 | bun-webview .89, browser .76 | 둘 다 읽음 | 없음 | 없음 | 예(Bash 거부) | 유지 |
| 8 | svelte-effects | bun-webview .95, browser .78, orca-cli .67 | bun-webview SKILL.md | 없음 | svelte-effects, orca-cli | 예 | 유지 |
| 9 | browser(.98) | – | browser 본문 | 없음 | 없음 | 예 | 유지 |
| 12 | analyze-pi-sessions, analyze-claude-sessions | improve-decision-workflow .82 | analyze-pi-sessions 참조 | 없음 | analyze-claude-sessions, improve-decision-workflow | 아니오(max-turns 2회) | 유지 |
| 15 | write-plan(.97) | – | write-plan 참조 | 없음 | 없음 | 예(바뀐 결정 미제공) | 유지 |
| 18 | 없음 | write-a-rule .64 | write-a-rule SKILL.md(2턴) | 본문 없음, 힌트가 통함 | write-a-skill | 예 | 유지 |
| 19 | build-frontend, improve-ux, 규칙 2개 | shadcn-svelte .60 | 읽은 것 없음 | 캡처는 Bash 거부로 불가 | improve-ux, svelte-effects | 예 | 유지 |
| 20 | 없음 | – | – | – | – | 아니오 | 정답(none) |
| 22 | 없음 | – | – | – | – | 아니오 | 정답(none) |

판정:

- **놓침**: 에이전트가 필요했는데 못 받은 경우는 실제로 없었다. 힌트만 받은 스킬도 에이전트가 직접 읽었다(#1, #4, #6, #8, #18). 단 #4 의 bun-webview 는 Bash 거부 환경 탓에 재현까지 가지 못해 검증되지 않았다.
- **과잉 주입**: `svelte-effects` 가 $effect 와 무관한 프론트 작업 4개 세션(#1, #4, #8, #19)에 들어갔고, 형제 스킬이 따라온 경우가 #12, #18 이다. 무해하지만 매번 본문이 붙는다.
- **질문**: 대부분이 질문으로 끝났다. Bash 를 막은 환경 때문이지 라우터 문제로 보지 않는다. 그래서 "재현 먼저" 규칙은 이 세션들로는 검증되지 않았다(후속: 격리된 Bash 허용 샌드박스).
- **라벨 수정**: 없음. 다만 **규칙 라벨 정책이 시드와 합성이 다르다.** 시드는 Svelte 화면 작업이면 `svelte-effects` 와 `frontend-consistency` 를 둘 다 기대하고, 합성 라벨은 $effect 가 걸린 경우만 기대한다. 어느 쪽이 맞는지는 사용자 결정이라 라벨을 바꾸지 않았다.
- `decision audit` 은 위 표와 대체로 일치했다. 다만 힌트만 받고 읽은 경우를 "추천 없이 읽음"으로 센다.

## 개선 시도와 판정

반복 실패 기준(서로 다른 시나리오 2개 이상)을 넘긴 패턴만 시도했다. holdout 은 개선 문구를 정하는 데 쓰지 않았다. 다만 1차 검증에서 holdout 집계와 회귀 목록을 봤으므로, 2차 후보의 문구는 train·기존 eval 회귀만으로 정했다.

표기는 후보/기준. 기준선 값 자체가 실행마다 조금 달라(v7 기존 eval recall .873/.878, find_tool v1 기존 eval .923/.885) **케이스 1건 차이는 잡음**으로 본다.

| 반복 | 후보 | 변경 | holdout recall | 기존 eval recall | 판정 |
|---|---|---|---|---|---|
| 1 | find_skill v8 | 형제 객체 문장 + "수정 대상으로 이름만 나온 것은 활동이 아님" | .969/.969 | **.869/.873** (#61 회귀) | 버림: 기존 eval 회귀 |
| 1 | find_skill v9 | v8 + 규칙은 상황에 닿을 때만 | .969/.969 | .873/.873 | 버림: 형식상 통과지만 train recall .938/.979 (#4, #6 회귀), precision·exact 개선 없음(holdout exact .438/.500) |
| 2 | find_skill v8 | 형제 객체 문장만 | .969/.969 | .878/.878 | 버림: train #4 회귀가 세 번 반복, precision 이득 +.004 |
| 2 | find_skill v9 | 규칙 상황 문장만 | .969/.969 | **.857/.873** (#62 회귀) | 버림: 기존 eval 회귀, precision +.006 |
| 1 | find_tool v4 | needs_extra_tool 정확 결과 문구 + 판정 기준 문구 | .938/.938 | **.865/.923** (#15, #16 회귀) | 버림 |
| 1 | find_tool v5 | v4 + compose.threshold 0.12 | .938/.938 | **.885/.923** (#16 회귀) | 버림: holdout exact·precision 하락 |
| 2 | find_tool v4 | 문구만(기준 문구 제외) | .938/.938 | .885/.885 | 버림: train 목표 recall 이득 0(.708/.708) |
| 2 | find_tool v5 | threshold 0.12 만 | 1.000/.938 | **.904/.923** (#16 회귀) | 버림: 기존 eval 회귀, holdout precision .833/1.000 |

이유를 한 줄로: find_skill 은 형제·규칙 과잉을 문구로 막으려 하면 두 스킬이 필요한 앱 에러 케이스(#4, bun-webview)의 recall 이 반복해서 떨어졌다. 설계 의도(놓침이 과잉보다 나쁨)와 어긋나므로 precision 이득이 그 값에 못 미쳤다. find_tool 은 gate 아래로 떨어지는 케이스를 문구와 threshold 로 건져도 기존 eval 의 노트북 케이스(#16)가 반복해서 빠졌다. p95 는 모든 후보에서 1.2초 이하로 3초 조건과 무관했다.

버린 프롬프트 본문은 `docs/eval/synthetic/rejected-prompts/iter{1,2}-*.json` 에 보관했다.

## holdout 수치

변경을 채택하지 않았으므로 holdout 의 의미 있는 값은 기준선이다(실행마다 2회 이상 나온 범위).

| 대상 | 기준 recall | 기준 exact | 기준 precision | p95 ms |
|---|---|---|---|---|
| find_skill v7 (16) | .969 | .438–.500 | .705–.726 | 504–918 |
| find_tool v1 (8) | .938 | .750–.875 | .938–1.000 | 377–568 |

## 승격 권고

- **이 루프의 후보: 승격하지 않는다.** 위 이유.
- **참고: 라이브 v4 대비 v7** (`docs/eval/synthetic/promo-find_skill-v7-vs-v4-*`; 계획 밖 추가 실행). recall 은 v7 이 같거나 높다(train .979/.938, holdout .969/.938, 기존 .873/.850). exact·precision 은 v7 이 낮다(train .682/.826). 과잉 주입이 늘어난 대신 놓침이 줄었으니 설계 의도 쪽이다. 지연도 v7 이 짧다(p95 480–679 ms 대 790–1257 ms). 그러나:
  - 기존 eval recall .873 이 도구의 승격 하한 .9 에 못 미친다(`does not hold`). v4 쪽은 기존 eval 에서 9건이 backend 쿼터 때문에 unavailable 이라 .850 은 낮게 나온 값이다. 쿼터가 풀리면 다시 돌려야 한다.
  - 기존 eval #0(`svelte 컴포넌트에서 $effect가 몇 초마다 리셋돼`)은 v7 에서 recall 0 이다(v4 .333). 이 대표 케이스에서 build-frontend p .07, svelte-effects .40 으로 주입 문턱 아래다. 이 케이스가 v7 의 약점이다.
  - 비용은 v7 이 2.3–3.75배다(후보 전체를 한 번에 묻는 구조). 사용자가 품질 우선, 토큰 상한 없음으로 정한 부분이다.
  - 결정은 사용자: v7 승격 여부(`decision promote find_skill v7` 후 서비스 재시작).

## 세션에서 나온 다른 발견 (프롬프트 밖, 사용자 결정)

1. **`injectMaxChars` 12000 이 높은 확신 스킬의 본문 주입을 막는다.** shadcn-svelte `SKILL.md` 는 16,985자라 p .96 이어도 힌트로만 간다(#1, #4). 설계 의도("확신하면 본문 주입")와 어긋난다. 에이전트가 직접 읽어서 피해는 없었지만, 이 상한을 올릴지 정해야 한다. 이 루프는 설정을 바꾸지 않았다.
2. **"재현 먼저" 검증 공백**: 위 세션 판정 참고.
3. **합성 라벨 정책 충돌**(규칙 범위): 위 참고.

## 절차상 사고와 한계

- **기존 보고서 덮어쓰기 사고.** 기준선 워커의 래퍼 스크립트가 첫 실행에서 경로 파싱 버그로 `docs/eval/261023-find_skill-v7.{md,json}`(untracked, 백업 없음)을 덮어썼다. 워커가 같은 63개 케이스로 v7 을 다시 돌려 파일을 재생성했다. 지표는 `261023-find_skill-v7-vs-v6` 의 후보 쪽과 같다(recall .873, exact .587, precision .780). 원본 바이트는 복구하지 못했다. 이후 모든 실행은 체크섬 비교로 `docs/eval` 이 그대로임을 확인했다.
- 승격 비교 중 backend 쿼터가 한 번 소진돼(train 재실행 14/24 unavailable) 그 결과는 `…rerun2-quota-exhausted.*` 로 따로 보관하고 첫 실행을 썼다.
- 실제 세션은 12개, 시나리오당 1회다. 세션 간 분산은 모른다.
- find_tool 은 pi 에서만 동작하는데 실제 pi 세션은 돌리지 않았다. find_tool 은 오프라인 평가만 했다.
- 합성 라벨은 한 사람(모델 워커)이 정했고 사용자 검수 전이다.

## 산출물

- `evals/synthetic/{find_skill.all,train,holdout,tool-all,tool-train,tool-holdout}.jsonl`
- `docs/eval/synthetic/`: 모든 실행 보고서(`synth-*`, `iter2-*`, `promo-*`), `sessions/{table.md,results.jsonl}`, `rejected-prompts/`
- 그림자 데몬은 종료했다(pid 3167554). 라이브 `decision.service` 는 active 그대로이고 설정은 그대로다. 커밋 없음.
