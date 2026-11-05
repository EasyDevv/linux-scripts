# find_skill v7

Promotion rule holds. This report never promotes; `decision promote find_skill v7` is a separate step.

## Run

- generated: 2026-11-04T15:59:47.314Z
- cases: `/tmp/claude-1000/-home-easydev--local-share-scripts/34d9a19b-c4f3-4474-aaa1-2b70aaf3e4a7/scratchpad/fs-delegate.jsonl` (23)
- backend: default · ladder openrouter/typesafe/jev-1.14
- answered 23, unavailable 0, skipped 0, invalid 0
- backends used: openrouter/typesafe/jev-1.14 ×23

## Metrics

```text
metric                 v7
answered            1.000
exact               0.348
recall              0.957
precision           0.658
delegate            1.000
coverage            1.000
answered / cases    23/23
unavailable             0
p50 ms                460
p95 ms                635
cost USD          0.01384
calibrated           100%
```

## Promotion rule

```text
promotion rule (v7 floor): HOLDS
  floor recall ≥ 0.9: 0.957 ok
```

Rule: clears the feature floor, better on one metric, worse on none; p95 latency within 1.25×, cost within 1.1×, calibrated share within 0.05.

## Misses (v7, first 15)

| # | prompt | expected | got |
|---|---|---|---|
| 1 | svelte 컴포넌트에서 $effect가 몇 초마다 리셋돼 | {"skills":["build-frontend"],"rules":["frontend-consistency","svelte-effects"],"delegate":{}} | {"status":"routed","reason":"nothing applies (asked 51 of 51)","skills":[],"rules":[],"candidates":51} |
| 2 | 당근에서 RTX 3090 시세 수집해줘 | {"skills":["browse-site"],"rules":[],"delegate":{"browse-site":"quick"}} | {"status":"routed","reason":"3 skills, 0 rules (asked 51 of 51)","skills":[{"name":"browse-site","path":"/home/easydev/.agents/skills-routed/web/browse-site/SKILL.md","description":"Site collection — 당근 daangn, 번개장터, 중고나라, 2CPU, 다나와, 디시, R… |
| 3 | CGV 용산 취소표 좌석 확인해줘 | {"skills":["browse-site"],"rules":[],"delegate":{"browse-site":"quick"}} | {"status":"routed","reason":"3 skills, 0 rules (asked 51 of 51)","skills":[{"name":"browse-site","path":"/home/easydev/.agents/skills-routed/web/browse-site/SKILL.md","description":"Site collection — 당근 daangn, 번개장터, 중고나라, 2CPU, 다나와, 디시, R… |
| 4 | Collect the top posts from this Reddit thread and summarize | {"skills":["browse-site"],"rules":[],"delegate":{"browse-site":"quick"}} | {"status":"routed","reason":"2 skills, 0 rules (asked 51 of 51)","skills":[{"name":"browse-site","path":"/home/easydev/.agents/skills-routed/web/browse-site/SKILL.md","description":"Site collection — 당근 daangn, 번개장터, 중고나라, 2CPU, 다나와, 디시, R… |
| 5 | 로그인이 필요한 페이지를 로그인 세션 저장해서 읽어와줘 | {"skills":["browser"],"rules":[],"delegate":{"browser":"quick"}} | {"status":"routed","reason":"3 skills, 0 rules (asked 51 of 51)","skills":[{"name":"browser","path":"/home/easydev/.agents/skills-routed/web/browser/SKILL.md","description":"Fetch, scrape, or render a web page with the `browser` CLI (headl… |
| 7 | {"url":"/projects","src":"apps/client/src/routes/projects/+page.svelte:L2162","xpath":"//div[contains(@class,'board-main') and contains(@class,'flex') and contains(@class,'min-w-0')]","task":"기본적으로 좌우 스플릿으로 구성\n\n터미널 bar 가 위로"} 를 dashboard 의 chat 창에 입력시 에러 발생. | {"skills":["bun-webview","shadcn-svelte"],"rules":["cmd.executor","stack-svelte-tauri"],"delegate":{"bun-webview":"quic… | {"status":"routed","reason":"3 skills, 2 rules (asked 65 of 67)","skills":[{"name":"build-frontend","path":"/home/easydev/.agents/skills-routed/build/build-frontend/SKILL.md","description":"Builds and fixes Svelte SPA screens. Use when bui… |
| 8 | 1번, bun-webview 로 실제 수행해보고 판단 | {"skills":["bun-webview"],"rules":[],"delegate":{"bun-webview":"quick"}} | {"status":"routed","reason":"3 skills, 0 rules (asked 67 of 67)","skills":[{"name":"control-android","path":"/home/easydev/.agents/skills-routed/system/control-android/SKILL.md","description":"Drive a real phone or an Android emulator over… |
| 10 | 이제 실제 폰에서 dry run 을 돌려 확인해 보자. | {"skills":["control-android"],"rules":[],"delegate":{"control-android":"quick"}} | {"status":"routed","reason":"3 skills, 0 rules (asked 63 of 63)","skills":[{"name":"control-android","path":"/home/easydev/.agents/skills-routed/system/control-android/SKILL.md","description":"Drive a real phone or an Android emulator over… |
| 11 | 35211 포트에서 열림. 다시 시도 | {"skills":["control-android"],"rules":[],"delegate":{"control-android":"quick"}} | {"status":"routed","reason":"1 skills, 1 rules (asked 63 of 63)","skills":[{"name":"control-android","path":"/home/easydev/.agents/skills-routed/system/control-android/SKILL.md","description":"Drive a real phone or an Android emulator over… |
| 13 | 에뮬레이터 띄우고 앱 실행해서 입력창에 한글이 제대로 들어가는지 테스트해줘 | {"skills":["control-android"],"rules":[],"delegate":{"control-android":"quick"}} | {"status":"routed","reason":"3 skills, 0 rules (asked 63 of 63)","skills":[{"name":"control-android","path":"/home/easydev/.agents/skills-routed/system/control-android/SKILL.md","description":"Drive a real phone or an Android emulator over… |
| 15 | Run the macro on my phone and screenshot the result to verify it | {"skills":["control-android"],"rules":[],"delegate":{"control-android":"quick"}} | {"status":"routed","reason":"2 skills, 0 rules (asked 63 of 63)","skills":[{"name":"control-android","path":"/home/easydev/.agents/skills-routed/system/control-android/SKILL.md","description":"Drive a real phone or an Android emulator over… |
| 16 | 스크린샷이 어둡게 나와. 폰에 깔린 조광기 오버레이가 원인인지 adb 로 확인해줘 | {"skills":["control-android"],"rules":[],"delegate":{"control-android":"quick"}} | {"status":"routed","reason":"2 skills, 0 rules (asked 63 of 63)","skills":[{"name":"control-android","path":"/home/easydev/.agents/skills-routed/system/control-android/SKILL.md","description":"Drive a real phone or an Android emulator over… |
| 17 | uiautomator dump 로 현재 화면 요소 좌표 뽑아서 확인 버튼 눌러봐 | {"skills":["control-android"],"rules":[],"delegate":{"control-android":"quick"}} | {"status":"routed","reason":"2 skills, 0 rules (asked 63 of 63)","skills":[{"name":"control-android","path":"/home/easydev/.agents/skills-routed/system/control-android/SKILL.md","description":"Drive a real phone or an Android emulator over… |
| 18 | 실제 기기에서 한번 돌려보고 결과 알려줘 | {"skills":["control-android"],"rules":[],"delegate":{"control-android":"quick"}} | {"status":"routed","reason":"2 skills, 0 rules (asked 63 of 63)","skills":[{"name":"control-android","path":"/home/easydev/.agents/skills-routed/system/control-android/SKILL.md","description":"Drive a real phone or an Android emulator over… |
| 22 | 앱이 폰에 설치돼 있는지 보고 실행해서 logcat 에러 확인해줘 | {"skills":["control-android"],"rules":[],"delegate":{"control-android":"quick"}} | {"status":"routed","reason":"2 skills, 1 rules (asked 63 of 63)","skills":[{"name":"control-android","path":"/home/easydev/.agents/skills-routed/system/control-android/SKILL.md","description":"Drive a real phone or an Android emulator over… |
