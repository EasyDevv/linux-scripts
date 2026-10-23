# find_tool v4 vs v1

Promotion rule does not hold. This report never promotes; `decision promote find_tool v4` is a separate step.

## Run

- generated: 2026-10-23T09:33:45.244Z
- cases: `evals/synthetic/tool-holdout.jsonl` (8)
- backend: default · ladder openrouter/typesafe/jev-1.14
- answered 8, unavailable 0, skipped 0, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×8

## Metrics

```text
metric                 v4       v1       Δ
answered            1.000    1.000  +0.000
recall              0.938    0.938  +0.000
precision           1.000    0.938  +0.063
exact               0.875    0.750  +0.125
falseActivation     0.000    0.000  +0.000
coverage            1.000    1.000  +0.000
answered / cases      8/8      8/8
unavailable             0        0
p50 ms                379      373
p95 ms                509      429
cost USD          0.00035  0.00034
calibrated           100%     100%
```

## Promotion rule

```text
promotion rule (v4 vs v1): does not hold
  floor recall ≥ 0.95: 0.938 FAIL
  better on: precision, exact
  worse on:  none
  guard p95 latency ms: 429.0000 → 509.0000 ok
  guard cost USD: 0.0003 → 0.0004 ok
  guard calibrated share: 1.0000 → 1.0000 ok
  why not: recall 0.938 < floor 0.95
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v4, first 1)

| # | prompt | expected | got |
|---|---|---|---|
| 3 | Sentry에서 이 이벤트가 올라왔는데 v2.8 이후로 알려진 버그인지 확인하고, 관련 이슈 본문까지 읽어서 임시 우회책 정리해줘. ```json {"event_id":"9f2c1a","level":"error","message":"TypeError: Cannot read properties of undefined (reading 'retryAfter')","release":"api@2.8.3","stack":"at backoff (src/http/retry.ts:57:21)"} ``` | ["web_search","fetch_content"] | {"status":"routed","activate":[{"name":"web_search","p":0.64}],"done":0.01,"reason":"activate web_search · none 0.02 · needs 0.90 · done 0.01"} |
