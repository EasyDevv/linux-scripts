# browser

obscura(읽기·추출)와 Chromium(렌더·측정·캡처·확장·사람 확인·로그인)을 묶은 CLI. `browser --help` → `browser <command> --help` 순으로 내려간다.

## 엔진 선택

| 작업 | 엔진 | 명령 |
| --- | --- | --- |
| 페이지 텍스트/마크다운/링크, JS 값 하나 | obscura `--stealth` | `browser fetch <url>` |
| Playwright/Puppeteer가 붙을 CDP | obscura | `browser serve` (9300+) |
| 로그인 | Chromium(사람) | `browser login <url>` |
| 스크린샷, 레이아웃 측정, 클릭, 확장 | Chromium | `browser open` + bun-webview |

obscura에는 레이아웃·페인트 엔진이 없다: 스크린샷, `getBoundingClientRect`, 클릭 좌표는 Chromium으로.

## 세션과 프로필

- 세션: `~/.local/share/browser/sessions/<name>/cookies.json` (dir 0700, file 0600). obscura `--storage-dir` 형식 그대로다.
- 전역 프로필: `~/.cache/browser/profiles/<port>` (9222, chrome.service의 9201). 지워도 되는 캐시다.
  - `open`: 프로필 폴더가 새로 생길 때만 같은 이름의 세션 쿠키를 넣는다. `profiles.json`의 unpacked 확장을 항상 `--load-extension`으로 붙인다.
  - `close`, `login`: 쿠키를 세션으로 내보낸다.
- 프로젝트 프로필: 그 외 포트는 `./.user-data/chrome-{package name}` (세션 자동 연결 없음, `--session`으로 명시).
- `~/.local/share/browser/profiles.json`: `{ "9222": { "extensions": ["/abs/unpacked"] } }`

## 로그인

```bash
browser login https://site.example/login            # 9222 프로필 → 세션 9222
browser login https://site.example --cookie li_at    # 완료 조건 명시
browser fetch https://site.example/me --session 9222
```

3초마다 쿠키를 읽어, 페이지를 연 시점에 없던 이름의 인증형 쿠키(httpOnly 또는 auth 계열 이름, 수명 1시간 이상)가 생기고 로그인 탭이 로그인·챌린지 주소를 벗어나면 저장한다. 기본 300초, 시간 초과는 exit 2. 쿠키 값은 출력하지 않는다.
저장 후 `login`이 직접 띄운 Chromium은 닫고, 이미 떠 있던 Chromium이면 로그인 탭만 닫는다.

## 병렬 수집

```bash
browser open --port 9223 --clean --session 9222   # 임시 프로필 + 9222 로그인 쿠키
browser close --port 9223                          # 임시 프로필까지 삭제
```

`--clean` 없이 9222 외 포트를 여러 개 띄우면 같은 `./.user-data/chrome-{name}`을 공유해 잠금에 걸린다.

## Chromium

```bash
browser open [--port 9222] [--url <url>] [--normal|--minimize] [--headless] [--clean] [--session <name>] [--load-extension <dir>] [--android] [--record [N]]
browser close [--port N]
browser list            # obscura와 Chromium 전부. TTY면 j/k 이동, x 닫기(확인 기본 No), enter 탭 출력
browser status | tabs --port N | minimize --port N
browser cdp --port N <Method> [params-json]
browser open-extension "<name>" --port 39225 --page popup.html
```

- 창은 기본 최소화로 열린다(KDE Wayland는 KWin 시작 훅, 그 밖은 CDP 최소화; 에이전트 셸처럼 세션 변수가 없으면 `systemctl --user show-environment`에서 읽는다). 보이는 창은 `--normal`. KDE에서는 작업표시줄이 5초 깜빡인다. 창 구분: 시작 페이지 `CDP <port>`, app_id `cdp-<port>`, 포트별 테마 색. bun-webview는 창을 앞으로 가져오지 않는다.
- `--android`: 포커스 탭에 Pixel 9 UA·터치·412x915 뷰포트와 `navigator.userAgentData`를 적용한다. 새 브라우저와 기존 브라우저 모두에 적용된다.
- `--record [N]`: 포커스 직후부터 백그라운드로 PNG 프레임을 캡처한다. N을 생략하면 `browser close`까지 계속 저장하고, close는 중지 후 캡처 수와 디렉터리를 보고한다. 저장 위치: `~/.cache/browser/state/captures/chrome-<port>-<time>/`.
- `open`(기존 탭)과 `close`는 `beforeunload`/confirm 대화상자를 자동 수락한다.
- 실행 메타데이터: `<profile>/.browser-launch.json`, 포트 잠금: `~/.cache/browser/state/locks`.
- 디스플레이: 비-headless 실행에 `WAYLAND_DISPLAY`/`DISPLAY`가 없으면 `systemctl --user show-environment`에서 빌려온다. 거기에도 없으면 `--headless`를 쓰라는 오류로 멈춘다.
- Chromium이 디버깅 포트를 열기 전에 죽으면 stderr 마지막 10줄을 보여준다. 전체 로그: `/tmp/browser-chrome-<port>.stderr.log`.
- 환경 변수: `BROWSER_CHROMIUM_BIN`(기본 `chromium`), `BROWSER_LOCALE`(기본 `en-US`), `BROWSER_SESSIONS_DIR`, `BROWSER_PROFILES_FILE`.

`~/.local/share/applications/chromium.desktop`은 고정된 **Chromium** 버튼을 `~/.local/usr/bin/chromium-cdp`로 돌린다: 9222가 꺼져 있으면 `browser open --normal`, 켜져 있으면 그 브라우저에 새 창/탭을 넘긴다.

## Test

```bash
bun test
```
