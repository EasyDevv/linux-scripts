# find_skill v6

Promotion rule holds. This report never promotes; `decision promote find_skill v6` is a separate step.

## Run

- generated: 2026-10-22T03:35:49.490Z
- cases: `/tmp/claude-1000/-home-easydev-dev-dashboard/a3caf080-aa0b-4b48-9f43-a8b8e613e12b/scratchpad/plan-cases.jsonl` (5)
- backend: default · ladder openrouter/typesafe/jev-1.14
- answered 5, unavailable 0, skipped 0, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×5

## Metrics

```text
metric                 v6
answered            1.000
exact               0.800
recall              1.000
precision           0.833
quiet               1.000
coverage            1.000
answered / cases      5/5
unavailable             0
p50 ms                790
p95 ms                869
cost USD          0.00082
calibrated           100%
```

## Promotion rule

```text
promotion rule (v6 floor): HOLDS
  floor recall ≥ 0.9: 1.000 ok
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v6, first 1)

| # | prompt | expected | got |
|---|---|---|---|
| 5 | intent 문서를 plan 에 합치고 결정 바뀐 부분 반영해줘 | {"skills":["write-plan"],"rules":[]} | {"status":"routed","reason":"2 skills, 4 rules (asked 2 of 54)","skills":[{"name":"write-plan","path":"/home/easydev/.agents/skills-routed/writing/write-plan/SKILL.md","description":"Agent-facing plan docs (계획 문서, 기획, docs/plan, plan 갱신) —… |
