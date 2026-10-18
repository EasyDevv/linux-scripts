# decision — feature contracts

Shared by the daemon features, the pi extension (`~/.pi/agent/extensions/decision/`), the Claude Code
plugin (`~/.agents/plugins/decision/`), and `decision eval` / `decision audit`. Change a contract here first.

## Common

- Daemon: `http://127.0.0.1:45130` (`DECISION_URL` overrides). Every client is fail-open: no answer,
  timeout, non-2xx, or `status != "routed"` changes nothing.
- Every feature result carries `FeatureResult` (`features/types.ts`): `decisionId?`, `status:
  routed | skipped | unavailable`, `reason`, `notes[]`, `backend?`, `calibrated?`, `latencyMs?`.
- Every body may carry `harness` (`pi` | `claude` | `cli` | `eval`) and `sessionId` (the harness's
  own session id, so `decision audit` can join the log with the transcript).
- Skips (slash command, acknowledgement, short continuation with history) come from
  `skipReason` in `features/model-route.ts`, so every feature skips the same prompts.
- A feature is a `FeatureDef` (`features/types.ts`) registered in `features/index.ts`; its
  questions live in `prompts/<name>/vN.json`; its eval cases in `evals/<name>.jsonl`.

## `POST /v1/model_route` (done)

- in: `{prompt, history?, cwd?, currentModel?, contextTokens?}`
- out: `{tier?: quick|standard|high|premium, kind?, demand?}`

## `POST /v1/find_skill`

- in: `{prompt, history?, cwd?, loaded?: string[]}` — `loaded` names (skills or rules) already in
  context; they are never returned again.
- out: `{skills: [{name, path, description, p}], rules: [{name, path, scope: "global"|"project", p,
  body}], candidates: number}` — `body` is the rule text without frontmatter.
- Catalog: skills `~/.agents/skills/*/SKILL.md` (not `_manual/`), `{projectRoot}/.agents/skills/*/SKILL.md`;
  rules `~/.agents/rules-routed/*.md`, `{projectRoot}/.agents/rules-routed/*.md`. `projectRoot` is
  the nearest ancestor of `cwd` holding `.git`, else `cwd`.
- Routed rule frontmatter: `description:` (one line, what work it governs) and optional
  `skills: [a, b]` (also load this rule when one of those skills is selected).

## `POST /v1/find_tool`

- in: `{userRequest, actionsTaken?: string[], assistantSaid?: string[], inactive: [{name, description}], topK?}`
- out: `{activate: [{name, p}], done?: number}` — additive only; `done` is advisory.

## `POST /v1/orchestrate`

- in: `{task, roles: [{name, description}], cwd?}`
- out: `{plan?: single|fanout|staged, worthParallel?: number, steps: [{role, p}]}` — roles only; the
  harness writes each step's task text.

## `POST /v1/outcome`

- in: `{decisionId?, feature, signal, detail?}` → 204.
- signals: model_route `applied`; find_skill `injected` (`detail: {skills, rules}`), `used`
  (`detail: {name}`); find_tool `activated`, `called` (`detail: {name}`); orchestrator `planned`,
  `spawned` (`detail: {role}`).

## Log

`~/.local/state/decision/log-YYMMDD.jsonl`, one JSON per line: `type: decide` (engine call),
`type: result` (`feature`, `version`, `harness`, `sessionId`, `decisionId`, the feature result),
`type: outcome` (above).

## Eval case

`evals/<feature>.jsonl`: `{input: <the HTTP body>, expected: <label>, source: "seed"|<sessionId>, note?}`.
Labels: model_route a tier; find_skill `{skills: string[], rules: string[]}`; find_tool `string[]`;
orchestrator `{plan, roles?: string[]}`. `FeatureDef.score(expected, result)` returns the metrics.
