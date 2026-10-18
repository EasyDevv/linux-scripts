# find_skill v3 vs v2

Promotion rule holds. This report never promotes; `decision promote find_skill v3` is a separate step.

## Run

- generated: 2026-10-18T04:08:27.165Z
- cases: `/home/easydev/.local/share/scripts/dev/decision/evals/find_skill.jsonl` (59)
- backend: default · ladder openrouter/typesafe/jev-1.14 → opencode/jev-1.13-free → opencode/jev-1.13
- answered 59, unavailable 0, skipped 1, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×57

## Metrics

```text
metric                 v3       v2       Δ
answered            1.000    1.000  +0.000
exact               0.847    0.831  +0.017
recall              0.965    0.948  +0.017
precision           0.952    0.952  +0.000
quiet               1.000    1.000  +0.000
coverage            1.000    1.000  +0.000
answered / cases    59/59    59/59
unavailable             0        0
p50 ms                750      761
p95 ms                868      860
cost USD          0.00760  0.00760
calibrated            98%     100%
```

## Promotion rule

```text
promotion rule (v3 vs v2): HOLDS
  floor recall ≥ 0.9: 0.965 ok
  better on: exact, recall
  worse on:  none
  guard p95 latency ms: 860.0000 → 868.0000 ok
  guard cost USD: 0.0076 → 0.0076 ok
  guard calibrated share: 1.0000 → 0.9828 ok
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v3, first 10)

| # | prompt | expected | got |
|---|---|---|---|
| 1 | svelte 컴포넌트에서 $effect가 몇 초마다 리셋돼 | {"skills":["build-frontend"],"rules":["frontend-consistency","svelte-effects"]} | {"status":"routed","reason":"0 skills, 1 rules (asked 1 of 28)","skills":[],"rules":[{"name":"svelte-effects","path":"/home/easydev/.agents/rules-routed/svelte-effects.md","scope":"global","p":0.64,"body":"# Svelte Effects\n\n- `$effect` t… |
| 2 | 다이얼로그 열 때마다 입력값이 폴링 때문에 원래 값으로 되돌아가. untrack 써야 하나? | {"skills":["build-frontend"],"rules":["frontend-consistency","svelte-effects"]} | {"status":"routed","reason":"0 skills, 1 rules (asked 1 of 28)","skills":[],"rules":[{"name":"svelte-effects","path":"/home/easydev/.agents/rules-routed/svelte-effects.md","scope":"global","p":0.98,"body":"# Svelte Effects\n\n- `$effect` t… |
| 6 | CGV 용산 취소표 좌석 확인해줘 | {"skills":["browse-site"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 2 of 28)","skills":[{"name":"browse-site","path":"/home/easydev/.agents/skills/browse-site/SKILL.md","description":"Route site-specific collection and browsing to the one reference that… |
| 8 | 로그인이 필요한 페이지를 로그인 세션 저장해서 읽어와줘 | {"skills":["browser"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 2 of 28)","skills":[{"name":"browser","path":"/home/easydev/.agents/skills/browser/SKILL.md","description":"Pick the engine and run the `browser` CLI — obscura --stealth to read pages (… |
| 9 | pi -p 로 파일마다 요약 돌리는 스크립트 짜줘 | {"skills":[],"rules":["pi-print"]} | {"status":"routed","reason":"1 skills, 1 rules (asked 2 of 28)","skills":[{"name":"build-terminal-script","path":"/home/easydev/.agents/skills/build-terminal-script/SKILL.md","description":"Build or restyle one-shot terminal CLIs in any la… |
| 11 | 새 로그인 화면을 .product 에 Loop 로 먼저 만들어줘 | {"skills":["shape-product-loop"],"rules":["design-themes","product-loop","theme-ref"]} | {"status":"routed","reason":"2 skills, 4 rules (asked 3 of 28)","skills":[{"name":"shape-product-loop","path":"/home/easydev/.agents/skills/shape-product-loop/SKILL.md","description":"Defines Loop, Side, and Extra surfaces as shadcn `.svel… |
| 14 | 라이브 사이트 사이드바를 draft 에 똑같이 포팅하고 padding gap 다시 측정해줘 | {"skills":["shape-product-loop"],"rules":["design-themes","product-loop","theme-ref"]} | {"status":"routed","reason":"0 skills, 1 rules (asked 1 of 28)","skills":[],"rules":[{"name":"theme-ref","path":"/home/easydev/.agents/rules-routed/theme-ref.md","scope":"global","p":0.99,"body":"# Theme-ref live port\n\n- Outer `w`/`h`/`r… |
| 39 | 고마워! | {"skills":[],"rules":[]} | {"status":"skipped","reason":"acknowledgement","skills":[],"rules":[],"candidates":0} |
| 43 | permission.bash 에 rm -rf 를 trash-put 으로 바꾸는 규칙을 넣어줘 | {"skills":[],"rules":["config-jsonc"]} | {"status":"routed","reason":"1 skills, 1 rules (asked 2 of 35)","skills":[{"name":"write-a-rule","path":"/home/easydev/.agents/skills/write-a-rule/SKILL.md","description":"Create and revise standing agent rules that stay out of context unt… |
| 56 | 리스트 페이지에 다운로드 버튼이 안 붙는 문제, MutationObserver 로 다시 바인딩하게 고쳐줘 | {"skills":[],"rules":["userscript-observers"]} | {"status":"routed","reason":"0 skills, 2 rules (asked 2 of 33)","skills":[],"rules":[{"name":"userscript-observers","path":"/home/easydev/dev/tampermonkey/.agents/rules-routed/userscript-observers.md","scope":"project","p":0.99,"body":"# U… |
