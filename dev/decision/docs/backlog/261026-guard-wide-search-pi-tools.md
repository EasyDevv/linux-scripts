# guard: wide_search for pi find/grep tools

## Conclusion

A pi session (`01a17634-db9f-70f4-ac79-466215e443d9`, grok-4.6 on xAI) looked stuck at the find_skill step.
find_skill was not the cause and neither was xAI: the same turn ran `find {path:"/home/easydev",
pattern:"**/learn/**/SKILL.md"}` in parallel, a home-wide glob over ~160 GB (`~/.cache` 112 G,
`~/.local/share` 50 G). Parallel tool results are written together, so find_skill's result (512 ms) only
appeared when the user aborted after 44 min (jsonl lines 348-353; again 73 s at lines 363-372).

`wide_search` only looked at shell commands (`bash`/`Bash`); pi's own `find`/`grep` tools were never asked.
Claude Code has no such tools (it searches through Bash), so only pi had the gap.

## Evidence

- `~/.pi/agent/sessions/--home-easydev-chat--/2026-10-26T03-15-38-027Z_01a17634-db9f-70f4-ac79-466215e443d9.jsonl`
  lines 348-353, 363-372. Stop reasons: 102 toolUse, 5 stop, 2 error (both the user abort); no 429/5xx.
- A fresh `pi --no-session -p --model xai/grok-4.6` call answers at once: the provider is healthy.

## Second finding: resuming that session failed

The aborted turns left assistant messages `{content: [], stopReason: "error"}` (lines 353, 372). Replaying the
session with them (`pi --session … -p`) failed with `Invalid arguments passed to the model.` or hung; copies
without the trailing ones (372, 383) answered, copies keeping them failed or hung (6 trials, not fully
deterministic). Not fixed in pi (a compiled binary); the session was repaired by dropping those entries and
re-linking `parentId` (backup kept).

## Third finding: xAI rejects pi-interactive-shell's tool schema (fixed)

With `pi-interactive-shell` in the tool list every xAI model (`xai/*`, `openrouter/x-ai/*`, `opencode-go/grok-4.7`)
failed with `Invalid arguments passed to the model.`; eight other models accepted it. Bisected request by
property to `monitor.semantic.actions.items[*].{description,input,inputKeys}.pattern`: patterns holding
control characters (`[^\u0000-\u001f…]`). Removing only those makes xAI answer and call the tool.

Fix: `task-models/request.ts` `stripUnportablePatterns` (all providers, copy-on-write because the schemas are
shared with the registered tools; the tool validates its arguments at run time anyway), wired in
`task-models/index.ts` `before_provider_request`, 2 tests. Verified with the tool actually called on
`xai/grok-4.6`, `opencode-go/grok-4.7`, `opencode-go/claude-haiku-5-5`, `opencode-go/kimi-k3`,
`openrouter/x-ai/grok-4.6`, no `-xt` flag. Rule: `~/.agents/rules-routed/provider-parity.md`.
Why only now: unknown; the session ran for hours with the same schema.

## Root cause

`guard()` returned `no rule for this tool` for anything but shell and failed edit calls, and the pi extension
sent only `bash` to `/v1/guard`.

## Files changed

- `decision/features/guard.ts`: `wideSearchTool` + `wideDenied`; `find`/`grep` with root `~`, `/` or `/home`
  (by `path`, an absolute `find` pattern, or the `cwd`) → deny `wide_search`, same text as the shell rule.
- `decision/features/guard.test.ts`, `decision/evals/guard.jsonl` (2 cases from this session), `decision/CONTRACTS.md`.
- `~/.pi/agent/extensions/decision/index.ts`: `GUARDED_CALLS = bash, find, grep` are asked.
- `~/.agents/rules-routed/decision-harness-parity.md`: pi and Claude must give nearly the same UX.

## Check

`bun test features/guard.test.ts` 22 pass; `decision eval --feature guard --version v1 --all` exact 1.000
(20/20). Live: the daemon and the pi extension still run the old code until the daemon restarts and a new pi
session loads the extension.

## Backlog

- Restart the decision daemon and reload pi, then replay `find {path:"/home/easydev", pattern:"**/SKILL.md"}`.
- pi `find` showed no timeout in the session record (44 min): a tool timeout belongs in pi-bolt.
- pi-bolt: drop empty error assistant messages from the replayed history.
- Report the control-character `pattern` to pi-interactive-shell upstream; `defer: true` in `interactive-shell.json` would save ~4.5K tokens per turn.
