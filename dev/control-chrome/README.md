# control-chrome

Chromium 실행, 종료, 탭 조회, CDP 호출용 커맨드 모음.

## Defaults

- binary: `chromium`
- 기본 상태: `open` 후 normal
- WXT dev port 예시: `39225`

## Commands

### Open

```bash
control-chrome open
control-chrome open --port 39225
control-chrome open --binary /path/to/chromium --port 39225
control-chrome open --port 39225 --minimize
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
