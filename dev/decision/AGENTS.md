# decision

Typed routing decisions served over HTTP to two harnesses. This repo is the source of truth; the
harness-side clients are thin and fail-open.

## Harness linkage (do not fork the logic into them)

| Consumer | Path |
| --- | --- |
| pi extension | `~/.pi/agent/extensions/decision/` (`index.ts` hooks, `client.ts`, `config.ts`, `skills.ts`, `route.ts`) |
| Claude Code plugin | `~/.agents/plugins/decision/hooks/` (`register.ts`, `decision.ts`) |
| skill flags (pi + Claude) | `skill-flags/` — `core.ts` is harness-agnostic, `index.ts` is the pi extension (loaded from `~/.pi/agent/settings.json` `extensions`), `sync.ts` is the one-shot entry the Claude `agents-rules` SessionStart hook runs |

- Daemon `decision serve` on `http://127.0.0.1:45130` (`DECISION_URL` overrides), run as the
  `decision.service` systemd user unit. Clients change nothing when the daemon is down, slow, or
  answers `status != "routed"`.
- `CONTRACTS.md` is the shared contract: change it first, then both clients. `POST /v1/*` shapes,
  `FeatureResult`, `harness`/`sessionId`, skip reasons.
- Tier config lives outside this repo at `~/.config/decision/tiers.json` (`tiers.ts`), one list per
  harness (`pi` → `models.profiles` ladder, `claude` → catch-all model).
- `decision audit` joins the decision log with the harness transcripts (`PI_CODING_AGENT_DIR` or
  `~/.pi/agent/sessions`, `~/.claude/projects`).
- Skill exposure is a script, not a model call: every `SKILL.md` a harness scans carries
  `disable-model-invocation: true` (`skill-flags/core.ts`), so no description reaches the model
  catalog and find_skill names the skill a prompt needs. Roots are `~/.agents/skills`,
  `~/.agents/skills-optional`, the current project's `.agents/skills`, and every `.agents/skills`
  under `~/.config/decision/skill-flags.json` `projectRoots` (default `~/dev`, `maxDepth` 2).
  The pi factory syncs before pi scans skills and watches the current project; Claude Code runs the
  same sync from its SessionStart hook. `_manual/` only means find_skill never recommends a skill.
