# find_tool v5 vs v1

Promotion rule does not hold. This report never promotes; `decision promote find_tool v5` is a separate step.

## Run

- generated: 2026-10-23T09:34:04.258Z
- cases: `evals/synthetic/tool-holdout.jsonl` (8)
- backend: default · ladder openrouter/typesafe/jev-1.14
- answered 8, unavailable 0, skipped 0, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×8

## Metrics

```text
metric                 v5       v1       Δ
answered            1.000    1.000  +0.000
recall              0.938    0.938  +0.000
precision           0.813    1.000  -0.188
exact               0.625    0.875  -0.250
falseActivation     0.000    0.000  +0.000
coverage            1.000    1.000  +0.000
answered / cases      8/8      8/8
unavailable             0        0
p50 ms                379      364
p95 ms                409      377
cost USD          0.00035  0.00034
calibrated           100%     100%
```

## Promotion rule

```text
promotion rule (v5 vs v1): does not hold
  floor recall ≥ 0.95: 0.938 FAIL
  better on: none
  worse on:  precision, exact
  guard p95 latency ms: 377.0000 → 409.0000 ok
  guard cost USD: 0.0003 → 0.0004 ok
  guard calibrated share: 1.0000 → 1.0000 ok
  why not: recall 0.938 < floor 0.95; worse on precision, exact; not better on any metric
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v5, first 3)

| # | prompt | expected | got |
|---|---|---|---|
| 2 | 첫 번째 결과 열어서 Svelte 5.40 breaking changes 섹션만 요약해줘. | ["fetch_content"] | {"status":"routed","activate":[{"name":"fetch_content","p":0.79},{"name":"browser_navigate","p":0.14}],"done":0.02,"reason":"activate fetch_content, browser_navigate · none 0.01 · needs 0.67 · done 0.02"} |
| 3 | Sentry에서 이 이벤트가 올라왔는데 v2.8 이후로 알려진 버그인지 확인하고, 관련 이슈 본문까지 읽어서 임시 우회책 정리해줘. ```json {"event_id":"9f2c1a","level":"error","message":"TypeError: Cannot read properties of undefined (reading 'retryAfter')","release":"api@2.8.3","stack":"at backoff (src/http/retry.ts:57:21)"} ``` | ["web_search","fetch_content"] | {"status":"routed","activate":[{"name":"web_search","p":0.63},{"name":"deep_research","p":0.12}],"done":0.02,"reason":"activate web_search, deep_research · none 0.03 · needs 0.90 · done 0.02"} |
| 6 | PR 설명에 넣을 링크가 살아있는지 확인해줘. https://example.invalid/docs/retry-policy랑 https://example.invalid/docs/backoff 둘 다. | ["fetch_content"] | {"status":"routed","activate":[{"name":"fetch_content","p":0.84},{"name":"browser_navigate","p":0.14}],"done":0.01,"reason":"activate fetch_content, browser_navigate · none 0.02 · needs 0.88 · done 0.01"} |
