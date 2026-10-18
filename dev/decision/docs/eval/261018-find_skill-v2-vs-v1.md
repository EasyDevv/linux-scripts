# find_skill v2 vs v1

Promotion rule holds. This report never promotes; `decision promote find_skill v2` is a separate step.

## Run

- generated: 2026-10-18T03:50:45.752Z
- cases: `/home/easydev/.local/share/scripts/dev/decision/evals/find_skill.jsonl` (47)
- backend: default · ladder openrouter/typesafe/jev-1.14 → opencode/jev-1.13-free → opencode/jev-1.13
- answered 47, unavailable 0, skipped 1, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×46

## Metrics

```text
metric                 v2       v1       Δ
answered            1.000    1.000  +0.000
exact               0.809    0.787  +0.021
recall              0.956    0.934  +0.021
precision           0.943    0.943  +0.000
quiet               1.000    1.000  +0.000
coverage            1.000    1.000  +0.000
answered / cases    47/47    47/47
unavailable             0        0
p50 ms                751      732
p95 ms                858      788
cost USD          0.00584  0.00584
calibrated           100%     100%
```

## Promotion rule

```text
promotion rule (v2 vs v1): HOLDS
  floor recall ≥ 0.9: 0.956 ok
  better on: exact, recall
  worse on:  none
  guard p95 latency ms: 788.0000 → 858.0000 ok
  guard cost USD: 0.0058 → 0.0058 ok
  guard calibrated share: 1.0000 → 1.0000 ok
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v2, first 10)

| # | prompt | expected | got |
|---|---|---|---|
| 1 | svelte 컴포넌트에서 $effect가 몇 초마다 리셋돼 | {"skills":["build-frontend"],"rules":["frontend-consistency","svelte-effects"]} | {"status":"routed","reason":"0 skills, 1 rules (asked 1 of 27)","skills":[],"rules":[{"name":"svelte-effects","path":"/home/easydev/.agents/rules-routed/svelte-effects.md","scope":"global","p":0.6,"body":"# Svelte Effects\n\n- `$effect` tr… |
| 2 | 다이얼로그 열 때마다 입력값이 폴링 때문에 원래 값으로 되돌아가. untrack 써야 하나? | {"skills":["build-frontend"],"rules":["frontend-consistency","svelte-effects"]} | {"status":"routed","reason":"0 skills, 1 rules (asked 1 of 27)","skills":[],"rules":[{"name":"svelte-effects","path":"/home/easydev/.agents/rules-routed/svelte-effects.md","scope":"global","p":0.97,"body":"# Svelte Effects\n\n- `$effect` t… |
| 6 | CGV 용산 취소표 좌석 확인해줘 | {"skills":["browse-site"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 2 of 27)","skills":[{"name":"browse-site","path":"/home/easydev/.agents/skills/browse-site/SKILL.md","description":"Route site-specific collection and browsing to the one reference that… |
| 8 | 로그인이 필요한 페이지를 로그인 세션 저장해서 읽어와줘 | {"skills":["browser"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 2 of 27)","skills":[{"name":"browser","path":"/home/easydev/.agents/skills/browser/SKILL.md","description":"Pick the engine and run the `browser` CLI — obscura --stealth to read pages (… |
| 9 | pi -p 로 파일마다 요약 돌리는 스크립트 짜줘 | {"skills":[],"rules":["pi-print"]} | {"status":"routed","reason":"1 skills, 1 rules (asked 2 of 27)","skills":[{"name":"build-terminal-script","path":"/home/easydev/.agents/skills/build-terminal-script/SKILL.md","description":"Build or restyle one-shot terminal CLIs in any la… |
| 11 | 새 로그인 화면을 .product 에 Loop 로 먼저 만들어줘 | {"skills":["shape-product-loop"],"rules":["design-themes","product-loop","theme-ref"]} | {"status":"routed","reason":"2 skills, 4 rules (asked 3 of 27)","skills":[{"name":"shape-product-loop","path":"/home/easydev/.agents/skills/shape-product-loop/SKILL.md","description":"Defines Loop, Side, and Extra surfaces as shadcn `.svel… |
| 12 | LOOP.md 에 새 surface 행 추가하고 page.svelte 초안 만들어 | {"skills":["shape-product-loop"],"rules":["design-themes","product-loop","theme-ref"]} | {"status":"routed","reason":"2 skills, 4 rules (asked 3 of 27)","skills":[{"name":"shape-product-loop","path":"/home/easydev/.agents/skills/shape-product-loop/SKILL.md","description":"Defines Loop, Side, and Extra surfaces as shadcn `.svel… |
| 14 | 라이브 사이트 사이드바를 draft 에 똑같이 포팅하고 padding gap 다시 측정해줘 | {"skills":["shape-product-loop"],"rules":["design-themes","product-loop","theme-ref"]} | {"status":"routed","reason":"0 skills, 1 rules (asked 1 of 27)","skills":[],"rules":[{"name":"theme-ref","path":"/home/easydev/.agents/rules-routed/theme-ref.md","scope":"global","p":0.99,"body":"# Theme-ref live port\n\n- Outer `w`/`h`/`r… |
| 39 | 고마워! | {"skills":[],"rules":[]} | {"status":"skipped","reason":"acknowledgement","skills":[],"rules":[],"candidates":0} |
| 43 | permission.bash 에 rm -rf 를 trash-put 으로 바꾸는 규칙을 넣어줘 | {"skills":[],"rules":["config-jsonc"]} | {"status":"routed","reason":"1 skills, 1 rules (asked 2 of 34)","skills":[{"name":"write-a-rule","path":"/home/easydev/.agents/skills/write-a-rule/SKILL.md","description":"Create and revise standing agent rules that stay out of context unt… |
