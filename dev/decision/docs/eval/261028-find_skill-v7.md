# find_skill v7

Promotion rule holds. This report never promotes; `decision promote find_skill v7` is a separate step.

## Run

- generated: 2026-10-28T02:48:33.620Z
- cases: `/home/easydev/.local/share/scripts/dev/decision/evals/find_skill.jsonl` (87)
- backend: default · ladder openrouter/typesafe/jev-1.14
- answered 87, unavailable 0, skipped 2, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×84

## Metrics

```text
metric                 v7
answered            1.000
exact               0.529
recall              0.901
precision           0.730
quiet               0.952
coverage            1.000
answered / cases    87/87
unavailable             0
p50 ms                520
p95 ms                793
cost USD          0.04532
calibrated            99%
```

## Promotion rule

```text
promotion rule (v7 floor): HOLDS
  floor recall ≥ 0.9: 0.901 ok
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v7, first 20)

| # | prompt | expected | got |
|---|---|---|---|
| 1 | svelte 컴포넌트에서 $effect가 몇 초마다 리셋돼 | {"skills":["build-frontend"],"rules":["frontend-consistency","svelte-effects"]} | {"status":"routed","reason":"nothing applies (asked 48 of 48)","skills":[],"rules":[],"candidates":48} |
| 3 | SvelteKit 라우트에 툴바와 배지 추가하고 rune 상태로 바꿔줘 | {"skills":["build-frontend"],"rules":["frontend-consistency","svelte-effects"]} | {"status":"routed","reason":"1 skills, 1 rules (asked 48 of 48)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Build, change or fix Svelte SPA screens — SvelteK… |
| 4 | Add a retry button to the settings dialog in our Svelte app | {"skills":["build-frontend"],"rules":["frontend-consistency","svelte-effects"]} | {"status":"routed","reason":"2 skills, 2 rules (asked 48 of 48)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Build, change or fix Svelte SPA screens — SvelteK… |
| 5 | 당근에서 RTX 3090 시세 수집해줘 | {"skills":["browse-site"],"rules":[]} | {"status":"routed","reason":"3 skills, 0 rules (asked 48 of 48)","skills":[{"name":"browse-site","path":"/home/easydev/.agents/skills-routed/web/browse-site/SKILL.md","description":"Site collection — 당근 daangn, 번개장터, 중고나라, 2CPU, 다나와, 디시, R… |
| 6 | CGV 용산 취소표 좌석 확인해줘 | {"skills":["browse-site"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 48 of 48)","skills":[{"name":"browse-site","path":"/home/easydev/.agents/skills-routed/web/browse-site/SKILL.md","description":"Site collection — 당근 daangn, 번개장터, 중고나라, 2CPU, 다나와, 디시, R… |
| 7 | Collect the top posts from this Reddit thread and summarize | {"skills":["browse-site"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 48 of 48)","skills":[{"name":"browse-site","path":"/home/easydev/.agents/skills-routed/web/browse-site/SKILL.md","description":"Site collection — 당근 daangn, 번개장터, 중고나라, 2CPU, 다나와, 디시, R… |
| 8 | 로그인이 필요한 페이지를 로그인 세션 저장해서 읽어와줘 | {"skills":["browser"],"rules":[]} | {"status":"routed","reason":"3 skills, 0 rules (asked 48 of 48)","skills":[{"name":"browser","path":"/home/easydev/.agents/skills-routed/web/browser/SKILL.md","description":"Fetch, scrape, or render a web page — browser CLI, obscura, Chrom… |
| 9 | pi -p 로 파일마다 요약 돌리는 스크립트 짜줘 | {"skills":[],"rules":["pi-print"]} | {"status":"routed","reason":"1 skills, 1 rules (asked 48 of 48)","skills":[{"name":"build-terminal-script","path":"/home/easydev/.agents/skills-routed/build/build-terminal-script/SKILL.md","description":"Terminal CLI scripts (터미널 스크립트, CLI… |
| 11 | 새 로그인 화면을 .product 에 Loop 로 먼저 만들어줘 | {"skills":["shape-product-loop"],"rules":["design-themes","product-loop","theme-ref"]} | {"status":"routed","reason":"1 skills, 1 rules (asked 48 of 48)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Build, change or fix Svelte SPA screens — SvelteK… |
| 12 | LOOP.md 에 새 surface 행 추가하고 page.svelte 초안 만들어 | {"skills":["shape-product-loop"],"rules":["design-themes","product-loop","theme-ref"]} | {"status":"routed","reason":"1 skills, 1 rules (asked 48 of 48)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Build, change or fix Svelte SPA screens — SvelteK… |
| 13 | toss 테마 design.json 에 새 토큰을 승격해줘 | {"skills":[],"rules":["design-themes"]} | {"status":"routed","reason":"1 skills, 0 rules (asked 48 of 48)","skills":[{"name":"shadcn-svelte","path":"/home/easydev/.agents/skills-routed/build/shadcn-svelte/SKILL.md","description":"Fix or edit Svelte/SvelteKit UI built with shadcn-s… |
| 14 | 라이브 사이트 사이드바를 draft 에 똑같이 포팅하고 padding gap 다시 측정해줘 | {"skills":["shape-product-loop"],"rules":["design-themes","product-loop","theme-ref"]} | {"status":"routed","reason":"3 skills, 1 rules (asked 48 of 48)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Build, change or fix Svelte SPA screens — SvelteK… |
| 15 | 대시보드 화면들 캡처 떠서 라이트 다크 일관성 맞춰줘 | {"skills":[],"rules":["frontend-consistency"]} | {"status":"routed","reason":"3 skills, 1 rules (asked 48 of 48)","skills":[{"name":"browser","path":"/home/easydev/.agents/skills-routed/web/browser/SKILL.md","description":"Fetch, scrape, or render a web page — browser CLI, obscura, Chrom… |
| 16 | 대시보드 UX 정리하고 중복 버튼 지워줘 | {"skills":["improve-ux"],"rules":["frontend-consistency"]} | {"status":"routed","reason":"3 skills, 1 rules (asked 48 of 48)","skills":[{"name":"improve-ux","path":"/home/easydev/.agents/skills-routed/build/improve-ux/SKILL.md","description":"UX cleanup of an existing frontend — dashboard simplifica… |
| 22 | 지난주 pi 세션 jsonl 분석해서 반복 실수 알려줘 | {"skills":["analyze-pi-sessions"],"rules":[]} | {"status":"routed","reason":"3 skills, 0 rules (asked 48 of 48)","skills":[{"name":"analyze-pi-sessions","path":"/home/easydev/.agents/skills-routed/agent-meta/analyze-pi-sessions/SKILL.md","description":"pi 세션 분석 — pi --session, pi sessio… |
| 26 | ASCII 와이어프레임으로 레이아웃 초안 그려줘 | {"skills":["write-ascii-draft"],"rules":[]} | {"status":"routed","reason":"nothing applies (asked 48 of 48)","skills":[],"rules":[],"candidates":48} |
| 29 | ComfyUI 결과 이미지를 1-5점으로 블라인드 평가하는 페이지 만들어줘 | {"skills":["evaluate-image-preference"],"rules":[]} | {"status":"routed","reason":"2 skills, 1 rules (asked 48 of 48)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Build, change or fix Svelte SPA screens — SvelteK… |
| 39 | 고마워! | {"skills":[],"rules":[]} | {"status":"skipped","reason":"acknowledgement","skills":[],"rules":[],"candidates":0} |
| 40 | grade ladder 사다리에서 불필요한 fallback 낭비를 점검해줘 | {"skills":["analyze-grade-waste"],"rules":[]} | {"status":"routed","reason":"0 skills, 2 rules (asked 51 of 51)","skills":[],"rules":[{"name":"provider-errors","path":"/home/easydev/.pi/agent/.agents/rules-routed/provider-errors.md","scope":"project","p":0.87,"body":"# Provider Errors\n… |
| 41 | upstream codex 하네스 프롬프트를 overlay 로 이식하고 SOURCE 핀 갱신해줘 | {"skills":["port-harness"],"rules":[]} | {"status":"routed","reason":"0 skills, 1 rules (asked 51 of 51)","skills":[],"rules":[{"name":"decision-harness-parity","path":"/home/easydev/.agents/rules-routed/decision-harness-parity.md","scope":"global","p":0.54,"body":"# decision: pi… |
