# 경로 트리거 하이브리드 (스크립트 우선, Jev 차순위)

## 결론

| 질문 | 답 |
|---|---|
| write-doc 누락은 같은 문제인가 | **같은 문제다.** 프롬프트에 `docs/plan`이라는 경로가 있었는데도, shortlist가 35개 중 2개만 남기면서 write-doc을 뺐다 |
| 글롭/경로 트리거가 더 나은가 | **경로가 확실한 신호일 때는 더 낫다.** 일치 여부는 사실이라 모델에게 묻지 않아도 된다. 신호가 없는 프롬프트는 계속 Jev가 판단한다 |
| 채택 방식 | frontmatter에 `paths:`를 둔다(Claude Code의 이름). 매칭되면 rule은 **바로 선택**하고, skill은 shortlist와 상관없이 **반드시 Jev에 묻는다** |
| touch | 파일을 read/edit/write하면 그 경로를 빈 프롬프트로 보낸다. **글롭만으로 답하고 Jev는 0회**, 응답 3 ms |
| 평가 | find_skill v3 vs v2, 59건 × 3회: recall **0.961–0.965 vs 0.939–0.948**, precision 0.947–0.952로 동일, 3회 모두 HOLDS |
| 상태 | **v3 승격**, daemon 재시작. pi와 Claude Code 양쪽에 touch를 연결함 |

## 2. 왜 스크립트를 먼저 쓰나

```text
prompt 경로 추출 (docs/plan에 -> docs/plan)  +  touch 경로 (read/edit/write)
  -> paths: 글롭 매칭
       rule 매칭  -> 바로 선택 (p = 1)
       skill 매칭 -> asked 집합에 강제 포함
  -> 나머지 후보 -> Jev shortlist -> Jev bool -> 기준값
```

| 신호 | 스크립트 | Jev |
|---|---|---|
| 경로가 있다 (`docs/**`, `config.jsonc`, `.product/**`) | 확실하다. 0 ms, 비용 없음 | 2개만 보는 shortlist라 놓칠 수 있다 |
| 경로가 없다 ("계획 문서 써줘") | 신호가 없다 | 의미로 판단한다 |
| 경로가 있지만 다른 일 ("docs/x.md 읽어줘") | rule만 붙고, skill은 Jev가 거른다 | 판단한다 |

skill을 바로 선택하지 않는 이유는 정확도다. 문서를 읽기만 해도 write-doc이 붙으면 오답이 된다. 그래서 스크립트는 skill을 "물어볼 후보"로만 넣고, 실제 선택은 Jev에게 맡긴다.

## 3. 무엇에 `paths`를 붙였나

| 항목 | 범위 | paths |
|---|---|---|
| skill `write-doc` | 전역 | `docs/**/*.md` |
| rule `docs-archive` (always-on에서 routed로) | 전역 | `docs/**` |
| rule `product-loop` | 전역 | `.product/**` |
| rule `config-jsonc` | ~/.pi/agent | `config.jsonc`, `.pi/config.jsonc` |
| rule `provider-errors` | ~/.pi/agent | `extensions/lib/{usage-policy,live-limits,remaining}.ts`, `extensions/subagent/quota.ts` |
| rule `subagent` | ~/.pi/agent | `extensions/subagent/{agents,config}.json`, `family-agent.ts`, `prompts/**` |
| 공유·프로젝트 rule | 각 repo | fork A 지정 문서 [261018-project-rules-routing](../rules/261018-project-rules-routing.md) |

넓은 글롭(`**/*.md`, `**/*.ts`)은 쓰지 않았다. `docs-archive`에 `**/*.md`를 붙이면 "README.md 한 줄 추가"에도 매칭되는데, README는 이 rule의 적용 범위 밖이다. 그래서 eval에 이 경우를 부정 케이스로 넣었다.

## 4. 경로 추출 규칙

| 입력 | 추출 | 이유 |
|---|---|---|
| `` `docs/plan`에 `` | `docs/plan` | ASCII 경로 문자만 남겨서, 붙어 있는 조사를 잘라낸다 |
| `src/app.ts,` | `src/app.ts` | 끝의 구두점을 지운다 |
| `1.34 s` | 없음 | 확장자는 문자로 시작해야 한다 |
| `https://x.dev/docs/a.md` | 없음 | URL은 제외한다 |
| `~/proj/b.md`, `./lib/a.ts` | 프로젝트 기준 상대경로 | 프로젝트 밖 경로는 버린다 |
| `/design/draft …`로 시작하는 프롬프트 | 경로로 본다 | 전에는 slash command로 잘못 건너뛰었다 (`skipReason` 수정) |

디렉터리 경로(확장자 없음)는 글롭의 고정 접두부 아래에 있으면 매칭한다. 예: `docs/plan`과 `docs/**/*.md`.

## 5. 평가

| 실행 | v3 recall | v2 recall | v3 exact | v2 exact | precision | p95 ms |
|---|---|---|---|---|---|---|
| 1 (53건) | 0.961 | 0.942 | 0.830 | 0.811 | 0.947 = | 819 / 831 |
| 2 (59건) | 0.965 | 0.939 | 0.847 | 0.814 | 0.952 = | 815 / 811 |
| 3 (59건) | 0.965 | 0.948 | 0.847 | 0.831 | 0.952 = | 868 / 860 |

추가한 케이스는 다음과 같다.

- 경로 하이브리드 6건: docs 이동, touch 보고, 이름이 나온 파일, README 부정 케이스, `.product`, `docs/eval` 디렉터리
- fork A 6건: 프로젝트 rule. 부정 케이스 1건 포함
- 라벨 수정 3건: write-doc 2건에 `docs-archive`를 더했고(`skills:` 연결), `.product` 1건에 `design-themes`·`theme-ref`를 더했다

결정적인 차이는 touch 케이스다. v2는 프롬프트가 비어 있어 건너뛰지만, v3는 `config-jsonc`를 고른다. `extensions/lib/usage-policy.ts` 케이스에서는 v3가 4개를 묻는데, 경로로 넣은 후보 때문이다.

## 6. harness 연결

| harness | 프롬프트 | touch |
|---|---|---|
| pi (`extensions/decision`) | find_skill 본문 그대로, 결과는 턴 메시지 | `tool_result`(read/edit/write) → `paths` → tool 결과 끝에 rule, 경로당 1회 |
| Claude Code (`~/.agents/plugins/decision`) | `prompt.submit` context | `tool.call` Read/Edit/Write 후 → `paths` → 결과 `context`, `touched`는 상태 파일에 기록 |

`.claude/rules`에 있는 glob rule(architecture, bun, project-name, stash-ui)에는 `applyTo`와 같은 글롭으로 `paths:`를 더 적었다. Claude Code는 `applyTo`를 읽지 않아서 이 rule들을 항상 로드하고 있었다.

## Backlog

- **가정: `paths:`를 더해도 pi와 Claude Code의 skill 로더가 오류를 내지 않는다.** 확인: pi 3턴 세션에서 write-doc이 정상 목록에 있었다. Claude Code에서는 `/skills` 목록에 write-doc이 나오는지 본다.
- **가정: Claude Code가 `paths:`로 `.claude/rules` 로드 범위를 제한한다.** 확인: 다른 프로젝트의 Claude Code 세션에서 첫 프롬프트에 architecture.md가 보이지 않는지 확인한다.
- **할 일: 디렉터리 언급 매칭은 상위 디렉터리만 본다.** `docs`라고만 쓰면 `docs/plan/**` 글롭과는 맞지 않는다. 오탐이 날지 미탐이 날지는 audit 데이터를 보고 정한다.
- **할 일: touch 매칭은 결과마다 daemon 로그에 한 줄을 남긴다.** 경로당 1회로 줄였지만, 이것이 audit에 잡음이 되는지는 7일 audit 때 본다.
- **열린 질문:** 반복되는 Jev 판정을 `paths`로 옮길 후보(같은 rule이 늘 같은 경로와 함께 나오는 경우)를 audit이 자동으로 제안하게 할 것인가.

## Sources

- 구현: `features/path-trigger.ts`, `features/find-skill.ts` (`limits.scriptFirst`), `catalog.ts` (`paths`), `prompts/find_skill/v3.json`
- 평가: `docs/eval/261018-find_skill-v3-vs-v2.{md,json}`, scratchpad `eval-v3-run{1,2}.txt`
- 테스트: daemon 118, pi decision 45, Claude 플러그인 34 통과
