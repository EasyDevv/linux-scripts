# pi worker delegation eval: open items

A sonnet orchestrator calls the pi worker correctly in 11/12 synthetic scenarios (r2, 2026-10-23), and batched tasks really overlap. Three items are still unverified. The lessons that were persisted live in `~/.agents/skills/write-a-claude-plugin` (SKILL.md › Making the model use a plugin tool; references/gotchas.md › Parallel calls) and the harness lives in `~/.agents/plugins/pi/evals/`.

## Evidence

- r0 6/12 · r1 10/12 · r2 11/12, about $1.4 per round. Raw rounds: scratchpad (gone), new runs go to `~/.cache/pi-worker-evals/<round>/`.
- Two worker calls in one message ran one after another: the second started 23 ms after the first ended, 562 s total. One call with `tasks` overlapped (three children started at the same ts).
- During r2 s05, a worker-written `state.test.ts` added 0.5 to the real `~/.local/state/decision/budget.json`. The orchestrator subtracted it again (0.0205 afterwards). The original value was not checked. The harness now sets `XDG_STATE_HOME` per scenario.

## Backlog

- **s03 (test file from a case list) is never delegated.** Sonnet writes it itself in 5 calls and 19 s. Decide whether that is right: delegating saves Sonnet tokens but takes 100 s or more. Check: `evals/run.sh r3 s03-testfile` three times after any wording change. If it should stay inline, change `expect` to `either`.
- **Single-run variance.** s01 flipped between rounds. Check: run the full set twice (`JOBS=4 evals/run.sh r3a`, `r3b`) and count the scenarios whose result flips.
- **The several-task row is not captured in a pty.** The `n. Done` lines and the combined `tier · read/write` meta are untested in the TUI. Check: `uv run -q --with pyte python ~/.agents/skills/write-a-claude-plugin/scripts/tui-capture.py ~/.agents out.txt --allowed 'mcp__pi__worker' "@200 use the worker with two tasks: ..." SNAP SNAP`.
- **Report size on broad asks.** s04 reports came to about 4k chars per task, despite the 200-word limit. Watch the `report=` column, and lower `reportMaxChars` only if Sonnet's input tokens grow.
- `plugins/pi/` is untracked in `~/.agents` git, so the 0.2.5 → batch change has no commit to diff against. Commit it, then bump the version in both manifests.
