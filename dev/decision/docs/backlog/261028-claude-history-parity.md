# Claude hook sends no `history` to find_skill

## Conclusion

The pi extension sends `history` (last two exchanges, `historyExcerpt`) with every `find_skill` and
`model_route` prompt call; the Claude hook (`~/.agents/plugins/decision/hooks/register.ts`) sent none. A
short continuation reached the daemon with no context, so the right skill scored low and a
continuation that pi skips was routed (and tiered) as fresh work. Fixed in the Claude hook.

## Evidence

- Claude session `2bd85cf5` (2026-10-28), user turn 3 `폰을 adb 로 연결, dry Run 을 돌려보고 보완한다.`
  (transcript L312): `control-android` p 0.27 at 01:12:54 → `nothing applies`; first surfaced at 01:39:56
  (turn 9, p 0.64, hint only). The model drove adb for turns 2–9 without the skill, and never Read any
  `SKILL.md` that session.
- Replay with the excerpt built from the transcript (scratchpad `replay_hist.py`):
  - L312: no history → `control-android` 0.64 hint; with history → `control-android` 0.88 **body**,
    `run-karrot-pc` 0.81.
  - L399 `잠금을 풀었다.`: no history → `nothing applies` (a routed turn, a tier of `chat`/quick left
    in state); with history → `skipped: short continuation`.
- pi session `01a17d4c` (2026-10-27) injected bodies at p ≥ 0.85 and skipped continuations
  (`skipped-routing-burst` signals); audit window 3d: `find_skill` noise 59/131 joined (claude) vs 29/410 (pi),
  `model_route` `repeat_request` ×5 (claude) vs ×2 (pi).
- Path-touch matching was not the gap: replaying the session's touched files returns `stack-svelte` /
  `build-frontend` (already injected on turn 1) and `product-loop` for `.product/LOOP.md` (the session
  never touched a `.product` file).

## Root cause

`routePrompt` and `routeFindOnly` in `register.ts` built the body without `history`; `$.session.messages()`
(the transcript API) was never called. The daemon uses `history` in `find_skill` (`conversation_excerpt`,
`skipReason`) and `model_route` (`short continuation`), so only the client could close the gap.

## Files changed

- `~/.agents/plugins/decision/hooks/decision.ts`: `historyExcerpt(messages, current?, turns = 2)`, the
  port of pi's `historyExcerpt` (600-char clip, system-reminder blocks stripped, drops the prompt being
  routed if the transcript already holds it).
- `~/.agents/plugins/decision/hooks/register.ts`: `historyFor` (fail-open `try/catch`), passed as
  `history` by `routePrompt` (find_skill and model_route share `common`) and `routeFindOnly`.
- `~/.agents/plugins/decision/hooks/decision.test.ts`: four `history excerpt` tests.

## Check

- `bun test ./hooks/decision.test.ts` → 44 pass.
- `decision eval --feature find_skill --version v7` on the two new `evals/find_skill.jsonl` cases
  (`harness: claude`, with `history`): exact 1.000, recall 1.000.
- Live, fresh Claude session `ae8d0089` (haiku, cwd = this project, `claude -p` + `--resume`, 2026-10-28
  02:08–02:09). The plugin is read from `~/.agents/plugins/decision` (`claude plugin update` says "nothing to
  update"), so the edit was live at the next session start; an earlier note here saying Claude reads a cached
  install was wrong.
  - turn 2 `이제 실제 폰에서 dry run 을 돌려 확인해 보자.` (no adb word, history = the cooldown turn):
    `control-android` 0.67, injected as a hint.
  - turn 4 Read `src/lib/karrot/listing-row.svelte`: `stack-svelte` via path.
  - turn 5 Read `.product/LOOP.md`: `product-loop` via path, `shape-product` hint, `design-themes` and
    `theme-ref` paired.
  - bare `잠금을 풀었다.`: `find_skill` and `model_route` both `skipped: short continuation`. With a
    "도구는 쓰지 말고…" suffix the same words were routed (`nothing applies`): the skip is length-based.

## Backlog

- Done in this change: `CONTRACTS.md` (history bullet next to Skips) and the two `evals/find_skill.jsonl` cases.
- Touch calls (`paths`) send no history in either client: left as is.
- Hints (body only at p ≥ 0.85, so `control-android` 0.67 is a hint): in the live run haiku answered the adb
  turn without reading a `SKILL.md`. One run; `HINT_LEAD` wording not changed. Recheck with real work.
- `improve-skill` p 0.69 on turn 1 of `2bd85cf5` (a multi-part feature request) was noise; unexplained, one case.
- Type errors in `register.ts` (`Bash` tool.call result, `Edit`/`Write` matcher) and `decision.ts`
  (`rule.body` optional) existed before this change.

## Follow-up 261028: control-android scored 0.67 on a real-phone request

Conclusion: the `control-android` description was the owner. The apply judge sees only the first
`applyDescriptionChars` (420) of a description; this one was 681 chars, so its "Use when" clause was cut and
the visible text said nothing about a real phone, pairing or "run/check on the phone". Rewritten to 419 chars,
front-loaded (`~/.agents/skills-routed/system/control-android/SKILL.md`; the catalog re-parses on mtime, no restart).
No prompt (`prompts/find_skill/`) change was needed.

Scenarios (virtual, `source: scenario-261028`, 21 cases appended to `evals/find_skill.jsonl`: 14 phone positives,
7 negatives; tuned on 8 positives + 4 negatives, 8 held out and not read while editing):

| set | control-android p ≥ 0.85 before → after | negatives clean |
|---|---|---|
| tuning (6 scored positives) | 3/6 → 5/6 | 4/4 |
| held out (8 positives) | 4/8 → 7/8 | 4/4 |

Held-out movers: dimmer overlay via adb 0.80 → 0.89, wireless debugging on 0.67 → 0.89, retry press on phone
0.73 → 0.91. Full `decision eval --feature find_skill --version v7 --all`: 86 cases, recall 0.904 (floor 0.9 holds).
On the 63 older cases recall was 0.864 before and 0.858 after (below the floor already before); per-case diff:
two cases moved on skills that are not Android (Jev variance), one is a real side effect (below).
Live replay, fresh haiku session, user wording `이제 실제 폰에서 dry run 을 돌려 확인해 보자.` after a cooldown
summary turn: `control-android` 0.95 body injected, `run-karrot-pc` hint then read; haiku ran `phone serial` and
`adb devices -l` (permission-denied in `-p`). With the test suffix `도구는 쓰지 말고…` the same turn scored 0.71 (hint).

Leftovers:
- Side effect: `Firefox Android에서 팝업 설정 버튼이 options 페이지로 안 넘어가…` (case expects no skill) now gets
  `control-android` 0.58 as a hint. Accepted: a hint, and a miss costs more than an extra.
- Not fixed, by decision: `35211 포트에서 열림. 다시 시도` (terse retry after a pairing request) 0.48 → 0.82, a hint.
  In a live flow the skill is already loaded by then. `연결했어. 다시 해봐` and `응, 폰에서 진행해` are skipped as
  short continuations; kept out of evals. `screenrecord 로 …녹화` stays 0.49: the skill body has no screen
  recording, so the low score is right; add the recipe to the skill first if that work should route.
- `tasker-autox` (archived) appears as a 0.65–0.71 hint on phone requests; its description says archive but
  still shares the vocabulary. One more reason to look at it if hint noise matters.
- Audit: 13 routed skills have descriptions over 420 chars, none with "Use when" past char 420 now.
  A check for that (catalog warning) would stop this class early.

## Follow-up 261028 (2): recording, description audit, workflow skill

- Correction: `control-android`'s `SKILL.md` did mention recording (`phone rec`, `phone sheet`); it was one clipped line
  in step 2, not absent. Added `references/recording.md` (180 s segments, SIGINT stop, fixed-fps re-timing, host/phone
  clock offset, command-to-frame mapping, contact sheet) and a conditional link; the description now says "screen
  recording" and stays 419 chars. `screenrecord …프레임별로 탭` 0.49 → 0.95; added to `evals/find_skill.jsonl` (87 cases,
  recall 0.901, floor holds).
- Audit (`improve-decision-workflow/scripts/desc-audit.py`, 159 skills, window 420): description over 1024 chars: 1
  (`~/dev/hobby/gstack/.agents/skills-routed/gstack`, 1966 chars with a suggestion list and a reply script; now 321
  chars, the list moved into the body as "Proactive skill suggestions"; the file is generated from `SKILL.md.tmpl`
  upstream, regenerating overwrites it). `Use when` past the window: 0. Not touched, outside "description length":
  44 findings: `no-trigger` (short or manual skills), 17 `gstack-*` whose `name` differs from the directory, and
  SKILL.md over 300 lines (`reverse-engineer-anything` 358, `new-platform` 435, `permission-audit` 322, `gstack` 612).
- `write-a-skill`: the Description section said the shortlist sees 260 chars; v7 asks every candidate and the judge reads
  420 (`applyDescriptionChars`). Rewritten with the `control-android` case and a pointer to `desc-audit.py`.
- `improve-decision-workflow`: `decision-digest.py` now joins `log-*.jsonl` by session id and turn time (it printed `-`
  for every Claude turn before) and `recommended-not-read` counts hints only; new `desc-audit.py`,
  `probe-find-skill.py` (per-case p, `--skill`, `--sets`), `replay-claude.py` (fresh haiku session, per-turn route,
  find_skill, outcomes). SKILL.md: two table rows, scenario workflow in step 4, the 420-char cause in step 5, the
  plugin-liveness rule in step 8; signals.md: `client-field gap`, `description window`; examples.md: cases 4 and 5.
- Leftover: `desc-audit.py` and the other scripts have no tests; `decision-digest.py` was changed by a worker and
  checked only on two Claude sessions and one pi session.
