# models-catalog contracts

The one list of models for this machine outside pi itself. Reader: `central-catalog.ts` (std-lib only, mtime-cached).

## File

`~/.config/models/catalog.json` (`$XDG_CONFIG_HOME/models/catalog.json`). Same shape as pi's `models-store.json`:
`{ "<provider>": { "models": [ { "type", "id", "name", "api", "provider", "baseUrl", "cost", ... } ], "checkedAt": <ms> } }`.
A record with no `type` is `chat`. Classifier records are pi-ai `ClassifierModel`s.

## Who may do what

| | read | write |
| --- | --- | --- |
| dashboard server (`apps/server/src/models_catalog.rs`) | yes | the only writer (atomic temp file + rename) |
| decision (`backends.ts`), cc-proxy (`levels.ts`), dashboard `pi_models.rs` (Settings › Models) | yes | never |
| pi | no: keeps its own `~/.pi/agent/models-store.json` | never |

## How it is filled

- First read seeds the file once from pi's `models-store.json`. Nothing is synced from pi afterwards.
- The server refreshes all six providers (openrouter, opencode-go, opencode, xai, anthropic, openai-codex) at start and every 6 h; `POST /api/models/refresh` runs it now and answers `[{provider, ok, models}]`. Two layers, in order:
  1. **pi's remote catalog**, `GET https://pi.dev/api/models/providers/<id>?types=chat,image,classifier`: public, no key, the source pi's own `remote-catalog-provider` reads (its `etag` equals the one in pi's store). Records are complete pi records (`thinkingLevelMap`, `compat`, `cost.tiers`). A record replaces the same `(type, id)`; one only here stays. This is how xAI, Anthropic and OpenAI Codex are read. OpenRouter takes only the classifiers it lacks: pi narrows OpenRouter chat and image models with `/models/user`, which needs a key the dashboard never reads (`../auth/CONTRACTS.md`).
  2. **The provider's own public list**, fresher than pi.dev (OpenRouter `/api/v1/models?output_modalities=all`, OpenCode `/zen/v1/models`, OpenCode Go `/zen/go/v1/models`): a known model takes the new name, price and limits (other cost keys such as `tiers` stay); a chat model the list dropped leaves (other types stay); new OpenRouter classifiers and new OpenCode chat models are added, with fields derived from the list when pi.dev lacks them.
- A fetch that fails, answers an empty catalog, or (layer 2) lists fewer than 10 models changes nothing for that layer.

## Readers

- decision looks a classifier up here first, then in pi-ai's built-in list (a machine without the file). The default ladder is the newest Jev among the catalog's OpenRouter classifiers; a pinned ladder is used as written. Calls still go through pi-ai with `dev/auth` credentials.
- cc-proxy reads `thinkingLevelMap.off` here, falling back to pi's store while this file does not exist.
