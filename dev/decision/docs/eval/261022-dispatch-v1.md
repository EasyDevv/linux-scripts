# dispatch v1

Promotion rule holds. This report never promotes; `decision promote dispatch v1` is a separate step.

## Run

- generated: 2026-10-22T06:04:29.412Z
- cases: `/home/easydev/.local/share/scripts/dev/decision/evals/dispatch.jsonl` (19)
- backend: default · ladder openrouter/typesafe/jev-1.14
- answered 19, unavailable 0, skipped 0, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×19

## Metrics

```text
metric                 v1
kind                1.000
answered            1.000
mode                1.000
items               1.000
asks                1.000
coverage            1.000
answered / cases    19/19
unavailable             0
p50 ms                407
p95 ms                805
cost USD          0.00107
calibrated           100%
```

## Promotion rule

```text
promotion rule (v1 floor): HOLDS
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.
