# pi worker nested-parallel bench: results and decision

Decision (261024, user confirmed): `autonomy` defaults to **off**; parallelism is the orchestrator's `tasks`; `autonomy: on` is an opt-in with lean tools. See `docs/plan/261024-pi-worker-autonomy.md`.

## Method

`evals/bench.ts`, model `deepseek-v4.1-flash:high`, fresh copy of `dev/decision` per run, one run per cell in the first table, three runs in the repeat table (small samples), cost includes the child's subagents (fixed 261024: `Outcome.nested`). Neutral briefs unless marked P (brief asks for parallel subagents).

Configurations: `off` base tools, no spawning; `full` autonomy on with pi's whole default tool set (22.6k input tokens per child); `lean` autonomy on with `read,grep,find,ls,bash,edit,write,subagent,find_skill,find_tool` + agent `worker-sub` (about 5k); `leanP`/`fullP` the same with the brief asking for parallel subagents; `fan` four separate `off` workers at once (what `tasks` does).

## Results

| scenario | config | ms | cost | subagents | ok |
|---|---|---|---|---|---|
| tests4 (4 light writes) | off | 57,113 | $0.0094 | 0 | yes |
| | full | 112,765 | $0.0215 | 0 | yes |
| | lean | 90,894 | $0.0136 | 0 | yes |
| | leanP | 165,696 | $0.0358 | 4 | yes |
| | fullP | 165,048 | $0.0466 | 4 | yes |
| | fan | 79,165 | $0.0206 | 0 | yes |
| heavy4 (4 writes, 10+ cases) | off | 188,834 | $0.0186 | 0 | yes |
| | full | 174,166 | $0.0230 | 0 | NO (tests fail) |
| | lean | 288,514 | $0.0298 | 0 | NO (tests fail) |
| | leanP | 193,123 | $0.0400 | 4 | yes |
| | fullP | 142,894 | $0.0489 | 4 | yes |
| | fan | 88,840 | $0.0295 | 0 | yes |
| explore4 (4 reads) | off / full / lean | 9.4 / 9.4 / 7.8 s | $0.0012 / 0.0044 / 0.0027 | 0 | yes |
| single (one tiny edit) | off / full / lean | 8.5 / 12.1 / 9.4 s | $0.0014 / 0.0039 / 0.0013 | 0 | yes |
| shared (3 pieces, one file) | off / full / lean | 22.6 / 20.2 / 31.3 s | $0.0025 / 0.0050 / 0.0031 | 0 | yes |

## Repeat results (3 runs per cell, median)

| scenario | config | time | cost | subagents | ok |
|---|---|---|---|---|---|
| tests4 | off | 53 s (45-63) | $0.0083 | 0 | 3/3 |
| | fan | 42 s (30-49) | $0.0163 | 0 | 3/3 |
| | leanP | 118 s (110-125) | $0.0333 | 4 | 3/3 |
| heavy4 | off | 102 s (102-109) | $0.0151 | 0 | 3/3 |
| | fan | 100 s (48-147) | $0.0282 | 0 | 2/3 |
| | leanP | 152 s (121-237) | $0.0478 | 4 | 3/3 |
| discover (6 files found mid-task) | off | 80 s (78-91) | $0.0128 | 0 | 3/3 |
| | leanP | 185 s (160-399) | $0.0443 | 4-6 | 2/3 |

## Reading

- With a neutral brief the model spawned a subagent in **0 of 15** runs, so the system prompt alone does not make this model parallelize; `full` and `lean` only added cost (full 1.3 to 3.5x).
- With an explicit "run as parallel subagents" brief, 4 spawned every time but the result was slower or only 24% faster (fullP heavy4) at 2.2 to 4x the cost.
- Four separate base workers (`tasks`) cut heavy4 from 189 s to 89 s in the single run, but the repeats do not hold that: `off` was 102 s in the repeats (the 189 s run was an outlier), `fan` ranged 48 to 147 s and failed once. `fan` was faster only on tests4 (42 s vs 53 s, 2x the cost). Treat `tasks` as a modest speed-up at about 2x the cost, not a firm 2x.
- Nested parallel (`leanP`) lost on every scenario in the repeats: 2 to 2.5x slower than `off` at 3 to 4x the cost, including `discover`, where the pieces are only known mid-task. The one reason `autonomy: on` was meant to exist did not show a benefit.
- The two `NO` rows (full, lean on heavy4: tests fail) are single runs; `off` and every explicit-parallel run passed. Not a conclusion about the configuration; re-run before reading anything into it.
- Lock friction was never exercised: `lockBlocks` stayed 0 (no run had two writers on one file). The live check on 261024 did block a same-file edit.

## Backlog

- Done 261024: `evals/run.sh r4` with plugin 0.3.0 passed 12/12 ($1.28). `s04-parallel3` sent 3 tasks in one `tasks` batch, `s05-parallel-write` 2, `s10-mixed` 2; one-step and design work stayed in the orchestrator. One round only, so not a stability claim.
- Verified 261024 (A3): normal exit and SIGTERM release the lock; SIGKILL leaves it, and the next worker clears it; subagent pi processes die with the parent. Detached bash grandchildren (e.g. `sleep`) leak, as with the base worker.
