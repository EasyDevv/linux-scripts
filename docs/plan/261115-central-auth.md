# Central auth

## Intent

- **Problem**: provider credentials were read from pi's `auth.json` by four tools in two languages, each with its own path, cache, env fallback and precedence, and two of them refreshed OAuth tokens themselves. OpenRouter lived in the shell env file, so "signed in" meant different things per tool.
- **Outcome**: one Go tool (`dev/auth`) owns one credential file and a login CLI; cc-proxy, the decision daemon and the dashboard's Settings › Models read that file and no longer depend on pi's `auth.json`.
- **Affected**: the single developer on this machine; cc-proxy, `decision.service`, the dashboard server and client.
- **Constraints**: stdlib-only Go; keys never leave the processes that use them; file outside the repo, 0600; no sync with pi (a refresh token held in two stores is rotated by whichever refreshes first).
- **Out of scope**: `dev/provider-usage` (usage cards), pi's own composer (keeps pi's `auth.json`), a GUI for login.
- **Open questions**: whether to move provider-usage's cookies and management keys into the store; whether the dashboard should get its own xAI OAuth client id.
- **Confirmed** (user, 2026-11-15): Go; independent of pi's `auth.json`; dashboard, cc-proxy and decision use it. Derived defaults: import is one-time and copies API keys only; env variables are not a live override.

Contract: `dev/auth/CONTRACTS.md`.

## Verification

`go test -race ./...` (lock contention, atomic write, refresh once under concurrency, importers, xAI flow against a TLS test server), `bun test` in `dev/auth/client`, `dev/cc-proxy`, `dev/decision`, `cargo test` in the dashboard server, and live checks: cc-proxy `/api/cc-proxy/config`, decision `/health` `keyOrigin`, `/api/pi/models?auth=central`.
