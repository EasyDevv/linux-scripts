# pi worker: no cost cap (decision)

Decided 261024: the pi worker (and its nested subagents, `docs/plan/261024-pi-worker-autonomy.md`) gets no USD budget or cost-based stop. Speed comes first.

## What exists (checked 261024)

- Observation only: `LedgerRow` records `usage.cost` per run (`~/.agents/plugins/pi/hooks/worker.ts:498-521`); `/worker` shows session and 30-day totals (30 days: 104 runs, $2.40).
- Time limits only: idle 5 min, wrap-up 12 min, max 15 min (`~/.config/pi-worker/config.json`). With nesting, `timeout(1)` signals its process group, which should reach the children; unverified (plan assumption A3).
- No cost cap exists, so nothing is archived.

## Backlog

- Revisit if a nested run's `cost` per call regularly exceeds a figure the user finds uncomfortable. Check: `evals/bench.ts` output, and the `/worker` 30-day line after a week of nested use.
- Worst case to watch: 16 concurrent processes (4 tasks x 4 subagents) each on `deepseek-v4.1-flash:max`.
