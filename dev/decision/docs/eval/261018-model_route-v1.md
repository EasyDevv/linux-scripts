# model_route v1

Promotion rule holds. This report never promotes; `decision promote model_route v1` is a separate step.

## Run

- generated: 2026-10-18T03:20:08.076Z
- cases: `/home/easydev/.local/share/scripts/dev/decision/evals/model_route.jsonl` (38)
- backend: default · ladder openrouter/typesafe/jev-1.14 → opencode/jev-1.13-free → opencode/jev-1.13
- answered 38, unavailable 0, skipped 0, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×38

## Metrics

```text
metric                 v1
exact               0.842
within1             1.000
answered            1.000
coverage            1.000
answered / cases    38/38
unavailable             0
p50 ms                369
p95 ms                576
cost USD          0.00159
calibrated           100%
```

## Promotion rule

```text
promotion rule (v1 floor): HOLDS
  floor within1 ≥ 0.9: 1.000 ok
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v1, first 6)

| # | prompt | expected | got |
|---|---|---|---|
| 25 | Design an approach for migrating the session store from JSON files to SQLite without losing in-flight sessions. Compare two options and recommend one. | "high" | {"status":"routed","tier":"premium","kind":"plan","demand":2.62,"reason":"plan · complexity 2.27/3 · capability 1.37/3 · reasoning 0.92 → premium"} |
| 26 | tool 호출 결과가 가끔 두 번 렌더링돼. 확장 훅 순서, 이벤트 재진입, 상태 갱신 경로를 추적해서 원인을 찾아줘 | "high" | {"status":"routed","tier":"premium","kind":"debug","demand":2.73,"reason":"debug · complexity 2.02/3 · capability 1.94/3 · reasoning 0.89 → premium"} |
| 27 | Audit the permission rewriter chain for ways a quoted `sudo` could slip past the deny list and propose fixes. | "high" | {"status":"routed","tier":"premium","kind":"review","demand":2.99,"reason":"review · complexity 2.19/3 · capability 2.29/3 · reasoning 0.88 → premium"} |
| 28 | 여러 하네스(pi, Claude Code)가 같은 데몬 로그를 쓰는데, audit에서 세션 id가 겹치지 않게 조인하는 설계를 제안해줘 | "high" | {"status":"routed","tier":"premium","kind":"plan","demand":2.64,"reason":"plan · complexity 2.37/3 · capability 1.31/3 · reasoning 0.86 → premium"} |
| 29 | Refactor the grade ladder walk so remaining-usage skips, cooldowns, and harvest ordering live in one module with a small interface, keeping behavior identical. | "high" | {"status":"routed","tier":"premium","kind":"refactor","demand":2.55,"reason":"refactor · complexity 1.91/3 · capability 1.66/3 · reasoning 0.82 → premium"} |
| 30 | 이 리팩터 PR이 기존 동작을 바꾸는 부분이 있는지 꼼꼼히 리뷰해줘. 테스트가 못 잡는 엣지 케이스 위주로 | "high" | {"status":"routed","tier":"premium","kind":"review","demand":2.52,"reason":"review · complexity 1.47/3 · capability 2.13/3 · reasoning 0.85 → premium"} |
