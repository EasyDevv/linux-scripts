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

## Tiers (`~/.config/decision/tiers.json`, `tiers.ts`)

- `{pi: [{name, minDemand, enabled?, models: [{model, thinkingLevel?}]}], claude: [{name, minDemand,
  enabled?, model: haiku|sonnet|opus|fable}], route: {holdAboveTokens}}`. One list per harness, each
  ordered by `minDemand` with the first at 0 and at least one tier on; names and bands are each
  list's own. The legacy single list `{tiers: [{name, minDemand, pi, claude}]}` is still read and split.
  Default, both lists: quick 0 · standard 0.5 · high 1.5 · premium 2.5 (Claude haiku · sonnet · opus · opus).
- model_route's demand (0–3) picks, in each list, the tier on whose band holds it. `enabled: false`
  switches a tier off: its band goes to the nearest tier on below it, else the lowest tier on.
- pi reads `pi[].models` as that name's `models.profiles` ladder (a `config.jsonc` profile of the same
  name wins); Claude Code reads `claude[].model` as the catch-all Agent `model`. Claude's effort is
  model_route's `effort`, never a tier's.
- `route.holdAboveTokens`: past this context size a harness keeps its current model **and effort**
  in both directions (an effort change can bust the provider's prompt cache). Subagents and new
  sessions start with an empty context, so the hold never applies to them.
- The dashboard (Settings › Models) writes the file; every reader re-reads it on change.

## `POST /v1/model_route` (done)

- in: `{prompt, history?, cwd?, currentModel?, contextTokens?}`
- out: `{tier?, tiers?: {pi, claude}, effort?: low|medium|high|xhigh, kind?, demand?}` — `tier` is
  the asking `harness`'s list (`claude`), else pi's; `effort` is for Claude.

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

## `POST /v1/loop`

- in: `{sessionId, harness, agentId?, events: [{kind: "prompt", text?} | {kind: "call", tool, args} |
  {kind: "result", tool, args, output, isError} | {kind: "answer", text}]}` — `answer` is a run that
  ended on text alone; `agentId` keeps a subagent's counters apart.
- out: `{detections: [{tier, action: nudge|continue|shadow, tool?, count, message, failureClass?}]}`.
- Rules (pydantic LoopDetection): `exact_repetition` 5-in-10, `error_cycle` 3 identical results,
  `alternation` 3 A-B cycles, `monologue` 3 near-identical answers → `nudge` (the model reads `message`
  with the next tool result or prompt).
- `runaway`: a promise-shaped last sentence ("Let me run…", "…하겠습니다.") is asked to Jev; p ≥ 0.7 →
  `continue` (the harness forces one more turn), at most once per prompt.
- Maker (`subagent`, `Agent`): the same task again → `maker_duplicate`; a redispatch after a failed run
  → `maker_retry` with Jev's `failureClass`. Both `shadow`: logged and shown, never sent to the model.
- Clear results are not logged.

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
