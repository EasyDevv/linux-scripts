# find_skill v7 vs v4

Promotion rule does not hold. This report never promotes; `decision promote find_skill v7` is a separate step.

## Run

- generated: 2026-10-23T09:40:11.188Z
- cases: `evals/synthetic/train.jsonl` (24)
- backend: default · ladder openrouter/typesafe/jev-1.14
- answered 24, unavailable 0, skipped 0, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×24

## Metrics

```text
metric                 v7       v4       Δ
answered            1.000    1.000  +0.000
exact               0.458    0.667  -0.208
recall              0.979    0.938  +0.042
precision           0.682    0.826  -0.144
quiet               1.000    1.000  +0.000
coverage            1.000    1.000  +0.000
answered / cases    24/24    24/24
unavailable             0        0
p50 ms                426      778
p95 ms                679     1257
cost USD          0.01025  0.00449
calibrated           100%     100%
```

## Promotion rule

```text
promotion rule (v7 vs v4): does not hold
  floor recall ≥ 0.9: 0.979 ok
  better on: recall
  worse on:  exact, precision
  guard p95 latency ms: 1257.0000 → 679.0000 ok
  guard cost USD: 0.0045 → 0.0103 FAIL
  guard calibrated share: 1.0000 → 1.0000 ok
  why not: worse on exact, precision; cost $0.01025 > baseline $0.00449
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v7, first 13)

| # | prompt | expected | got |
|---|---|---|---|
| 1 | 프로젝트 목록 위에 있는 상태 필터가 15초쯤 지나면 자동으로 '전체'로 돌아가. 폴링이 도는 것 같은데, 고른 값이 유지되게 고쳐줘. | {"skills":["build-frontend"],"rules":["svelte-effects"]} | {"status":"routed","reason":"3 skills, 2 rules (asked 41 of 41)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Shape Svelte SPA screens asked to be built or res… |
| 2 | I moved our settings dialog into its own component and now the build fails with "Cannot find module '$lib/components/ui/select'". The repo uses shadcn-svelte; fix the imports and the component wiring. | {"skills":["shadcn-svelte"],"rules":[]} | {"status":"routed","reason":"2 skills, 2 rules (asked 41 of 41)","skills":[{"name":"shadcn-svelte","path":"/home/easydev/.agents/skills-routed/build/shadcn-svelte/SKILL.md","description":"Fix or edit Svelte/SvelteKit component code with sh… |
| 3 | 예약 화면이랑 설정 화면을 나란히 열어보면 버튼 높이랑 아이콘 정렬이 서로 달라 보여. 두 화면 캡처를 라이트/다크로 비교해서 맞춰줘. | {"skills":["build-frontend"],"rules":["frontend-consistency"]} | {"status":"routed","reason":"3 skills, 2 rules (asked 41 of 41)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Shape Svelte SPA screens asked to be built or res… |
| 4 | 고객용 관리자 페이지에 같은 저장 버튼이 헤더랑 카드 안에 두 개 있어. 중복 컨트롤 정리하고, 바뀐 화면은 캡처로 다시 확인해줘. | {"skills":["improve-ux"],"rules":["frontend-consistency"]} | {"status":"routed","reason":"3 skills, 2 rules (asked 41 of 41)","skills":[{"name":"improve-ux","path":"/home/easydev/.agents/skills-routed/build/improve-ux/SKILL.md","description":"UX cleanup of an existing frontend — dashboard simplifica… |
| 5 | 이 에러 좀 봐줘. 결제 수단 다이얼로그에서 저장 누르면 나오고, 화면은 그대로 멈춰 있어. TypeError: Cannot read properties of null (reading 'focus') at SelectContent.svelte:84:12 at tick (svelte/src/internal/client/runtime.js:512:9) 원인 찾아서 고쳐줘. | {"skills":["bun-webview","shadcn-svelte"],"rules":[]} | {"status":"routed","reason":"2 skills, 1 rules (asked 41 of 41)","skills":[{"name":"shadcn-svelte","path":"/home/easydev/.agents/skills-routed/build/shadcn-svelte/SKILL.md","description":"Fix or edit Svelte/SvelteKit component code with sh… |
| 8 | 매일 밤 청구서 PDF를 내려받는 걸 자동화하고 싶어. 일회성 클릭이 아니라 CI에서 다시 돌릴 수 있는 Bun 스크립트로 만들어줘. 로그인 세션은 이미 9222에 있어. | {"skills":["web-automation"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 41 of 41)","skills":[{"name":"web-automation","path":"/home/easydev/.agents/skills-routed/web/web-automation/SKILL.md","description":"Write reusable Bun TS Chrome/CDP automation scripts… |
| 9 | 지금 크롬 9222에 프로젝트 생성 모달이 떠 있어. '만들기'를 눌렀을 때 모달이 안 닫히는 것 같은데, 그 탭에서 직접 눌러보고 콘솔이랑 상태를 확인해줘. | {"skills":["bun-webview"],"rules":[]} | {"status":"routed","reason":"3 skills, 1 rules (asked 41 of 41)","skills":[{"name":"bun-webview","path":"/home/easydev/.agents/skills-routed/web/bun-webview/SKILL.md","description":"Diagnose a live UI bug with bun-webview — reproduce it in… |
| 11 | 디시 컴퓨터 갤에서 RTX 4090 언급된 글 제목이랑 본문에 적힌 가격만 최근 30개 수집해줘. 댓글은 필요 없어. | {"skills":["browse-site"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 41 of 41)","skills":[{"name":"browse-site","path":"/home/easydev/.agents/skills-routed/web/browse-site/SKILL.md","description":"Site collection — 당근 daangn, 번개장터, 중고나라, 2CPU, 다나와, 디시, R… |
| 12 | 이 Reddit 스레드에 우리 프로젝트 개발자 입장으로 답글 초안 3개만 써줘. 링크는 https://example.invalid/r/example/comments/abc123/thread/ 야. 게시물이랑 댓글은 네가 모아서 판단해. | {"skills":["reddit-reply"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 41 of 41)","skills":[{"name":"reddit-reply","path":"/home/easydev/.agents/skills-routed/web/reddit-reply/SKILL.md","description":"Reddit 답장 초안 — collect a Reddit post and comments, then… |
| 13 | 이번 주 pi 세션들 중에서 tool 에러가 같은 방식으로 반복된 것만 골라 원인 정리해줘. 세션 전체 스캔은 하지 말고 7일로 제한해. | {"skills":["analyze-pi-sessions"],"rules":[]} | {"status":"routed","reason":"3 skills, 0 rules (asked 41 of 41)","skills":[{"name":"analyze-pi-sessions","path":"/home/easydev/.agents/skills-routed/agent-meta/analyze-pi-sessions/SKILL.md","description":"pi 세션 분석 — pi --session, pi sessio… |
| 15 | build-tui 스킬대로 했는데 confirm modal에서 자꾸 키 이벤트만 처리하고 리사이즈를 놓쳐서 두 번 실패했어. 실제로 겪은 실패를 반영해서 SKILL.md를 보강해줘. | {"skills":["improve-skill"],"rules":[]} | {"status":"routed","reason":"3 skills, 0 rules (asked 41 of 41)","skills":[{"name":"improve-skill","path":"/home/easydev/.agents/skills-routed/agent-meta/improve-skill/SKILL.md","description":"Repair a named skill/runbook after its steps f… |
| 19 | 규칙 쪽으로. 담당 파일이랑 description까지 정해서 추가해줘. | {"skills":["write-a-rule"],"rules":[]} | {"status":"routed","reason":"2 skills, 0 rules (asked 41 of 41)","skills":[{"name":"write-a-rule","path":"/home/easydev/.agents/skills-routed/agent-meta/write-a-rule/SKILL.md","description":"Write or revise an agent rule file in ~/.agents/… |
| 20 | 대시보드 홈이랑 프로젝트 목록부터. 둘 다 1440이랑 390으로 라이트/다크 캡처해줘. | {"skills":["build-frontend"],"rules":["frontend-consistency"]} | {"status":"routed","reason":"2 skills, 1 rules (asked 41 of 41)","skills":[{"name":"browser","path":"/home/easydev/.agents/skills-routed/web/browser/SKILL.md","description":"Fetch, scrape, or render a web page — browser CLI, obscura, Chrom… |
