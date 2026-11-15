# auth contracts

## Credential file

`~/.config/auth/credentials.json` (`$AUTH_FILE`, else `$XDG_CONFIG_HOME/auth/credentials.json`). Directory 0700, file 0600.
Outside every repository. Independent of pi's `~/.pi/agent/auth.json`: nothing is synced between them.

```json
{
  "version": 1,
  "credentials": {
    "openrouter": { "type": "api_key", "key": "<redacted>" },
    "xai": { "type": "oauth", "access": "<redacted>", "refresh": "<redacted>", "expires": 1794725477405 }
  }
}
```

- `type`: `api_key` (`key`, optional `env`) or `oauth` (`access`, `refresh`, `expires`).
- `expires` is epoch ms and already includes a 5 min skew: `expires <= now` means expired.
- One credential per provider id (`^[a-z0-9][a-z0-9._-]{0,63}$`). Provider ids match pi's ids (`opencode-go`, `openrouter`, `xai`, `lithosai`).
- A reader rejects any `version` other than 1 and keeps its last good view on a read error. It never treats a bad file as "signed out".

## Who may do what

| | read | write | refresh OAuth |
| --- | --- | --- | --- |
| Go `auth` CLI | yes | yes (flock on `credentials.json.lock`, temp file + rename) | yes |
| cc-proxy, decision (`client/central-auth.ts`) | yes (mtime cache, no lock) | never | by running `auth refresh <id>` |
| dashboard server (`central_auth.rs`) | provider ids + types only | never | never |

The file is replaced atomically, so a reader without the lock always sees a complete document.
An OAuth refresh token is rotated by the provider, so only `auth refresh` spends it, under the lock;
a second process that finds the token already renewed does nothing.

## Resolution

No environment override. The file is the one source; `import --from-env-file` copies a shell key in once.
`opencode` borrowing `opencode-go` is the decision daemon's own rule, not the store's.

## Consumers

- cc-proxy `upstreams.ts` → `credentialFor`, `loggedIn`.
- decision `auth.ts` → `CentralAuthStore` (pi-ai `CredentialStore`, read-only), `/health` `keyOrigin`, `authProblem`.
- dashboard `GET /api/pi/models?auth=central` (Settings › Models). The projects composer runs pi itself and keeps pi's `auth.json` (`?auth` omitted).
- Not migrated: `dev/provider-usage` (usage cards: cookies, management keys, Codex/Command Code OAuth).

## Exit codes

0 ok · 1 error · 3 provider not signed in.
