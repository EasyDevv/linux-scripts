# find_skill v7 vs v6

Promotion rule does not hold. This report never promotes; `decision promote find_skill v7` is a separate step.

## Run

- generated: 2026-10-23T09:05:48.296Z
- cases: `/home/easydev/.local/share/scripts/dev/decision/evals/find_skill.jsonl` (63)
- backend: default · ladder openrouter/typesafe/jev-1.14
- answered 63, unavailable 0, skipped 1, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×61

## Metrics

```text
metric                 v7       v6       Δ
answered            1.000    1.000  +0.000
exact               0.587    0.714  -0.127
recall              0.873    0.858  +0.015
precision           0.780    0.849  -0.069
quiet               1.000    1.000  +0.000
coverage            1.000    1.000  +0.000
answered / cases    63/63    63/63
unavailable             0        0
p50 ms                425      746
p95 ms                528      923
cost USD          0.02744  0.00922
calibrated            98%      98%
```

## Promotion rule

```text
promotion rule (v7 vs v6): does not hold
  floor recall ≥ 0.9: 0.873 FAIL
  better on: recall
  worse on:  exact, precision
  guard p95 latency ms: 923.0000 → 528.0000 ok
  guard cost USD: 0.0092 → 0.0274 FAIL
  guard calibrated share: 0.9839 → 0.9839 ok
  why not: recall 0.873 < floor 0.9; worse on exact, precision; cost $0.02744 > baseline $0.00922
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v7, first 20)

| # | prompt | expected | got |
|---|---|---|---|
| 1 | svelte 컴포넌트에서 $effect가 몇 초마다 리셋돼 | {"skills":["build-frontend"],"rules":["frontend-consistency","svelte-effects"]} | {"status":"routed","reason":"nothing applies (asked 41 of 41)","skills":[],"rules":[],"candidates":41} |
| 4 | Add a retry button to the settings dialog in our Svelte app | {"skills":["build-frontend"],"rules":["frontend-consistency","svelte-effects"]} | {"status":"routed","reason":"2 skills, 2 rules (asked 41 of 41)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Shape Svelte SPA screens asked to be built or res… |
| 5 | 당근에서 RTX 3090 시세 수집해줘 | {"skills":["browse-site"],"rules":[]} | {"status":"routed","reason":"3 skills, 0 rules (asked 41 of 41)","skills":[{"name":"browse-site","path":"/home/easydev/.agents/skills-routed/web/browse-site/SKILL.md","description":"Site collection — 당근 daangn, 번개장터, 중고나라, 2CPU, 다나와, 디시, R… |
| 6 | CGV 용산 취소표 좌석 확인해줘 | {"skills":["browse-site"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 41 of 41)","skills":[{"name":"browse-site","path":"/home/easydev/.agents/skills-routed/web/browse-site/SKILL.md","description":"Site collection — 당근 daangn, 번개장터, 중고나라, 2CPU, 다나와, 디시, R… |
| 7 | Collect the top posts from this Reddit thread and summarize | {"skills":["browse-site"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 41 of 41)","skills":[{"name":"browse-site","path":"/home/easydev/.agents/skills-routed/web/browse-site/SKILL.md","description":"Site collection — 당근 daangn, 번개장터, 중고나라, 2CPU, 다나와, 디시, R… |
| 8 | 로그인이 필요한 페이지를 로그인 세션 저장해서 읽어와줘 | {"skills":["browser"],"rules":[]} | {"status":"routed","reason":"3 skills, 0 rules (asked 41 of 41)","skills":[{"name":"browser","path":"/home/easydev/.agents/skills-routed/web/browser/SKILL.md","description":"Fetch, scrape, or render a web page — browser CLI, obscura, Chrom… |
| 9 | pi -p 로 파일마다 요약 돌리는 스크립트 짜줘 | {"skills":[],"rules":["pi-print"]} | {"status":"routed","reason":"1 skills, 1 rules (asked 41 of 41)","skills":[{"name":"build-terminal-script","path":"/home/easydev/.agents/skills-routed/build/build-terminal-script/SKILL.md","description":"Terminal CLI scripts (터미널 스크립트, CLI… |
| 11 | 새 로그인 화면을 .product 에 Loop 로 먼저 만들어줘 | {"skills":["shape-product-loop"],"rules":["design-themes","product-loop","theme-ref"]} | {"status":"routed","reason":"2 skills, 2 rules (asked 41 of 41)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Shape Svelte SPA screens asked to be built or res… |
| 12 | LOOP.md 에 새 surface 행 추가하고 page.svelte 초안 만들어 | {"skills":["shape-product-loop"],"rules":["design-themes","product-loop","theme-ref"]} | {"status":"routed","reason":"1 skills, 2 rules (asked 41 of 41)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Shape Svelte SPA screens asked to be built or res… |
| 13 | toss 테마 design.json 에 새 토큰을 승격해줘 | {"skills":[],"rules":["design-themes"]} | {"status":"routed","reason":"nothing applies (asked 41 of 41)","skills":[],"rules":[],"candidates":41} |
| 14 | 라이브 사이트 사이드바를 draft 에 똑같이 포팅하고 padding gap 다시 측정해줘 | {"skills":["shape-product-loop"],"rules":["design-themes","product-loop","theme-ref"]} | {"status":"routed","reason":"3 skills, 2 rules (asked 41 of 41)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Shape Svelte SPA screens asked to be built or res… |
| 15 | 대시보드 화면들 캡처 떠서 라이트 다크 일관성 맞춰줘 | {"skills":[],"rules":["frontend-consistency"]} | {"status":"routed","reason":"3 skills, 1 rules (asked 41 of 41)","skills":[{"name":"browser","path":"/home/easydev/.agents/skills-routed/web/browser/SKILL.md","description":"Fetch, scrape, or render a web page — browser CLI, obscura, Chrom… |
| 16 | 대시보드 UX 정리하고 중복 버튼 지워줘 | {"skills":["improve-ux"],"rules":["frontend-consistency"]} | {"status":"routed","reason":"2 skills, 2 rules (asked 41 of 41)","skills":[{"name":"improve-ux","path":"/home/easydev/.agents/skills-routed/build/improve-ux/SKILL.md","description":"UX cleanup of an existing frontend — dashboard simplifica… |
| 22 | 지난주 pi 세션 jsonl 분석해서 반복 실수 알려줘 | {"skills":["analyze-pi-sessions"],"rules":[]} | {"status":"routed","reason":"3 skills, 0 rules (asked 41 of 41)","skills":[{"name":"analyze-pi-sessions","path":"/home/easydev/.agents/skills-routed/agent-meta/analyze-pi-sessions/SKILL.md","description":"pi 세션 분석 — pi --session, pi sessio… |
| 26 | ASCII 와이어프레임으로 레이아웃 초안 그려줘 | {"skills":["write-ascii-draft"],"rules":[]} | {"status":"routed","reason":"nothing applies (asked 41 of 41)","skills":[],"rules":[],"candidates":41} |
| 29 | ComfyUI 결과 이미지를 1-5점으로 블라인드 평가하는 페이지 만들어줘 | {"skills":["evaluate-image-preference"],"rules":[]} | {"status":"routed","reason":"2 skills, 2 rules (asked 41 of 41)","skills":[{"name":"evaluate-image-preference","path":"/home/easydev/.agents/skills-routed/research/evaluate-image-preference/SKILL.md","description":"Rate generated images bl… |
| 39 | 고마워! | {"skills":[],"rules":[]} | {"status":"skipped","reason":"acknowledgement","skills":[],"rules":[],"candidates":0} |
| 40 | grade ladder 사다리에서 불필요한 fallback 낭비를 점검해줘 | {"skills":["analyze-grade-waste"],"rules":[]} | {"status":"routed","reason":"0 skills, 2 rules (asked 44 of 44)","skills":[],"rules":[{"name":"provider-errors","path":"/home/easydev/.pi/agent/.agents/rules-routed/provider-errors.md","scope":"project","p":0.9,"body":"# Provider Errors\n\… |
| 41 | upstream codex 하네스 프롬프트를 overlay 로 이식하고 SOURCE 핀 갱신해줘 | {"skills":["port-harness"],"rules":[]} | {"status":"routed","reason":"nothing applies (asked 44 of 44)","skills":[],"rules":[],"candidates":44} |
| 43 | permission.bash 에 rm -rf 를 trash-put 으로 바꾸는 규칙을 넣어줘 | {"skills":[],"rules":["config-jsonc"]} | {"status":"routed","reason":"2 skills, 1 rules (asked 44 of 44)","skills":[{"name":"write-a-rule","path":"/home/easydev/.agents/skills-routed/agent-meta/write-a-rule/SKILL.md","description":"Write or revise an agent rule file in ~/.agents/… |
