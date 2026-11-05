# Computer-use skills on a quick worker (`delegate: quick`)

## Conclusion

- Keep `delegate: quick`. With the skill's work handed to a quick worker, every run that ran to the end got the right answer. A heavier task (web clicks, desktop screenshot) cost less in total, parent plus child: Claude web -18 to -30%, pi web -50 to -53%, pi desktop up to -66% (r3), Claude desktop about equal.
- Delegation is about 2x slower (web 80 s against 35 s on Claude). The worker child costs $0.002 to $0.007; the saving is the parent context it never reads (Claude web 58k against 121k to 154k input tokens).
- Small read-only work (android getprop, a page title) costs more when delegated (+20 to 25%, r1). Note v2 says to do one or two short commands yourself; afterwards neither harness delegated `small` (0/6, r2).
- Tier choice on Claude: after v2 it still set `standard` on web in 2 of 3 runs. v3 adds "clicks and typing included", and in cu-r4 it picked quick in 5 of 6 delegations (web 2/3, desktop 3/3). **v3 adopted.** This was the second wording iteration, so iteration stops here.
- The one standard run in cu-r4 (web-2) stalled for 12 min in the worker (44 tool calls, click failed), then the parent did the work itself: $0.259 and 773 s. Every quick run was right. With n=3 and that outlier, Claude web is mixed in cu-r4: delegate median $0.259 against $0.217 direct, while r2 gave $0.176 against $0.215. Opus parent cost alone varied from $0.17 to $0.29 on runs with just one worker call.

## Rounds (`~/.agents/plugins/pi/evals/computer-use.py`, rows in `~/.cache/pi-worker-evals/<round>/`)

| Round | Note | Bench fixes | Notes |
|---|---|---|---|
| cu-r1 | v1 | - | android 2 runs (phone went offline); desktop session names collided |
| cu-r2 | v2: exact tier, trust the report, small work stays | glyph-safe codes, `small` scenario | one desktop miss came from the name collision, not the model |
| cu-r3 | v3: Claude tier wording | unique session names, pi direct `--exclude-tools subagent` | Claude hit the 5-hour usage limit after round 0; pi complete |

r1/r2 pi direct used a `--tools` allowlist, which dropped tool schemas and made direct look cheaper. In r3 (fixed), pi web came to $0.116 delegated against $0.244 direct, and desktop $0.081 against $0.238.

| cu-r4 | v3 | as r3 | Claude only; desktop delegate $0.198 against $0.209 direct, small kept by the parent 3/3 |
| cu-r5 | v3, Claude parent `--model sonnet` | android on the emulator (`medium_phone`, `emulator-5554`) | 48/48 exact; every delegation picked quick (17/17) |

### cu-r5 (Sonnet parent, emulator android), median $ total, delegate against direct

| scenario | Claude (Sonnet) | pi (grok-4.7:high) |
|---|---|---|
| web | 0.082 / 0.092 (-11%) | 0.098 / 0.241 (-59%) |
| desktop | 0.096 / 0.096 (equal; parent in-tokens 92k / 145k) | 0.074 / 0.229 (-68%) |
| small | 0.080 / 0.075 (+7%, delegated 2/3) | 0.049 / 0.046 (delegated 0/3) |
| android | 0.068 / 0.065 (+5%, delegated 2/3) | 0.063 / 0.051 (delegated 1/3) |

Sonnet ignores the "one or two short commands yourself" clause in 2 of 3 runs on small and android; the loss is small ($0.003 to $0.005) but it is 2x slower.

### Worker stall (cu-r4 web-2) and the `browser` CLI fixes

The 12-min stall was not slowness: the worker's headless Chromium never committed the first navigation (tab on about:blank), and it spent 44 calls diagnosing. More time would not have helped. Causes found and fixed in `dev/browser`:

1. `/etc/chromium/policies/managed/ublock.json` force-installs a uBlock Origin dev build into every profile. From a profile's second launch on, it holds the first navigation until its filter lists load. `open --headless` now passes `--disable-extensions` unless `--load-extension` is given (a stalled profile went from 3/3 stuck to 3/3 `page ok`).
2. A project profile already held by a live browser (a parent and its worker in one dir): Chromium hands the URL to the running instance and exits, so the new port never answers. `open` now reads `SingletonLock` and falls back to a throwaway profile, naming it in the output line.
3. The port lock was created with `open(wx)` and then written, so a concurrent reader saw an empty file and `open` died (1/24 in a 4×6 stress). It is now written aside and `link()`ed; an unreadable lock counts as held (aged by mtime).
4. The lock goes idle after 60 s, after which `open` on that port attached to another run's browser and reset its tabs. It now attaches only to a global-profile port or a browser launched from the same profile; otherwise it moves to a free port.
5. `open` used to print success before the page loaded. It now waits for the first tab (`--load-timeout`, 15 s; a tab still on about:blank gives up at 5 s) and prints `page ok "<title>" <s>`. A hung browser is retried once on a throwaway profile. Otherwise it exits 3 with whether the site answered a plain fetch, and closes what it launched, removing a throwaway profile.

The delegation note in both clients (and CONTRACTS.md) now tells the worker to stop and report after two failed tries instead of diagnosing.

| Round | Setup | stalls (`⚠`/exit 3) | delegate exact | $ delegate / direct (median) |
|---|---|---|---|---|
| cu-r6 | web ×6, 4 jobs, CLI fixes 3–5 | 1 (recovered by retry) | 12/12 | Claude 0.094 / 0.104 · pi 0.079 / 0.242 |
| cu-r7 | + fix 2 | 1 (recovered by retry) | 12/12 | Claude 0.091 / 0.102 · pi 0.103 / 0.253 |
| cu-r8 | + fix 1 | 0 | 12/12 | Claude 0.091 / 0.103 · pi 0.089 / 0.248 |

Remaining outlier: the pi parent (grok-4.7) redid the whole task after a correct report in 2 of 18 runs (cu-r6 web-1 $0.46, cu-r7 web-4 $0.38). Its "one cheap read-back" was `browser fetch`, which reloads the page before the click and showed a different initial row count, and the parent took that as a contradiction. Proposed wording below, not applied (past the two-iteration stop).

## Repro

`[CLAUDE_PARENT=sonnet] ANDROID_SERIAL_BENCH=<serial|emulator-5554> python3 -I evals/computer-use.py <round> --runs 3 --only web,desktop,small[,android]`

## Open

- Claude web cost on v3 is within noise at n=3. To settle it: `--runs 6 --harness claude --only web`.
- Read-back wording: a read-back that observes a different page state (a fresh load, before the click) is not a contradiction; re-do only when the report lacks a value or contradicts itself. Would be the third iteration.
- uBlock policy: setting uBO's `suspendUntilListsAreLoaded` to false through `/etc/chromium/policies/managed` would also fix windowed runs (a system file, needs sudo).
- With a Sonnet parent, small read-only work is still delegated 2/3 (cu-r5). A third wording iteration is past the stop rule; revisit only if the cost of small work matters.
