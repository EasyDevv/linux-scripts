# find_skill v9 vs v7

Promotion rule does not hold. This report never promotes; `decision promote find_skill v9` is a separate step.

## Run

- generated: 2026-10-23T09:33:04.946Z
- cases: `evals/synthetic/holdout.jsonl` (16)
- backend: default · ladder openrouter/typesafe/jev-1.14
- answered 16, unavailable 0, skipped 0, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×16

## Metrics

```text
metric                 v9       v7       Δ
answered            1.000    1.000  +0.000
exact               0.438    0.500  -0.063
recall              0.969    0.969  +0.000
precision           0.700    0.721  -0.021
quiet               1.000    1.000  +0.000
coverage            1.000    1.000  +0.000
answered / cases    16/16    16/16
unavailable             0        0
p50 ms                448      418
p95 ms                707      554
cost USD          0.00907  0.00684
calibrated           100%     100%
```

## Promotion rule

```text
promotion rule (v9 vs v7): does not hold
  floor recall ≥ 0.9: 0.969 ok
  better on: none
  worse on:  exact, precision
  guard p95 latency ms: 554.0000 → 707.0000 FAIL
  guard cost USD: 0.0068 → 0.0091 FAIL
  guard calibrated share: 1.0000 → 1.0000 ok
  why not: worse on exact, precision; not better on any metric; p95 707ms > 1.25× baseline 554ms; cost $0.00907 > baseline $0.00684
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v9, first 9)

| # | prompt | expected | got |
|---|---|---|---|
| 1 | apps/server에 upload 라우트를 새로 넣고 서비스를 재시작했는데 웹에서는 계속 400이야. 응답은 {"error":"Unknown operation."}이고, 페이지는 정상으로 보여. 서버 쪽 라우트 등록이랑 실제 응답을 확인해줘. | {"skills":["build-backend","bun-webview"],"rules":[]} | {"status":"routed","reason":"1 skills, 0 rules (asked 41 of 41)","skills":[{"name":"build-backend","path":"/home/easydev/.agents/skills-routed/build/build-backend/SKILL.md","description":"HTTP API + auth — Actix/Rust handlers, login/sessio… |
| 2 | 4090 두 장이랑 3090 네 장 중에 로컬 LLM에서 tok/s당 가격이 어느 쪽이 나은지 중고 시세로 계산해줘. 2CPU랑 당근 가격을 같이 보고, 추정치는 표시해줘. | {"skills":["evaluate-hardware-value","browse-site"],"rules":[]} | {"status":"routed","reason":"3 skills, 0 rules (asked 41 of 41)","skills":[{"name":"evaluate-hardware-value","path":"/home/easydev/.agents/skills-routed/research/evaluate-hardware-value/SKILL.md","description":"Hardware price-performance f… |
| 3 | ~/.claude/projects/-home-easydev-dev-dashboard 아래 세션 5017da19-4f2a-4c1e-9a3b-2c7d8e9f0011에서 같은 권한 에러가 반복됐어. 그 세션만 근거로 원인과 재발 방지책 정리해줘. | {"skills":["analyze-claude-sessions"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 41 of 41)","skills":[{"name":"analyze-claude-sessions","path":"/home/easydev/.agents/skills-routed/agent-meta/analyze-claude-sessions/SKILL.md","description":"Claude Code 세션 분석 — sessio… |
| 4 | 최근 7일 decision 로그에서 find_skill이 frontend-consistency를 계속 놓쳤어. Find the prompts where it missed and fix the rule description or path glob. | {"skills":["improve-decision-workflow"],"rules":[]} | {"status":"routed","reason":"3 skills, 0 rules (asked 41 of 41)","skills":[{"name":"improve-decision-workflow","path":"/home/easydev/.agents/skills-routed/agent-meta/improve-decision-workflow/SKILL.md","description":"decision daemon misses… |
| 5 | 라우티드 규칙으로 'DB 마이그레이션은 항상 백업을 먼저 뜨고 실행한다'를 추가해줘. 어느 디렉터리에 어떤 description으로 둘지도 정해줘. | {"skills":["write-a-rule"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 41 of 41)","skills":[{"name":"write-a-rule","path":"/home/easydev/.agents/skills-routed/agent-meta/write-a-rule/SKILL.md","description":"Write or revise an agent rule file in ~/.agents/… |
| 6 | ~/.local/share/scripts/dev/init-server/deploy.py에 podman 배포용 plan/--apply 단계를 추가해줘. 기본은 plan만 출력하고, SSH는 기존 ControlMaster를 재사용하게. | {"skills":["write-server-script"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 41 of 41)","skills":[{"name":"write-server-script","path":"/home/easydev/.agents/skills-routed/build/write-server-script/SKILL.md","description":"Operator server scripts — init-server, … |
| 7 | ~/.local/share/scripts/dev/db-sync에 스냅샷 고르는 화살표 메뉴를 넣고, --help를 카테고리별로 묶어줘. 넘버 메뉴는 없애고. | {"skills":["build-terminal-script"],"rules":[]} | {"status":"routed","reason":"3 skills, 1 rules (asked 41 of 41)","skills":[{"name":"build-terminal-script","path":"/home/easydev/.agents/skills-routed/build/build-terminal-script/SKILL.md","description":"Terminal CLI scripts (터미널 스크립트, CLI… |
| 11 | 카드 그리드로. 빈 상태 문구도 같이 넣어줘. | {"skills":["build-frontend"],"rules":[]} | {"status":"routed","reason":"3 skills, 2 rules (asked 41 of 41)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Shape Svelte SPA screens asked to be built or res… |
| 12 | 응, 그리드 켜고 같은 시드끼리 나란히 보이게 해줘. 점수는 1-5 그대로. | {"skills":["evaluate-image-preference"],"rules":[]} | {"status":"routed","reason":"2 skills, 2 rules (asked 41 of 41)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Shape Svelte SPA screens asked to be built or res… |
