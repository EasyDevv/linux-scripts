# droid CLI contract 2

Callers (android-macro `src/lib/macro/droid.ts`) run `droid` once per command (`spawnSync`) and read
stdout. `droid version --json` prints `{"contract":2}`; a caller that needs more exits.

## Exit codes and output

- 0 ok, 1 usage, 2 condition not met (not on screen, locked, empty dump), 3 device or adb failed.
- `--json`: stdout is exactly one JSON object. Success: `{"ok":true,…fields}` (`emit` in `main.go`).
  Failure: `{"ok":false,"exit":N,"error":"…"}` (`fail` in `main.go`), plus `✗ msg` on stderr.
- Exceptions: `dump` prints the XML itself; `adb` passes adb's stdout, stderr and exit status through.
- Without `--json`, output stays human-readable (one line per result).

## Global flags

- `--serial S`: use this device as is.
- `--model M`: use the ready device whose `ro.product.model` is M. When the same phone is attached
  twice (as `IP:PORT` and as its mdns name), pick the `IP:PORT` one; two different devices with model
  M is exit 3. Without either flag: `$ANDROID_SERIAL`, then the only ready device.
- `--no-look`: tap/key/swipe/type act and return without settling or printing the screen.
- Device identifiers (model, serial, IP, mdns name) are never written to tracked files. The last
  `IP:PORT` lives in `~/.cache/droid/endpoint` (`$DROID_CACHE` overrides the dir, for tests).

## Commands

| command | does | `--json` fields |
|---|---|---|
| `version` | contract number | `contract` |
| `serial --model M [--recover]` | find the phone (mdns `_adb-tls-connect`, then attached devices); with `--recover`: last endpoint, then port scan 30000–49999 of the last IP, then adb server restart and 10×1 s retries | `serial` |
| `connect --model M --wait 40m [--every 1m]` | `serial` until found; attempt k uses `--recover` when k%5==0; exit 3 when the wait runs out | `serial`, `attempts` |
| `connect --model M --port P` | `P` is `PORT` or `IP:PORT` (port alone uses the last IP); connect, check the model, save the endpoint; on mismatch disconnect, exit 3 | `serial` |
| `pair --code C [--port P] --model M` | `adb pair` (P from mdns `_adb-tls-pairing` when omitted), then find the connect endpoint up to 8×1 s | `serial` |
| `lock [--wait 120s]` | 0 unlocked; 2 still locked after the wait (polls every 2 s); never types a PIN | `locked`, `waitedMs` |
| `adb [--serial S\|--model M] [--timeout 120s] -- ARGS…` | runs `adb [-s S] ARGS…`; `start-server` inside a systemd service (`$INVOCATION_ID`) runs in its own `systemd-run --user --scope` | — (passthrough) |
| `dump [--text]` | screen XML from the resident NodeDump server, else `uiautomator dump` | XML (`--text`: one node line per node) |
| `rest [--nodes\|--all]` | `rest`: restore the screen timeout (awake); `--nodes`: stop the NodeDump server; `--all`: both | `restored` |
| `tap X,Y` / `swipe X1,Y1 X2,Y2 [ms]` | raw input, as `--no-look` | `did` |
| `tap "label"` / `tap X Y` / `swipe up` / `key K` / `type T` | as before; settle and print unless `--no-look` | `did` |
| `awake [--idle 10m]` / `rest` | screen-on watchdog on the phone; restores itself after idle | `timeoutMs` |
| `overlay hide [--pkg a,b]` / `overlay restore` | hide dimmer overlays (appops `SYSTEM_ALERT_WINDOW` and their accessibility services); saved state on the phone | `hidden` / `restored` |
| `rec start [--segment 180] [--size WxH] [--bitrate N]` / `rec stop --dir D` | segment screen recording on the phone; stop pulls the mp4s and start times into D | `segments: [{file, startMs}]` |
| `shot F` | screencap PNG to F | `file` |
| `sheet VIDEO F [--every 2]` | contact sheet of a local video with ffmpeg (PC only) | `file`, `frames` |
| `media push DIR FILES…` / `media rm DIR` | push and index for pickers | `count` |

## Phone-side state

All of it under `/data/local/tmp/droid-*`: `droid-awake/`, `droid-nodes/` (+ `droid-nodes.dex`),
`droid-overlay/`, `droid-rec/`, `droid-clipset.dex`. A phone-side watchdog or idle exit cleans up
when the PC dies.

Every command that reaches the device and runs a shell (dump, state, input) touches
`droid-awake/beat`, which keeps `awake` alive.
