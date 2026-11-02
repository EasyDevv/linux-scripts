# netbird-setup (Go)

`netbird-setup` mints one-off NetBird setup keys and writes a Windows USB installer. This is the
Go port of `dev/netbird/netbird-setup.py` (957 lines, still present); the Python file is the
reference for behavior, and `parity/run.sh` runs both on identical fixtures and diffs the results.

The wrapper `../netbird-setup.sh` builds `bin/netbird-setup` from this module, exports
`NETBIRD_SETUP_ROOT=dev/netbird`, and execs the binary. `bin/` is git-ignored.

## Usage

```text
netbird-setup issue [NAME] [--replace]      mint a one-off employees key (usage 1, 7 days)
netbird-setup employees --roster PATH [--auto-group GROUP] [--apply]
                                            plan, then mint the roster's missing keys
netbird-setup usb [--dest PATH]             write the key file + Windows installer to a USB
netbird-setup list                          stored key names only, never values
netbird-setup --help
```

- Keys live in `dev/netbird/.env.netbird.setup.keys` (`NAME=value`, mode 600); `issue` seeds the
  comment header when the file is empty or missing, and rewrites one line per name.
- `issue` needs `NETBIRD_API_KEY` (PAT) from the environment or `dev/.env.netbird`;
  `NETBIRD_MANAGEMENT_URL` (default `https://management.example.invalid`) and
  `NETBIRD_AUTO_GROUP` (default `employees`) resolve the same way. `usb` and `list` need no PAT.
- Without a TTY `issue` requires `NAME` (and `--replace` for a name that exists) and `usb` requires
  `--dest`. On a terminal, `issue` with no `NAME` asks `Key name (e.g. GREEN_USER_01): `, and an
  existing name asks `NAME already exists. Replace it?`.
- `usb` copies `.env.netbird.setup.keys`, `windows/install-netbird.ps1`,
  `windows/install-netbird.cmd`, and `README.md` into `<dest>/netbird-setup/`, then adds the
  installer MSI from `.data/` or the network; a failed download only prints
  `warning: Windows MSI download failed; the USB script will use winget`.

Exit codes: `0` ok, `1` fatal (`error: <msg>` on stderr), `2` bad arguments (argparse texts), `130`
picker abort (`q`, Esc, Ctrl-C in the Go port; the Python original used 1 — see Changelog).

`NETBIRD_SETUP_ROOT` is how the compiled binary finds the module directory (`windows/`,
`README.md`, the keys file); it falls back to `$HOME/.local/share/scripts/dev/netbird`. The Python
original derived the same path from `__file__`.

## Layout

| Path | Ported from | Concern |
| --- | --- | --- |
| `main.go` | — | process entry, `app.Run(os.Args[1:])` |
| `internal/app/args.go` | `build_parser` / `parse_args` | argparse help layouts and `netbird-setup: error:` diagnostics, exit 2 |
| `internal/app/run.go` | `main` | dispatch, `error:` line, exit codes |
| `internal/app/config.go` | `load_config` | `NETBIRD_*` from env, then `dev/.env.netbird`, then defaults |
| `internal/app/env.go` | `parse_env` / `upsert_env` / `atomic_write` | env-file reader, stable upsert, 600 temp+rename write |
| `internal/app/paths.go` | module-level constants | `SCRIPT_DIR`/`DEV_DIR`, keys path, MSI cache, `NETBIRD_SETUP_ROOT` |
| `internal/app/keys.go` | `normalize_key_name` / `save_setup_key` | name rules, reserved names, rescue file on write failure |
| `internal/app/roster.go` | `load_employee_roster` | `people[].pc`/`phone`, duplicates, `keys_path` |
| `internal/app/commands.go` | `cmd_issue` / `cmd_usb` / `cmd_list` / `cmd_employees` | command layer, seams for minting, lsblk, MSI, picker |
| `internal/app/api.go` | `api_request`, `resolve_group_id`, `create_setup_key` | management API client (see below) |
| `internal/app/usb.go` | `parse_lsblk` … `ensure_msi` | USB discovery, payload writer, MSI cache/download |
| `internal/app/util.go` | — | `Path.name`, `os.access`, installer GET, 120 s download timeout |
| `internal/ui/picker.go` | `pick` / `classify_key` | Bubble Tea inline picker: same keys, title, rows, footer |
| `internal/ui/secret.go` | `resolve_name`'s typed prompt | echoed key-name prompt |
| `parity/run.sh` | — | original vs port harness |

## HTTP client

Python's `api_request` is `urllib.request.urlopen(Request(...), timeout=30)`; `download_msi` is the
same with `timeout=120`, a `User-Agent: netbird-setup` header, and a `.part` temp file. The Go
client is built in `newHTTPClient`/`urllibTransport`, not from `http.DefaultClient`, because Go's
defaults differ on several points.

| Setting | Python (`urllib`/`http.client`) | Go port |
| --- | --- | --- |
| Timeout | `timeout=30` per socket operation; 120 for the MSI | `http.Client.Timeout` 30 s per request (120 s for the MSI) |
| TLS | `ssl` default context: verify certificate and host, system CA store, minimum TLS 1.2 | `tls.Config{MinVersion: TLS12}`, system roots, verification on |
| HTTP version | HTTP/1.1 only (`http.client`), never h2 | `ForceAttemptHTTP2: false` and an empty `TLSNextProto` |
| Compression | no gzip; `http.client` sends `Accept-Encoding: identity` | `DisableCompression: true` plus an explicit `Accept-Encoding: identity` |
| Keep-alive | `Connection: close`, one connection per request | `req.Close = true`, `DisableKeepAlives`, `MaxIdleConns: 1` |
| Headers | `Accept: application/json`, `Authorization: Token <pat>`, `Content-Type: application/json` | the same three, plus `identity` above |
| Request body | `json.dumps(body)` → `", "`/`": "` separators, insertion order, `ensure_ascii` | `pythonJSON()` re-emits exactly that from `json.Marshal`'s token stream |
| Redirects | 301/302/303/307/308, `max_redirections = 10` | the same five codes; the 11th hop reports `failed (302)` |
| Proxy | `ProxyHandler`: `http_proxy`/`https_proxy`/`no_proxy`/`all_proxy` from the environment | `ProxyFromEnvironment`: the same variables except `all_proxy` (Changelog) |
| Response | empty body → `None`; `json.loads`, else `NetBird API returned invalid JSON` | empty body → `nil`; `json.Unmarshal`, else the same message |
| Errors | 401 → `NetBird API token invalid (401)`; other status → `NetBird API <M> <path> failed (<code>)`; `URLError` → `NetBird API request failed` | the same three texts, decided by `httpFailure` |

The fake API in `parity/run.sh` logs `Accept`, `Accept-Encoding`, `Content-Type`, `Connection` and
the raw body of every request, so the harness compares the wire format and not just the output:
after the port both sides send `Accept-Encoding: identity`, `Connection: close`, and a body of
`{"name": "GREEN_USER_01", "type": "one-off", "expires_in": 604800, "auto_groups": ["grp1"], "usage_limit": 1, "ephemeral": false}`.

## Tests

```sh
cd dev/netbird/go && go vet ./... && go test ./...
dev/netbird/go/parity/run.sh        # original vs port, case by case
```

| Python test (`tests/test_netbird_setup.py`) | Go test |
| --- | --- |
| `PathTests.test_keys_file_is_usb_name_in_netbird_dir` | `TestPathsPort` |
| `NameTests.test_accepts_short_employee_name`, `test_strips_legacy_prefix`, `test_rejects_reserved_and_invalid` | `TestNormalizeKeyName` |
| `EnvTests.test_upsert_preserves_comments_and_replaces_name` | `TestUpsertEnv` |
| `EnvTests.test_parse_env_skips_comments` | `TestParseEnvSkipsComments` |
| `UsbParseTests.test_parse_lsblk_keeps_mounted_usb_only` | `TestParseLsblk` |
| `KeyClassifyTests.test_arrows_and_vim_keys` | `ui.TestKeyActions`, `TestUpdateMovesAndSelects`, `TestMoveClamps` |
| `WindowsScriptTests.test_ps1_is_interactive_and_reads_bundled_env` | `TestRenderWindowsScripts` |
| `WindowsScriptTests.test_cmd_launcher_calls_ps1` | `TestRenderWindowsScripts` |
| `CommandTests.test_issue_saves_key_without_printing_it` | `TestIssueSavesKeyWithoutPrintingIt` |
| `CommandTests.test_issue_requires_replace_without_tty` | `TestIssueRequiresReplaceWithoutTTY` |
| `CommandTests.test_usb_writes_script_to_dest` | `TestUSBWritesScriptToDest` |
| `CommandTests.test_usb_non_tty_requires_dest` | `TestUSBNonTTYRequiresDest` |
| `CommandTests.test_list_prints_names_only` | `TestListPrintsNamesOnly` |
| `CommandTests.test_main_help_and_missing_command` | `TestParseHelpAndMissingCommand` |
| `CommandTests.test_load_config_requires_pat_only_for_issue` | `TestLoadConfigRequiresPATOnlyForIssue` |
| `CreateKeyTests.test_posts_one_off_employee_key` | `TestCreateSetupKeyPort` (`포팅`), plus `TestAPIClientRequestShape`, `TestAPIClientErrorTexts`, `TestAPIClientRedirects`, `TestPythonJSON` (`추가`: the HTTP details the unittest stubbed out) |
| `EmployeeRosterTests.test_roster_has_eight_waiting_keys` | `TestRosterEightWaitingKeys` (skips when the example roster is absent) |
| `EmployeeRosterTests.test_employees_mints_missing_only` | `TestEmployeesMintsMissingOnly` |

Added Go tests (no Python counterpart): `TestResolveNameUsesPickerAndPrompt` (the picker/prompt
seams), `ui.TestUpdateAborts`, `TestWindowSizeIsHandled`, `TestFrameText`, `TestFrameHangulWidth`,
`TestSecretPromptHidesInput`, `TestSecretPromptAborts`. Every Python test name above is
`포팅`; none is `생략`. `tests/test_netbird_host_reconcile.py` tests `host-reconcile.py`, which is
not part of this port.

## Parity

`parity/run.sh` builds the module, copies `.py` + `windows/` + `README.md` into a temp tree per
implementation (so `SCRIPT_DIR`, the keys file, and `.data/` never point at the real module), gives
each side a temp `HOME`, and runs both against one local fake management API on `127.0.0.1`.

- Every invocation is `timeout 20 … </dev/null`, except the two interactive cases which run under
  `script` (a real PTY) with keys piped in, also under `timeout 20`. A prompt that appears where
  the original would read a name cannot hang the run; a full run takes about 7 s.
- `NETBIRD_API_KEY` is a dummy PAT, `https_proxy` points at a closed port with
  `no_proxy=127.0.0.1`, and every `--dest` is a temp directory: no real token is read, nothing
  reaches `pkgs.netbird.io`, and no block device is written.
- `AI_AGENT`, `PI_CODING_AGENT`, `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, and `NO_COLOR` are dropped
  so both sides see the same plain environment.
- Compared per case: stdout, stderr, exit code, and post-state (keys file with values masked, its
  mode, `employees.env`, sha256 of every USB payload file, and the API request log with the token
  and User-Agent masked). Each case prints `name same|DIFF` as it finishes; the run ends with
  `all cases identical` or a diff count and the kept artifacts.

Cases: `--help`, no command, `issue|usb|list|employees -h`, invalid command, unknown flag,
`--version`, two positionals, `--dest` with no value, `--dest -h`, `--roster -h`, `employees`
without `--roster`, `list` empty and with keys, `issue` without a name, with an existing name
(non-TTY), `--replace` (mints through the fake API and rewrites the keys file), a bad name, `usb`
without `--dest`, `usb --dest`, a cached-MSI `usb`, a `usb` whose destination already is the
payload dir, `employees` plan, `--apply`, `--apply --auto-group`, a roster row missing `phone`, a
roster that is not an object, and on a PTY: `issue NAME` → picker `j` + Enter → Yes (mints,
rewrites the key), and `issue` → typed name. All cases are identical.

## Changelog (intended differences from `netbird-setup.py`)

1. **Picker abort exits 130 instead of 1.** Same `error: aborted` line; `q`, Esc, and Ctrl-C take
   this path, and Enter on the `No` row of `NAME already exists. Replace it?` counts as an abort.
   Reason: the build-terminal abort rule (128+SIGINT) so a following `&&` command does not run.
2. **The picker is an inline `tea.Model`** instead of a termios raw-mode reader with cursor
   arithmetic. Keys, title, rows, detail text, blank lines, footer text, and the row cut at
   `width-1` are the original's; the frame bytes, repaint strategy, and `SIGWINCH` redraw are Bubble
   Tea's. Reason: build-terminal wiring; one key event per press instead of a hand-split escape
   buffer.
3. **Up/Down clamp at the ends instead of wrapping.** The original did
   `current = (current ± 1) % len(choices)`. Reason: the build-terminal list rule (no wrap-around,
   so a held key cannot silently jump from the last row to the first).
4. **`TERM=dumb` disables color**, in addition to the original's `NO_COLOR` and TTY conditions.
   Reason: a dumb terminal must receive no SGR bytes.
5. **Alt chords are ignored** in the picker; the original read the raw `ESC` followed by the letter
   and classified that as `QUIT`, so Alt-k aborted. Reason: KWin owns Alt on this desktop, so
   Alt-chords are not a quit gesture here.
6. **Esc or Ctrl-C at the key-name prompt reports `error: aborted` (exit 1).** The typed name is
   echoed as before. The original either passed the raw ESC to the name validator or died with a
   `KeyboardInterrupt` traceback. Reason: no stack trace on a CLI's stderr.
7. **Unexpected failures are `error: <message>` (exit 1), not a traceback.** An unreadable roster
   file reports `cannot read employee roster: <path>` and malformed roster JSON reports
   `employee roster must be an object`; the original raised `FileNotFoundError` /
   `json.JSONDecodeError` and printed a stack trace. Reason: no stack trace belongs on a CLI's
   stderr; the exit code matches.
8. **`User-Agent` is `Go-http-client/1.1`** instead of `Python-urllib/3.x`. Reason: the transport
   sets its own; only the MSI download sets an explicit one (`netbird-setup`, unchanged). The fake
   API still records that a User-Agent is sent, which is what the port can match.
9. **`all_proxy` is not honored** (`http_proxy`/`https_proxy`/`no_proxy` are). Reason: Go's
   `http.ProxyFromEnvironment` has no `all_proxy`; adding it would need a custom proxy function,
   and a curl-style variable that no NetBird deployment documents is not worth the seam.
10. **Loopback is never proxied.** urllib's `ProxyHandler` sends `127.0.0.1` through `http_proxy`
    unless `no_proxy` names it; Go's `ProxyFromEnvironment` always bypasses the proxy for loopback.
    Reason: a local management URL behind an unrelated corporate proxy is a bug, not a feature; the
    parity harness sets `no_proxy=127.0.0.1` so both sides behave alike.
11. **Timeout scope.** Python's `timeout` is a per-socket-operation timeout; Go's
    `http.Client.Timeout` bounds the whole request including the body read. The values (30 s, 120 s)
    are the original's. Reason: the Go standard library has no per-operation equivalent short of a
    custom dialer, and these are small JSON bodies.
12. **JSON numbers decode to `float64`.** `json.Unmarshal` into `any` loses precision above 2^53,
    where Python keeps arbitrary-precision ints. Nothing this tool reads back (group `id`, key
    `key`/`name`) is numeric; the request body is emitted from typed structs. Reason: standard
    library decoding, no `json.Number` plumbing needed.
13. **`NETBIRD_SETUP_ROOT`** replaces `Path(__file__).resolve().parent` as the module-directory
    source, with `$HOME/.local/share/scripts/dev/netbird` as the fallback. Reason: a compiled
    binary has no `__file__`; the wrapper always exports it.

No other intentional differences: help and usage layouts, argparse diagnostics and exit 2, `--dest=`
forms, `-h` placement (including `--dest -h` being a missing value), key-name rules and reserved
names, the keys-file header and its 600 mode, the `.rescue` file on a write failure, `list` order
and secrecy, the USB payload file set and modes, `payload_dir`'s `netbird-setup` name, the MSI
cache-then-download order and its non-fatal failure, roster validation messages, and the
`PASS`/`PLAN`/`CHANGE` lines all match.

## Not verified (needs the real API or hardware)

- A live management server: the group-filter fallback (`/api/groups` without `?name=`), a real
  401 from a bad PAT, and the shape of a real setup-key response.
- `usb` with no `--dest` on a TTY, which runs `lsblk` and needs a mounted USB stick; only the
  parser (`TestParseLsblk`) and the non-TTY error are covered.
- A successful MSI download from `https://pkgs.netbird.io/windows/msi/x64` (blocked on purpose);
  the cached-copy path and the failure warning are compared.
- The Windows side (`install-netbird.ps1` / `.cmd`) is copied verbatim and not executed here.
- Picker key handling on a real terminal is compared by result, not by frame bytes (differences
  above); `ui` tests drive the model directly.
