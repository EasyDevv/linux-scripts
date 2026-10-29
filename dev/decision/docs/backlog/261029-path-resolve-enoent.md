# path_resolve: ENOENT on read/edit/find/grep

## Conclusion

A guard rule rewrites a `read`/`edit`/`find`/`grep`/`ls` on a missing skill path before it runs (0 extra
steps, no Jev) and appends the nearest directory's entries to any other missing-path failure (no `ls`
turn). Live since the `decision service restart` of 261029 00:39 KST.

## Evidence (pi, 3 days to 261029, 41 sessions)

- 234/6059 pi tool calls failed (3.9%); 26 were a missing path in read/edit/find/grep (`tool-errors.py`).
- 11/26 were resolvable by filesystem lookup: skills that moved between `skills-routed`, `skills-optional`
  and `skills-archive` (`clarify-request` ×3 → archive, `shape-product` ×3, `write-a-skill`,
  `write-study-doc`, `check-via-keyboard`), or a project skill path re-based onto `~/.agents`
  (`01a17ade…:33`, a `find` on the same missing dir failed again at :39).
- 6/26 `/tmp` screenshots never written; 6 project guesses (`AGENTS.md` has 3 candidates → no guess).

## Root cause

The model rebuilds the path of a skill's reference file from memory (wrong root or folder) instead of
reusing the `path` find_skill returned. Nothing in the harness checks it, so each miss costs the failed
call plus 1-2 recovery turns.

## Changes

- `features/path-resolve.ts` (resolver), `features/guard.ts` (`path_resolve` rule, `path` in `score`),
  tests `path-resolve.test.ts`, 6 cases in `evals/guard.jsonl` (exact 1.000, 26/26), `CONTRACTS.md`.
- pi: `extensions/decision/guard-path.ts` (+ test), `index.ts` (read/edit/ls asked only when the path is
  missing; rewrite assigns every `args` key; hints for read/find/grep/ls).
- Claude: `hooks/decision.ts` (`parseGuard` rewrite with `args`), `hooks/register.ts` (Read, Edit).

## Check

`bun test` 181 pass (decision), 68 pass (pi decision), `claude plugin test` 82 pass; a scratch daemon on
:45199 plus `pi -p` showed the rewrite and the hint reaching the model. Resolver ≤ 8 ms in Bun
(cold skill index 1.7 ms), so no Rust.

## Backlog

- `find /home/easydev` denials (6 in 3 days) could be rewritten to a bounded search instead of a deny.
- Same-project unique-basename rewrite deliberately left out (wrong-file risk); revisit with evidence.
- Claude 3 days: only 2 Read ENOENT (scratchpad screenshots, hint path), 1 Edit not-found (edit_hint), 1 Write on an unread existing file (harness rule, no guard). Live check: `claude -p` Read of a stale `skills/write-a-skill` path was rewritten.
- Lead (not done): `A="adb -s x"; $A …` fails silently under zsh (no word split, `command not found`), 3× pi / 3× Claude in 3 days; a guard rewrite to `${=A}` would need shell-aware parsing.

## Synthetic check (live :45130)

9 `/v1/guard` probes: pi/Claude skill rewrite, ambiguous `AGENTS.md` none, existing path none, `write` skipped, `/tmp` hint, wide find deny, `pkill` rewrite, EACCES none: all as expected; `pi -p` and `claude -p` each received the rewrite line.
