# orchestrator (archived 2026-10-21)

`POST /v1/orchestrate` and pi's `/orchestrate` were removed from the live config. Why: the lead
model already holds the task and the Agent/subagent tool descriptions, so a cheap classifier's
plan is a second judgment the model re-makes (the plan is advisory). `decision audit --since 7d`
(2026-10-21) found 0 real calls from pi or claude (83 eval/cli), role precision 0.757.

Layout mirrors the live tree so a restore is a move back:

- `daemon/` → this repo: `features/orchestrator{,.test}.ts`, `prompts/orchestrator/v1.json`,
  `evals/orchestrator.jsonl`, `docs/eval/261018-orchestrator-v1.*`, `.product/surfaces/04-orchestrate/`.
- `pi/` → `~/.pi/agent/extensions/decision/`: `orchestrate{,.test}.ts`.

Restore also needs: `features/index.ts` entry, `CONTRACTS.md` `POST /v1/orchestrate` section and
the `planned`/`spawned` outcome signals, `audit.ts` (`SIGNAL_FEATURE`, the orchestrator verdict
branch and `SUBAGENT_TOOLS`), pi `client.ts` (`requestOrchestrate`, `Feature` union), `config.ts`
(`orchestrate`), `index.ts` (`/orchestrate`, `plannedBy`, `startWaiters`, `/decision why` section),
`config.jsonc` `workloads.decision.orchestrate`. `bun test` skips `archive/` (`bunfig.toml`).
