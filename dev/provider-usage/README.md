# provider-usage

Provider remaining-usage snapshots for grade fallback. Callers ask `remaining(model)`; HTTP, skip TTL, and `/tmp` cache stay behind that.

```
provider-usage remaining <model> [--json] [--refresh] [--cache PATH]
provider-usage status [--json] [--cache PATH]
provider-usage refresh [provider] [--json] [--cache PATH]
provider-usage mark-exhausted <model> [--until EPOCH] [--json] [--cache PATH]
```

Cache: `/tmp/provider-usage/state.json` (override `--cache` or later `PROVIDER_USAGE_CACHE`). No API keys or cookies.
