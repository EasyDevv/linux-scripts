# find_tool v4 vs v1

Promotion rule does not hold. This report never promotes; `decision promote find_tool v4` is a separate step.

## Run

- generated: 2026-10-23T09:33:55.409Z
- cases: `evals/find_tool.jsonl` (26)
- backend: default · ladder openrouter/typesafe/jev-1.14
- answered 26, unavailable 0, skipped 0, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×26

## Metrics

```text
metric                 v4       v1       Δ
answered            1.000    1.000  +0.000
recall              0.865    0.923  -0.058
precision           0.917    0.917  +0.000
exact               0.692    0.769  -0.077
falseActivation     0.000    0.000  +0.000
coverage            1.000    1.000  +0.000
answered / cases    26/26    26/26
unavailable             0        0
p50 ms                371      368
p95 ms                500      408
cost USD          0.00115  0.00111
calibrated           100%     100%
```

## Promotion rule

```text
promotion rule (v4 vs v1): does not hold
  floor recall ≥ 0.95: 0.865 FAIL
  better on: none
  worse on:  recall, exact
  guard p95 latency ms: 408.0000 → 500.0000 ok
  guard cost USD: 0.0011 → 0.0012 ok
  guard calibrated share: 1.0000 → 1.0000 ok
  why not: recall 0.865 < floor 0.95; worse on recall, exact; not better on any metric
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v4, first 8)

| # | prompt | expected | got |
|---|---|---|---|
| 1 | What changed in Svelte 5.40 runes? Look up the latest release notes. | ["web_search"] | {"status":"routed","activate":[{"name":"web_search","p":0.73},{"name":"fetch_content","p":0.23}],"done":0.02,"reason":"activate web_search, fetch_content · none 0.02 · needs 0.69 · done 0.02"} |
| 3 | Write a thorough, cited comparison of three vector databases for our use case. | ["deep_research"] | {"status":"routed","activate":[{"name":"deep_research","p":0.59},{"name":"web_search","p":0.32}],"done":0.02,"reason":"activate deep_research, web_search · none 0.00 · needs 0.85 · done 0.02"} |
| 8 | Open our staging site and check that the login page renders correctly. | ["browser_navigate","browser_screenshot"] | {"status":"routed","activate":[{"name":"browser_navigate","p":0.87}],"done":0.01,"reason":"activate browser_navigate · none 0.00 · needs 0.95 · done 0.01"} |
| 13 | Compare the pricing of the two LLM APIs on their current pricing pages. | ["web_search","fetch_content"] | {"status":"routed","activate":[{"name":"ask_user_question","p":0.3},{"name":"fetch_content","p":0.28},{"name":"browser_navigate","p":0.21}],"done":0.02,"reason":"activate ask_user_question, fetch_content, browser_navigate · none 0.00 · nee… |
| 16 | Show me a screenshot of the dashboard after the CSS change. | ["browser_screenshot","browser_navigate"] | {"status":"routed","activate":[{"name":"browser_screenshot","p":0.78}],"done":0.02,"reason":"activate browser_screenshot · none 0.01 · needs 0.88 · done 0.02"} |
| 17 | Look through the notebook analysis.ipynb and fix the plotting cell. | ["NotebookEdit"] | {"status":"routed","activate":[],"done":0.02,"reason":"no extra tool · none 0.56 · needs 0.15 · done 0.02"} |
| 18 | Find every place the Cart type is referenced across the repo and rename it to Basket. | ["LSP","mcp__serena__rename_symbol"] | {"status":"routed","activate":[],"done":0.01,"reason":"no extra tool · none 0.67 · needs 0.35 · done 0.01"} |
| 19 | Look up the current Next.js docs for the new caching options. | ["WebSearch"] | {"status":"routed","activate":[{"name":"WebFetch","p":0.5},{"name":"WebSearch","p":0.48}],"done":0.02,"reason":"activate WebFetch, WebSearch · none 0.02 · needs 0.88 · done 0.02"} |
