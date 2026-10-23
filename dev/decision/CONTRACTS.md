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
- out: `{skills: [{name, path, description, p, body?}], rules: [{name, path, scope: "global"|"project", p,
  body}], candidates: number}` — a rule's `body` is its text without frontmatter. A skill carries `body`
  (its `SKILL.md` without frontmatter) only when the prompt version sets `limits.injectThreshold` and the
  skill is among the top `injectMax` (default 1) at p ≥ it and ≤ `injectMaxChars` (default 12000): the
  harness then puts the body in context itself, and a skill without `body` stays a hint.
- Catalog: skills `~/.agents/skills-routed/{<name>,<category>/<name>}/SKILL.md` and the same under
  `{projectRoot}/.agents/skills-routed/` (a folder without `SKILL.md` is a category, one level; the
  name never includes it);
  rules `~/.agents/rules-routed/*.md`, `{projectRoot}/.agents/rules-routed/*.md`. `projectRoot` is
  the nearest ancestor of `cwd` holding `.git`, else `cwd`.
- Routed rule frontmatter: `description:` (one line, what work it governs) and optional
  `skills: [a, b]` (also load this rule when one of those skills is selected).
- A touch report (`paths` and an empty `prompt`, prompt version with `limits.scriptFirst`) answers
  from `paths:` globs alone: matched rules, plus as hints (`p: 1`, no `body`) the skills whose glob
  matched and the skills a matched rule names in `skills:`. A prompt with a matched rule asks Jev
  about those paired skills too, past the shortlist. Clients append both to the tool result.
- Jev down or slow: `paths:` globs answer as above, plus keyword-matched candidates from the prompt
  (name + description token overlap, Korean by 2+ char substring), capped at 3 skills and 2 rules at
  `p: 0.4`. They arrive as hints only: no `body` (rules too), and the result carries `fallback: true`
  with reason `fallback: keyword (Jev unavailable)`. With no path or keyword match the answer stays
  `unavailable`. Clients render fallback entries as name+path lines marked `[fallback]`, never as
  bodies.
- Exposure is the folder, not a frontmatter flag. `skills-routed/` is scanned by no harness, so a
  routed skill reaches the model only through this answer: a body, or a hint the model follows by
  reading the `SKILL.md` at `path` (not the Skill tool, which does not know it). `.agents/skills/`
  holds manual skills: the harnesses scan it, their authored `disable-model-invocation: true` keeps
  them out of the model catalog, `/name` (Claude Code) and `/skill:name` (pi) run them, and the
  catalog never reads it. Both clients offer `/routed <name>` to load a routed skill by hand, and
  register each routed skill as a command (`/<name> [request]` in Claude Code, `/skill:<name>` in
  pi) that loads it and sends the request; on a turn find_skill does not answer they list the
  routed skills by root, once a session.
  A client shows `⚠ decision down · no skills` (pi footer, Claude Code status line) while
  find_skill gets no answer or `unavailable`; a skip clears it.
- Human-text entry points routed — Claude: `prompt.submit` (typed or queued, composer origin),
  `AskUserQuestion` answers (PostToolUse), auto-continuation feedback that is not `isMeta`; pi:
  `input`/`before_agent_start`, `ask_user_question` answers (tool_result), `steer`/`followUp` while
  streaming (`queued.ts`, delivered via `sendMessage`).

## `POST /v1/find_tool`

- in: `{userRequest, actionsTaken?: string[], assistantSaid?: string[], inactive: [{name, description}], topK?}`
- out: `{activate: [{name, p}], done?: number}` — additive only; `done` is advisory.

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

## `POST /v1/guard`

- in: `{harness, sessionId?, cwd?, phase: "call" | "result", tool, args, output?, isError?}`. Clients ask
  only where a rule can fire: `call` for a shell call (`bash`, `Bash`), `result` for a failed edit (`edit`,
  `Edit`). Code only, no Jev: one answer per shell call, so the daemon answers at once and the client
  waits at most `timeoutMs` (default 300), then runs the call unchanged.
- out: `{action: none | rewrite | deny | hint, rules: string[], args?, message?, notice?}`.
  - `rewrite`: run with `args` instead; `message` goes after the tool result for the model.
  - `deny`: do not run; `message` is the block reason the model reads.
  - `hint`: append `message` to the failed result.
  - `notice`: one line for the person (toast / notify), every action but `none`.
- Rules: `pkill_self` (`pkill -f` without `-A` matches its own shell → add `-A`), `quote_glob` (a
  glob meant for the program, `--include=*.ts` or after `-name`/`--glob`, is single-quoted),
  `wide_search` (`find`/`grep -r`/`rg` over `~` or `/` without a depth ≤ 3 → deny), `wait_loop`
  (not under `harness: pi`, which has no background mode: a foreground `until`/`while` loop with
  `sleep` polling a task output file, `/tasks/` or `*.output|*.out|*.log`, → deny toward
  `run_in_background`/Monitor; the client sends `args.run_in_background: true` for a background
  call, which is never denied), `edit_hint` (where
  the oldText's closest match is and its first differing line; overlapping and repeated spans by line).
- Text the model reads is appended after the tool result, never in the system prompt (cache).
- `none` results are not logged.

## `POST /v1/dispatch`

Moved to the dashboard on 261023: `~/dev/dashboard/apps/server/src/workflow/dispatch/jev.rs`.
The dashboard calls `POST /v1/decide` with feature `dispatch`, version `v1`, harness `dashboard`;
the contract now lives in the dashboard's `docs/plan/261022-agent-composer.md`.

## `POST /v1/outcome`

- in: `{decisionId?, feature, signal, detail?}` → 204.
- signals: model_route `applied`; find_skill `injected` (`detail: {skills, rules, bodies?}` — `bodies` names the skills whose body the harness loaded), `used`
  (`detail: {name}`); find_tool `activated`, `called` (`detail: {name}`).

## Log

`~/.local/state/decision/log-YYMMDD.jsonl`, one JSON per line: `type: decide` (engine call),
`type: result` (`feature`, `version`, `harness`, `sessionId`, `decisionId`, the feature result),
`type: outcome` (above).

## Eval case

`evals/<feature>.jsonl`: `{input: <the HTTP body>, expected: <label>, source: "seed"|<sessionId>, note?}`.
Labels: model_route a tier; find_skill `{skills: string[], rules: string[]}`; find_tool `string[]`.
`FeatureDef.score(expected, result)` returns the metrics.
