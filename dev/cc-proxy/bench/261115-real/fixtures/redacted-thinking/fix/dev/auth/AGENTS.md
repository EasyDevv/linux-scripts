# auth

Central credential store and login CLI (Go, stdlib only). Contract: `CONTRACTS.md`.

- Only this tool writes `~/.config/auth/credentials.json`; consumers read it (`client/central-auth.ts`, dashboard `central_auth.rs`).
- Never print or log a secret except from an explicit `auth get`. `list` and `/health` show ids, types and sources only.
- Never read or write pi's `auth.json` except `auth import --from-pi`, which copies API keys once and skips OAuth (a shared refresh token is rotated by whoever refreshes first).
- Tests: `go vet ./... && go test -race ./...` here, `bun test client` for the TS reader. Build: `dev/auth.sh` (output `bin/auth`, git-ignored).
- The xAI client id is pi's registered app; replace `oauth.NewXAI` if the dashboard gets its own.
