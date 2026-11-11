# WXT Global Scripts

Global helper scripts for WXT extension projects. `wxtu` is the main entrypoint.
These scripts are used in common by `/home/easydev/dev/extensions/ebook-scroller`,
`/home/easydev/dev/extensions/scroll-detox`, and
`/home/easydev/dev/extensions/dev-selector`.

Browser lifecycle (launch, stop, minimize) is managed by the global
`browser` command. The wrapper scripts in this directory delegate to it.

## Command Roles

- `wxtu dev chrome`: start the Chrome WXT dev server.
- `wxtu dev chrome` forwards unknown flags to `browser open`; use `--` to pass through overlapping flags such as `--port`.
- The dev window loads only the extension under development. A blocker installed by a managed policy holds page loads until its own lists settle, so it — and every other profile extension — stays out unless `WXT_CHROME_KEEP_EXTENSIONS=1` (or `--keep-extensions`) asks for it.
- A run reuses the browser already on the CDP port. `--normal` is a person asking to look at the build, so it leaves that browser alone and opens a separate visible window on the next free port with a `<profile>-view` profile; the dev server's lifecycle stays tied to the original browser.
- `wxtu dev firefox`: start the Firefox WXT dev server.
- `wxtu build`: build Chrome and Firefox bundles in parallel.
- `wxtu zip`: create Chrome and Firefox zip artifacts in parallel.
- `wxtu version`: bump version and package release artifacts.
- `wxtu submit`: submit extension packages to browser stores.
- `wxtu minimize cdp`: minimize a Chromium window via CDP.
- `wxtu minimize kwin`: minimize the active window via KWin.
- `wxtu listing firefox`: fill Firefox Add-on (AMO) listing fields via CDP automation.
- `wxtu listing chrome`: fill Chrome Web Store listing fields.
- `wxtu android emulator`: start an Android emulator with stable defaults.
- `wxtu android firefox install`: build and reinstall the extension on Firefox Android.
- `wxtu android firefox manager`: open Firefox Android's add-ons/settings surface.
- `wxtu android firefox page`: same helper as `manager`, with optional target arguments.

## Internal Files

- `wxtu.mjs`: command router.
- `dev-wxt-utils.mjs`: shared WXT API loader and dev-server arg parser.
- `dev-chrome-wxt.mjs`: Chrome helper that runs WXT in manual-runner mode.
- `dev-firefox-wxt.mjs`: Firefox helper that runs WXT with inline `startUrls` overrides.
- `android-emu.mjs`: Android emulator launcher.
- `android-firefox.mjs`: Firefox Android install and page helpers.
- `run-wxt-targets.mjs`: shared parallel build/zip runner.
