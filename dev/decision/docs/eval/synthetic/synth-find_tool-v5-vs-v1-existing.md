# find_tool v5 vs v1

Promotion rule does not hold. This report never promotes; `decision promote find_tool v5` is a separate step.

## Run

- generated: 2026-10-23T09:34:14.492Z
- cases: `evals/find_tool.jsonl` (26)
- backend: default · ladder openrouter/typesafe/jev-1.14
- answered 26, unavailable 0, skipped 0, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×26

## Metrics

```text
metric                 v5       v1       Δ
answered            1.000    1.000  +0.000
recall              0.885    0.923  -0.038
precision           0.917    0.917  +0.000
exact               0.731    0.769  -0.038
falseActivation     0.000    0.000  +0.000
coverage            1.000    1.000  +0.000
answered / cases    26/26    26/26
unavailable             0        0
p50 ms                369      373
p95 ms                416      412
cost USD          0.00115  0.00111
calibrated           100%     100%
```

## Promotion rule

```text
promotion rule (v5 vs v1): does not hold
  floor recall ≥ 0.95: 0.885 FAIL
  better on: none
  worse on:  recall, exact
  guard p95 latency ms: 412.0000 → 416.0000 ok
  guard cost USD: 0.0011 → 0.0012 ok
  guard calibrated share: 1.0000 → 1.0000 ok
  why not: recall 0.885 < floor 0.95; worse on recall, exact; not better on any metric
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v5, first 7)

| # | prompt | expected | got |
|---|---|---|---|
| 1 | What changed in Svelte 5.40 runes? Look up the latest release notes. | ["web_search"] | {"status":"routed","activate":[{"name":"web_search","p":0.72},{"name":"fetch_content","p":0.25}],"done":0.02,"reason":"activate web_search, fetch_content · none 0.01 · needs 0.70 · done 0.02"} |
| 3 | Write a thorough, cited comparison of three vector databases for our use case. | ["deep_research"] | {"status":"routed","activate":[{"name":"deep_research","p":0.61},{"name":"web_search","p":0.32}],"done":0.01,"reason":"activate deep_research, web_search · none 0.00 · needs 0.83 · done 0.01"} |
| 8 | Open our staging site and check that the login page renders correctly. | ["browser_navigate","browser_screenshot"] | {"status":"routed","activate":[{"name":"browser_navigate","p":0.87}],"done":0.01,"reason":"activate browser_navigate · none 0.00 · needs 0.96 · done 0.01"} |
| 13 | Compare the pricing of the two LLM APIs on their current pricing pages. | ["web_search","fetch_content"] | {"status":"routed","activate":[{"name":"fetch_content","p":0.29},{"name":"ask_user_question","p":0.29},{"name":"browser_navigate","p":0.21}],"done":0.02,"reason":"activate fetch_content, ask_user_question, browser_navigate · none 0.00 · ne… |
| 17 | Look through the notebook analysis.ipynb and fix the plotting cell. | ["NotebookEdit"] | {"status":"routed","activate":[],"done":0.02,"reason":"no extra tool · none 0.55 · needs 0.14 · done 0.02"} |
| 18 | Find every place the Cart type is referenced across the repo and rename it to Basket. | ["LSP","mcp__serena__rename_symbol"] | {"status":"routed","activate":[],"done":0.02,"reason":"no extra tool · none 0.67 · needs 0.39 · done 0.02"} |
| 19 | Look up the current Next.js docs for the new caching options. | ["WebSearch"] | {"status":"routed","activate":[{"name":"WebSearch","p":0.51},{"name":"WebFetch","p":0.47}],"done":0.01,"reason":"activate WebSearch, WebFetch · none 0.02 · needs 0.85 · done 0.01"} |
