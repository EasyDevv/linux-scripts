# find_tool v1

Promotion rule does not hold. This report never promotes; `decision promote find_tool v1` is a separate step.

## Run

- generated: 2026-10-18T03:22:43.747Z
- cases: `/home/easydev/.local/share/scripts/dev/decision/evals/find_tool.jsonl` (26)
- backend: default · ladder openrouter/typesafe/jev-1.14 → opencode/jev-1.13-free → opencode/jev-1.13
- answered 26, unavailable 0, skipped 0, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×26

## Metrics

```text
metric                 v1
answered            1.000
recall              0.904
precision           0.917
exact               0.731
falseActivation     0.000
coverage            1.000
answered / cases    26/26
unavailable             0
p50 ms                375
p95 ms                395
cost USD          0.00111
calibrated           100%
```

## Promotion rule

```text
promotion rule (v1 floor): does not hold
  floor recall ≥ 0.95: 0.904 FAIL
  why not: recall 0.904 < floor 0.95
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v1, first 7)

| # | prompt | expected | got |
|---|---|---|---|
| 1 | What changed in Svelte 5.40 runes? Look up the latest release notes. | ["web_search"] | {"status":"routed","activate":[{"name":"web_search","p":0.75},{"name":"fetch_content","p":0.21}],"done":0.02,"reason":"activate web_search, fetch_content · none 0.02 · needs 0.70 · done 0.02"} |
| 3 | Write a thorough, cited comparison of three vector databases for our use case. | ["deep_research"] | {"status":"routed","activate":[{"name":"deep_research","p":0.59},{"name":"web_search","p":0.33}],"done":0.01,"reason":"activate deep_research, web_search · none 0.00 · needs 0.84 · done 0.01"} |
| 8 | Open our staging site and check that the login page renders correctly. | ["browser_navigate","browser_screenshot"] | {"status":"routed","activate":[{"name":"browser_navigate","p":0.84}],"done":0.01,"reason":"activate browser_navigate · none 0.00 · needs 0.95 · done 0.01"} |
| 13 | Compare the pricing of the two LLM APIs on their current pricing pages. | ["web_search","fetch_content"] | {"status":"routed","activate":[{"name":"ask_user_question","p":0.33},{"name":"fetch_content","p":0.27},{"name":"browser_navigate","p":0.21}],"done":0.02,"reason":"activate ask_user_question, fetch_content, browser_navigate · none 0.00 · ne… |
| 16 | Show me a screenshot of the dashboard after the CSS change. | ["browser_screenshot","browser_navigate"] | {"status":"routed","activate":[{"name":"browser_screenshot","p":0.77}],"done":0.02,"reason":"activate browser_screenshot · none 0.02 · needs 0.84 · done 0.02"} |
| 18 | Find every place the Cart type is referenced across the repo and rename it to Basket. | ["LSP","mcp__serena__rename_symbol"] | {"status":"routed","activate":[],"done":0.01,"reason":"no extra tool · none 0.58 · needs 0.08 · done 0.01"} |
| 19 | Look up the current Next.js docs for the new caching options. | ["WebSearch"] | {"status":"routed","activate":[{"name":"WebSearch","p":0.53},{"name":"WebFetch","p":0.46}],"done":0.02,"reason":"activate WebSearch, WebFetch · none 0.01 · needs 0.89 · done 0.02"} |
