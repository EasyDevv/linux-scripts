# orchestrator v1

Promotion rule holds. This report never promotes; `decision promote orchestrator v1` is a separate step.

## Run

- generated: 2026-10-18T03:20:05.367Z
- cases: `/home/easydev/.local/share/scripts/dev/decision/evals/orchestrator.jsonl` (24)
- backend: default · ladder openrouter/typesafe/jev-1.14 → opencode/jev-1.13-free → opencode/jev-1.13
- answered 24, unavailable 0, skipped 0, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×24

## Metrics

```text
metric                 v1
answered            1.000
plan                0.917
roleRecall          0.938
rolePrecision       0.757
coverage            1.000
answered / cases    24/24
unavailable             0
p50 ms                376
p95 ms                579
cost USD          0.00097
calibrated           100%
```

## Promotion rule

```text
promotion rule (v1 floor): HOLDS
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v1, first 13)

| # | prompt | expected | got |
|---|---|---|---|
| 2 | Map how auth, billing and notifications each handle retries and report what you find. | {"plan":"fanout","roles":["shared-sub-explore"]} | {"status":"routed","plan":"fanout","worthParallel":0.75,"steps":[{"role":"shared-sub-explore","p":0.93},{"role":"shared-sub-general","p":0.9}],"reason":"fanout · parallel 0.75 · shared-sub-explore 0.93 → shared-sub-general 0.90"} |
| 3 | Investigate why the nightly export is flaky, then fix it, then verify with the test suite. | {"plan":"staged","roles":["shared-sub-explore","shared-sub-general"]} | {"status":"routed","plan":"staged","worthParallel":0.3,"steps":[{"role":"shared-sub-general","p":0.92},{"role":"shared-sub-explore","p":0.89},{"role":"shared-sub-debug","p":0.79}],"reason":"staged · parallel 0.30 · shared-sub-general 0.92 … |
| 4 | Three rounds of patches did not stop the race condition in the job queue; find the root cause. | {"plan":"single","roles":["shared-sub-debug"]} | {"status":"routed","plan":"staged","worthParallel":0.3,"steps":[{"role":"shared-sub-explore","p":0.86},{"role":"shared-sub-general","p":0.86},{"role":"shared-sub-debug","p":0.84}],"reason":"staged · parallel 0.30 · shared-sub-explore 0.86 … |
| 6 | Migrate packages a, b and c from the old logger to the new one; they are independent. | {"plan":"fanout","roles":["shared-sub-general"]} | {"status":"routed","plan":"fanout","worthParallel":0.64,"steps":[{"role":"shared-sub-general","p":0.91},{"role":"shared-sub-explore","p":0.68}],"reason":"fanout · parallel 0.64 · shared-sub-general 0.91 → shared-sub-explore 0.68"} |
| 10 | Reproduce the crash, bisect the offending change, patch it, and re-run the regression tests. | {"plan":"staged","roles":["shared-sub-debug","shared-sub-general"]} | {"status":"routed","plan":"staged","worthParallel":0.36,"steps":[{"role":"shared-sub-general","p":0.93},{"role":"shared-sub-debug","p":0.85},{"role":"shared-sub-explore","p":0.79}],"reason":"staged · parallel 0.36 · shared-sub-general 0.93… |
| 14 | Plan the migration of our REST layer to GraphQL. | {"plan":"staged","roles":["Explore","Plan"]} | {"status":"routed","plan":"staged","worthParallel":0.67,"steps":[{"role":"Plan","p":0.94},{"role":"general-purpose","p":0.86},{"role":"Explore","p":0.76}],"reason":"staged · parallel 0.67 · Plan 0.94 → general-purpose 0.86 → Explore 0.76"} |
| 16 | Investigate the three failing CI jobs independently and fix each. | {"plan":"fanout","roles":["general-purpose"]} | {"status":"routed","plan":"fanout","worthParallel":0.71,"steps":[{"role":"general-purpose","p":0.89},{"role":"Explore","p":0.7},{"role":"Plan","p":0.66}],"reason":"fanout · parallel 0.71 · general-purpose 0.89 → Explore 0.70 → Plan 0.66"} |
| 17 | Design the approach for adding multi-tenancy, then implement it, then verify. | {"plan":"staged","roles":["Plan","general-purpose"]} | {"status":"routed","plan":"staged","worthParallel":0.54,"steps":[{"role":"Plan","p":0.92},{"role":"general-purpose","p":0.91},{"role":"Explore","p":0.57}],"reason":"staged · parallel 0.54 · Plan 0.92 → general-purpose 0.91 → Explore 0.57"} |
| 20 | Draft an implementation plan for the new billing page; read the existing screens first. | {"plan":"staged","roles":["Explore","Plan"]} | {"status":"routed","plan":"staged","worthParallel":0.25,"steps":[{"role":"Plan","p":0.93},{"role":"Explore","p":0.82},{"role":"general-purpose","p":0.75}],"reason":"staged · parallel 0.25 · Plan 0.93 → Explore 0.82 → general-purpose 0.75"} |
| 21 | Update the copyright year in the footer. | {"plan":"single","roles":["general-purpose"]} | {"status":"routed","plan":"single","worthParallel":0.05,"steps":[{"role":"Explore","p":0.52}],"reason":"single · parallel 0.05 · Explore 0.52"} |
| 22 | Research how five different modules handle errors, one agent per module. | {"plan":"fanout","roles":["shared-sub-explore"]} | {"status":"routed","plan":"fanout","worthParallel":0.77,"steps":[{"role":"shared-sub-explore","p":0.89},{"role":"shared-sub-general","p":0.87}],"reason":"fanout · parallel 0.77 · shared-sub-explore 0.89 → shared-sub-general 0.87"} |
| 23 | Our fix attempts keep failing the same assertion; get a fresh diagnosis and then apply the new approach. | {"plan":"staged","roles":["shared-sub-debug","shared-sub-general"]} | {"status":"routed","plan":"staged","worthParallel":0.22,"steps":[{"role":"shared-sub-general","p":0.84},{"role":"shared-sub-debug","p":0.8},{"role":"shared-sub-explore","p":0.68}],"reason":"staged · parallel 0.22 · shared-sub-general 0.84 … |
| 24 | Explore the monorepo layout and propose where a new package should live. | {"plan":"staged","roles":["Explore","Plan"]} | {"status":"routed","plan":"single","worthParallel":0.25,"steps":[{"role":"Explore","p":0.9}],"reason":"single · parallel 0.25 · Explore 0.90"} |
