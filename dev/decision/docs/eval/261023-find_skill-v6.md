# find_skill v6

Promotion rule does not hold. This report never promotes; `decision promote find_skill v6` is a separate step.

## Run

- generated: 2026-10-23T09:05:54.989Z
- cases: `/tmp/claude-1000/-home-easydev-dev-dashboard/c9be3818-e32b-47e4-aa1b-566319eed5ca/scratchpad/two.jsonl` (2)
- backend: default · ladder openrouter/typesafe/jev-1.14
- answered 2, unavailable 0, skipped 0, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×2

## Metrics

```text
metric                 v6
answered            1.000
exact               0.500
recall              0.875
precision           0.750
coverage            1.000
answered / cases      2/2
unavailable             0
p50 ms                775
p95 ms                855
cost USD          0.00037
calibrated           100%
```

## Promotion rule

```text
promotion rule (v6 floor): does not hold
  floor recall ≥ 0.9: 0.875 FAIL
  why not: recall 0.875 < floor 0.9
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v6, first 1)

| # | prompt | expected | got |
|---|---|---|---|
| 1 | {"url":"/projects","src":"apps/client/src/routes/projects/+page.svelte:L2162","xpath":"//div[contains(@class,'board-main') and contains(@class,'flex') and contains(@class,'min-w-0')]","task":"기본적으로 좌우 스플릿으로 구성\n\n터미널 bar 가 위로"} 를 dashboard 의 chat 창에 입력시 에러 발생. | {"skills":["bun-webview","shadcn-svelte"],"rules":["cmd.executor","stack-svelte-tauri"]} | {"status":"routed","reason":"2 skills, 4 rules (asked 3 of 56)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Shape Svelte SPA screens asked to be built or rest… |
