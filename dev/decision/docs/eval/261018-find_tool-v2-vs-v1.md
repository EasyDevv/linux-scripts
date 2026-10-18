# find_tool v2 vs v1

Promotion rule does not hold. This report never promotes; `decision promote find_tool v2` is a separate step.

## Run

- generated: 2026-10-18T03:21:39.984Z
- cases: `/home/easydev/.local/share/scripts/dev/decision/evals/find_tool.jsonl` (26)
- backend: default · ladder openrouter/typesafe/jev-1.14 → opencode/jev-1.13-free → opencode/jev-1.13
- answered 26, unavailable 0, skipped 0, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×26

## Metrics

```text
metric                 v2       v1       Δ
answered            1.000    1.000  +0.000
recall              0.923    0.942  -0.019
precision           0.808    0.929  -0.122
exact               0.577    0.769  -0.192
falseActivation     0.000    0.000  +0.000
coverage            1.000    1.000  +0.000
answered / cases    26/26    26/26
unavailable             0        0
p50 ms                367      373
p95 ms                579      416
cost USD          0.00111  0.00111
calibrated           100%     100%
```

## Promotion rule

```text
promotion rule (v2 vs v1): does not hold
  floor recall ≥ 0.95: 0.923 FAIL
  better on: none
  worse on:  recall, precision, exact
  guard p95 latency ms: 416.0000 → 579.0000 FAIL
  guard cost USD: 0.0011 → 0.0011 ok
  guard calibrated share: 1.0000 → 1.0000 ok
  why not: recall 0.923 < floor 0.95; worse on recall, precision, exact; not better on any metric; p95 579ms > 1.25× baseline 416ms
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v2, first 11)

| # | prompt | expected | got |
|---|---|---|---|
| 1 | What changed in Svelte 5.40 runes? Look up the latest release notes. | ["web_search"] | {"status":"routed","activate":[{"name":"web_search","p":0.68},{"name":"fetch_content","p":0.28},{"name":"get_search_content","p":0}],"done":0.02,"reason":"activate web_search, fetch_content, get_search_content · none 0.02 · needs 0.72 · do… |
| 2 | Read this article and summarize it: https://example.org/blog/post-1 | ["fetch_content"] | {"status":"routed","activate":[{"name":"fetch_content","p":0.99},{"name":"web_search","p":0},{"name":"get_search_content","p":0}],"done":0.02,"reason":"activate fetch_content, web_search, get_search_content · none 0.00 · needs 0.66 · done … |
| 3 | Write a thorough, cited comparison of three vector databases for our use case. | ["deep_research"] | {"status":"routed","activate":[{"name":"deep_research","p":0.59},{"name":"web_search","p":0.32},{"name":"fetch_content","p":0}],"done":0.02,"reason":"activate deep_research, web_search, fetch_content · none 0.00 · needs 0.84 · done 0.02"} |
| 6 | Rename the exported function parseConfig and update every caller; check nothing else broke. | ["lsp_references"] | {"status":"routed","activate":[{"name":"lsp_references","p":0.51},{"name":"lsp_diagnostics","p":0}],"done":0.01,"reason":"activate lsp_references, lsp_diagnostics · none 0.48 · needs 0.12 · done 0.01"} |
| 7 | Why does the TypeScript build report errors in src/api? Show me all diagnostics. | ["lsp_diagnostics"] | {"status":"routed","activate":[{"name":"lsp_diagnostics","p":0.82},{"name":"lsp_references","p":0}],"done":0.02,"reason":"activate lsp_diagnostics, lsp_references · none 0.16 · needs 0.35 · done 0.02"} |
| 13 | Compare the pricing of the two LLM APIs on their current pricing pages. | ["web_search","fetch_content"] | {"status":"routed","activate":[{"name":"fetch_content","p":0.33},{"name":"ask_user_question","p":0.31},{"name":"web_search","p":0.17}],"done":0.02,"reason":"activate fetch_content, ask_user_question, web_search · none 0.00 · needs 0.91 · d… |
| 14 | Summarize the issue thread and then write the fix. | ["fetch_content"] | {"status":"routed","activate":[{"name":"fetch_content","p":0.87},{"name":"web_search","p":0},{"name":"get_search_content","p":0.09}],"done":0.01,"reason":"activate fetch_content, web_search, get_search_content · none 0.01 · needs 0.54 · do… |
| 17 | Look through the notebook analysis.ipynb and fix the plotting cell. | ["NotebookEdit"] | {"status":"routed","activate":[],"done":0.02,"reason":"no extra tool · none 0.57 · needs 0.13 · done 0.02"} |
| 18 | Find every place the Cart type is referenced across the repo and rename it to Basket. | ["LSP","mcp__serena__rename_symbol"] | {"status":"routed","activate":[],"done":0.01,"reason":"no extra tool · none 0.56 · needs 0.10 · done 0.01"} |
| 19 | Look up the current Next.js docs for the new caching options. | ["WebSearch"] | {"status":"routed","activate":[{"name":"WebFetch","p":0.58},{"name":"WebSearch","p":0.41}],"done":0.02,"reason":"activate WebFetch, WebSearch · none 0.01 · needs 0.88 · done 0.02"} |
| 20 | Fetch https://example.org/changelog and list the breaking changes. | ["WebFetch"] | {"status":"routed","activate":[{"name":"WebFetch","p":0.98},{"name":"WebSearch","p":0}],"done":0.01,"reason":"activate WebFetch, WebSearch · none 0.02 · needs 0.79 · done 0.01"} |
