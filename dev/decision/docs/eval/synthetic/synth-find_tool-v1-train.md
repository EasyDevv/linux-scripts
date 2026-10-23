# find_tool v1

Promotion rule does not hold. This report never promotes; `decision promote find_tool v1` is a separate step.

## Run

- generated: 2026-10-23T09:24:16.805Z
- cases: `evals/synthetic/tool-train.jsonl` (12)
- backend: default · ladder openrouter/typesafe/jev-1.14
- answered 12, unavailable 0, skipped 0, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×12

## Metrics

```text
metric                 v1
answered            1.000
recall              0.708
precision           1.000
exact               0.583
falseActivation     0.000
coverage            1.000
answered / cases    12/12
unavailable             0
p50 ms                374
p95 ms                657
cost USD          0.00050
calibrated           100%
```

## Promotion rule

```text
promotion rule (v1 floor): does not hold
  floor recall ≥ 0.95: 0.708 FAIL
  why not: recall 0.708 < floor 0.95
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v1, first 5)

| # | prompt | expected | got |
|---|---|---|---|
| 2 | NVIDIA 드라이버 설치 스크립트를 sudo로 돌려야 하는데 중간에 라이선스 동의를 물어봐. 설치 마저 진행해주고, 끝나면 이번 달 권장 드라이버 버전도 웹에서 확인해줘. | ["interactive_shell","web_search"] | {"status":"routed","activate":[{"name":"interactive_shell","p":0.87}],"done":0.01,"reason":"activate interactive_shell · none 0.04 · needs 0.77 · done 0.01"} |
| 3 | 14군데 호출부 전부 새 시그니처에 맞게 바꿔줘. 시그니처는 (config, options) 두 인자로 바뀌었어. | ["lsp_references"] | {"status":"routed","activate":[],"done":0.02,"reason":"no extra tool · none 0.94 · needs 0.06 · done 0.02"} |
| 7 | Have a subagent bisect which commit broke the payments test, but ask me first whether to bisect against staging fixtures or the production snapshot. | ["subagent","ask_user_question"] | {"status":"routed","activate":[{"name":"ask_user_question","p":0.98}],"done":0.01,"reason":"activate ask_user_question · none 0.01 · needs 0.79 · done 0.01"} |
| 10 | analysis.ipynb에서 CSV 읽는 셀이 깨져. 그 셀 고치고, 고친 뒤에 타입 에러 남는지도 확인해줘. | ["NotebookEdit","LSP"] | {"status":"routed","activate":[{"name":"NotebookEdit","p":0.75}],"done":0.02,"reason":"activate NotebookEdit · none 0.25 · needs 0.25 · done 0.02"} |
| 11 | 새로 만든 useCart 훅이 어디서 쓰이는지 보고 싶어. 타입 에러 목록 말고, 사용처만 알려줘. | ["lsp_references"] | {"status":"routed","activate":[],"done":0.02,"reason":"no extra tool · none 0.49 · needs 0.07 · done 0.02"} |
