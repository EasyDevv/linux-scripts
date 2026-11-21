# Guard review 261121: rm to the trash, quote_glob stops costing re-issues

## Conclusion

- The deletions blocked in session dbaba518 (subagent agent-a02983ca094781b5e, JSONL lines 372, 380, 405, 429) were denied by the Claude Code auto mode classifier ([Irreversible Local Destruction]), not by decision. decision had no rm rule.
- New rule `rm_trash` (pi): `rm` → `trash-put`. Claude Code gets the same from an `rm` function in `~/.zshenv` (under CLAUDECODE), because a hook rewrite under auto mode is not covered by the classifier's review: a rewritten Bash call must be sent again, and a rewritten REPL inner call is refused outright (seen live in session 0e564b8b).
- `quote_glob` no longer rewrites a glob glued to an option (`--include=*.ts`). Claude Code's zsh has had `no_nomatch` since 261019 and pi runs bash, so it passed as typed anyway. Over the week to 261121 the rewrite fired 83 times in Claude, and 57 of those came back as "auto mode classifier gave no verdict … issue the call once more": one wasted turn each.
- wide_search (9 denials) and wait_loop (2) were justified: each command walked ~ or / without a depth limit, or polled in the foreground.

## Evidence

- `tool-errors.py --since 7d`: 57 × "The server-side auto mode classifier gave no verdict for Bash: a hook changed this call's input", in 25 sessions.
- `guard-replay.py --since 7d`: claude rewrite quote_glob 78, all glued to an option.

## Files changed

- features/guard.ts, features/guard.test.ts (quote_glob glued case → none; rm_trash cases), evals/guard.jsonl (2 cases relabelled none, 1 rm_trash case), CONTRACTS.md › /v1/guard.
- ~/.zshenv (rm function), ~/.claude/CLAUDE.md (trash-put line).

## Check

- `bun test`: 195 pass. `decision eval --feature guard --version v1 --all`: exact 1.000 (27/27).
- Scratch daemon (port 45197): pi `rm -rf data/signal/macro && ls` → rewrite `trash-put -rf …`; claude `--include=*.ts` → none.
- zsh: `CLAUDECODE=1 zsh -c 'rm -rf <dir>'` moves the dir to the trash; /tmp paths and `--preserve-root` use the real rm.

## Follow-up the same day: measure what guards cost

- Guard input `gateHarness` (CONTRACTS.md): guard-replay and `decision eval` log as `harness: "eval"` but gate on the session's harness, so the Claude-only negative `rm_trash` case is now an eval row (28/28).
- `tool-errors.py` › `blocked by` counts blocks by source (decision guard, hook, auto mode classifier, unreviewed rewrite, user). `guard-replay.py` › `guard cost` counts rewrites auto mode sent back (58) or refused (1), and lists each deny with the call after it.
- AGENTS.md › Design intent: "Guard: never stop legitimate work" (user, 261121). Skill `improve-decision-workflow` (steps 2, 3, 5, 8, signals › Blocks and guard cost, example 6) and the `analyze-claude-sessions` rubric (block attribution, live hook probe) carry it.

## Backlog

- The live daemon (45130) still serves the old guard until it is restarted (not done here, not asked).
- Remaining Bash rewrites (pkill_self, quote_glob as its own word) still cost a re-issue under Claude auto mode, and a refusal inside REPL. Option: a Claude client in auto mode turns a rewrite into a deny that carries the fixed command.
- eval forces `harness: "eval"`, so a Claude-only negative case cannot be an eval row; it is a unit test.
- Done 261121 (user asked): daemon restarted (`rm_trash` served). `quant/scripts/holdout-guard.ts` drops exclusions before its vault rule (`--glob '!…'`, `--exclude-dir=`, `-not -path`, `':!…'`, a piped `grep -v`, `git status`) and limits the archive rule to `quant-retired-261116`: 13 of the week's 26 blocks now pass, the rest still deny. Left as is: heredoc edits whose text names the vault (cannot be told from a read); the deny message now points to Edit/Write and the Grep tool.
