# auth

`auth <command>` is global (`~/.local/usr/bin/auth` → `dev/auth.sh`, registered in `meta/cmd-links.json`). The wrapper rebuilds when the source changed, then runs `dev/auth/bin/auth`. Services (cc-proxy, decision) call that binary directly, since a systemd unit's PATH does not include `~/.local/usr/bin`.

| Command | What it does |
| --- | --- |
| `list [--json]` | providers and whether each is signed in (no secrets) |
| `get <provider> [--json]` | print the token, refreshing an expired OAuth one |
| `set <provider>` | store an API key (hidden prompt, or one line on stdin) |
| `login <provider>` | OAuth device login (xai), or `set` for key providers |
| `logout <provider>` | remove the stored credential (the provider-side grant stays) |
| `refresh <provider>` | renew an expired OAuth token; cc-proxy and decision call this |
| `import --from-pi [file] [--include-oauth] [--overwrite]` | copy API keys from pi's `auth.json` once |
| `import --from-env-file [file] [--overwrite]` | copy known provider keys from `~/.config/fish/.env` once |
| `path` | the credential file |

Design and file format: `CONTRACTS.md`. Plan: `../../docs/plan/261115-central-auth.md`.
