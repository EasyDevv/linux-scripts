# find_skill v4

Promotion rule does not hold. This report never promotes; `decision promote find_skill v4` is a separate step.

## Run

- generated: 2026-10-21T13:23:25.892Z
- cases: `/home/easydev/.local/share/scripts/dev/decision/evals/find_skill.jsonl` (59)
- backend: default · ladder openrouter/typesafe/jev-1.14
- answered 59, unavailable 0, skipped 1, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×57

## Metrics

```text
metric                 v4
answered            1.000
exact               0.695
recall              0.880
precision           0.922
quiet               1.000
coverage            1.000
answered / cases    59/59
unavailable             0
p50 ms                794
p95 ms               1228
cost USD          0.01273
calibrated            98%
```

## Promotion rule

```text
promotion rule (v4 floor): does not hold
  floor recall ≥ 0.9: 0.880 FAIL
  why not: recall 0.880 < floor 0.9
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v4, first 19)

| # | prompt | expected | got |
|---|---|---|---|
| 1 | svelte 컴포넌트에서 $effect가 몇 초마다 리셋돼 | {"skills":["build-frontend"],"rules":["frontend-consistency","svelte-effects"]} | {"status":"routed","reason":"0 skills, 1 rules (asked 1 of 51)","skills":[],"rules":[{"name":"svelte-effects","path":"/home/easydev/.agents/rules-routed/svelte-effects.md","scope":"global","p":0.59,"body":"# Svelte Effects\n\n- `$effect` t… |
| 2 | 다이얼로그 열 때마다 입력값이 폴링 때문에 원래 값으로 되돌아가. untrack 써야 하나? | {"skills":["build-frontend"],"rules":["frontend-consistency","svelte-effects"]} | {"status":"routed","reason":"0 skills, 1 rules (asked 1 of 51)","skills":[],"rules":[{"name":"svelte-effects","path":"/home/easydev/.agents/rules-routed/svelte-effects.md","scope":"global","p":0.98,"body":"# Svelte Effects\n\n- `$effect` t… |
| 4 | Add a retry button to the settings dialog in our Svelte app | {"skills":["build-frontend"],"rules":["frontend-consistency","svelte-effects"]} | {"status":"routed","reason":"2 skills, 2 rules (asked 3 of 51)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Shape SPA screens in .svelte — SvelteKit routes, C… |
| 6 | CGV 용산 취소표 좌석 확인해줘 | {"skills":["browse-site"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 2 of 51)","skills":[{"name":"browse-site","path":"/home/easydev/.agents/skills-routed/web/browse-site/SKILL.md","description":"Site collection — 당근 daangn, 번개장터, 중고나라, 2CPU, 다나와, 디시, Re… |
| 7 | Collect the top posts from this Reddit thread and summarize | {"skills":["browse-site"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 3 of 51)","skills":[{"name":"browse-site","path":"/home/easydev/.agents/skills-routed/web/browse-site/SKILL.md","description":"Site collection — 당근 daangn, 번개장터, 중고나라, 2CPU, 다나와, 디시, Re… |
| 8 | 로그인이 필요한 페이지를 로그인 세션 저장해서 읽어와줘 | {"skills":["browser"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 2 of 51)","skills":[{"name":"browser","path":"/home/easydev/.agents/skills-routed/web/browser/SKILL.md","description":"Fetch, scrape, or render a web page — browser CLI, obscura, Chromi… |
| 9 | pi -p 로 파일마다 요약 돌리는 스크립트 짜줘 | {"skills":[],"rules":["pi-print"]} | {"status":"routed","reason":"1 skills, 1 rules (asked 2 of 51)","skills":[{"name":"build-terminal-script","path":"/home/easydev/.agents/skills-routed/build/build-terminal-script/SKILL.md","description":"Terminal CLI scripts (터미널 스크립트, CLI … |
| 14 | 라이브 사이트 사이드바를 draft 에 똑같이 포팅하고 padding gap 다시 측정해줘 | {"skills":["shape-product-loop"],"rules":["design-themes","product-loop","theme-ref"]} | {"status":"routed","reason":"0 skills, 1 rules (asked 1 of 51)","skills":[],"rules":[{"name":"theme-ref","path":"/home/easydev/.agents/rules-routed/theme-ref.md","scope":"global","p":0.99,"body":"# Theme-ref live port\n\n- Outer `w`/`h`/`r… |
| 25 | 조사 문서를 결론 먼저 쓰는 형식으로 docs 에 작성해줘 | {"skills":["write-doc"],"rules":["docs-archive"]} | {"status":"routed","reason":"1 skills, 0 rules (asked 1 of 51)","skills":[{"name":"write-doc","path":"/home/easydev/.agents/skills-routed/writing/write-doc/SKILL.md","description":"Write a markdown doc (문서 작성, 조사 문서, 비교 문서) — research, com… |
| 39 | 고마워! | {"skills":[],"rules":[]} | {"status":"skipped","reason":"acknowledgement","skills":[],"rules":[],"candidates":0} |
| 40 | grade ladder 사다리에서 불필요한 fallback 낭비를 점검해줘 | {"skills":["analyze-grade-waste"],"rules":[]} | {"status":"routed","reason":"0 skills, 2 rules (asked 4 of 54)","skills":[],"rules":[{"name":"provider-errors","path":"/home/easydev/.pi/agent/.agents/rules-routed/provider-errors.md","scope":"project","p":0.88,"body":"# Provider Errors\n\… |
| 41 | upstream codex 하네스 프롬프트를 overlay 로 이식하고 SOURCE 핀 갱신해줘 | {"skills":["port-harness"],"rules":[]} | {"status":"routed","reason":"nothing applies (asked 6 of 54)","skills":[],"rules":[],"candidates":54} |
| 43 | permission.bash 에 rm -rf 를 trash-put 으로 바꾸는 규칙을 넣어줘 | {"skills":[],"rules":["config-jsonc"]} | {"status":"routed","reason":"1 skills, 1 rules (asked 2 of 54)","skills":[{"name":"write-a-rule","path":"/home/easydev/.agents/skills-routed/agent-meta/write-a-rule/SKILL.md","description":"Write or revise an agent rule file in ~/.agents/r… |
| 47 | docs/plan 아래에 새 계획 문서를 쓰려고 해. 어떤 skill을 써야 하는지 이름만 한 줄로 답해. | {"skills":["write-doc"],"rules":["docs-archive"]} | {"status":"routed","reason":"1 skills, 0 rules (asked 2 of 54)","skills":[{"name":"write-doc","path":"/home/easydev/.agents/skills-routed/writing/write-doc/SKILL.md","description":"Write a markdown doc (문서 작성, 조사 문서, 비교 문서) — research, com… |
| 48 | docs/study 에 있는 260906-skill-offload.md 를 docs/offload 로 옮기고 링크도 고쳐줘 | {"skills":[],"rules":["docs-archive"]} | {"status":"routed","reason":"nothing applies (asked 1 of 54)","skills":[],"rules":[],"candidates":54} |
| 53 | 이번 결과를 정리해서 docs/eval 에 결론 먼저 보고서로 남겨줘 | {"skills":["write-doc"],"rules":["docs-archive"]} | {"status":"routed","reason":"1 skills, 0 rules (asked 1 of 54)","skills":[{"name":"write-doc","path":"/home/easydev/.agents/skills-routed/writing/write-doc/SKILL.md","description":"Write a markdown doc (문서 작성, 조사 문서, 비교 문서) — research, com… |
| 56 | 리스트 페이지에 다운로드 버튼이 안 붙는 문제, MutationObserver 로 다시 바인딩하게 고쳐줘 | {"skills":[],"rules":["userscript-observers"]} | {"status":"routed","reason":"0 skills, 2 rules (asked 2 of 55)","skills":[],"rules":[{"name":"userscript-observers","path":"/home/easydev/dev/tampermonkey/.agents/rules-routed/userscript-observers.md","scope":"project","p":0.99,"body":"# U… |
| 57 | Firefox Android에서 팝업 설정 버튼이 options 페이지로 안 넘어가 | {"skills":[],"rules":["browser-extension","stack-svelte-wxt"]} | {"status":"routed","reason":"0 skills, 1 rules (asked 1 of 54)","skills":[],"rules":[{"name":"browser-extension","path":"/home/easydev/dev/extensions/ebook-scroller/.agents/rules-routed/browser-extension.md","scope":"project","p":0.86,"bod… |
| 58 | apps/server에 프로젝트 삭제 API 엔드포인트를 추가하고 클라이언트 api.ts에서 호출하게 해줘 | {"skills":["build-backend"],"rules":["stack-svelte-rust"]} | {"status":"routed","reason":"1 skills, 2 rules (asked 2 of 54)","skills":[{"name":"build-backend","path":"/home/easydev/.agents/skills-routed/build/build-backend/SKILL.md","description":"HTTP API + auth — Actix/Rust handlers, login/session… |
