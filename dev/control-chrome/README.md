# control-chrome

Chromium 실행, 종료, 탭 조회, CDP 호출용 커맨드 모음.

## Defaults

- binary: `chromium`
- 기본 상태: KDE Wayland에서는 `open` 후 minimized, 그 외 normal (`--normal`로 일반 창, `--minimize`로 강제 최소화)
- profile: 9222(기본 포트)는 `~/.cache/chrome-debug-profile/9222`, 그 외는 `./.user-data/chrome-{name}`
- WXT dev port 예시: `39225`

## Commands

### Open

```bash
control-chrome open
control-chrome open --port 39225
control-chrome open --binary /path/to/chromium --port 39225
control-chrome open --port 39225 --normal
```

### Close

```bash
control-chrome close
control-chrome close --port 39225
```

`open` (existing tab) and `close` auto-accept native `beforeunload` / confirm dialogs so noVNC "leave site?" does not stall CDP.

### Status

```bash
control-chrome status
control-chrome status --port 39225
```

### Minimize

```bash
control-chrome minimize
control-chrome minimize --port 39225
```

### List

```bash
control-chrome list
control-chrome list --json
```

실행 중인 모든 CDP 브라우저(서비스 포함)를 `:포트 · 프로필 · 첫 탭`으로 출력. 창은 포트별 시작 페이지(`CDP <port>`), app_id `cdp-<port>`, 포트 고정 테마 색으로 구분.

### Tabs

```bash
control-chrome tabs
control-chrome tabs --port 39225
control-chrome tabs --port 39225 --json
```

### CDP

```bash
control-chrome cdp Target.getTargets
control-chrome cdp Browser.getVersion --port 39225
```

### Open Extension

```bash
control-chrome open-extension "sandbox-wxt" --port 39225 --page popup.html
control-chrome open-extension "sandbox-wxt" --port 39225 --page options.html
```

## WXT Example

작업 디렉터리: `/home/easydev/dev/sandbox/sandbox-wxt`

```bash
bun run check
bun run build
wxtu dev chrome
control-chrome open-extension "sandbox-wxt" --port 39225 --page popup.html
control-chrome tabs --port 39225 --json
control-chrome close --port 39225
```

## Files

- launch metadata: `.user-data/chrome-sandbox-wxt/.control-chrome-launch.json`
- detached log: `.user-data/logs/dev-chrome.log`
