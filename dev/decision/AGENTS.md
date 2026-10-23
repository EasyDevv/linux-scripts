# decision

Typed routing decisions served over HTTP to two harnesses. This repo is the source of truth; the
harness-side clients are thin and fail-open.

## Harness linkage (do not fork the logic into them)

| Consumer | Path |
| --- | --- |
| pi extension | `~/.pi/agent/extensions/decision/` (`index.ts` hooks, `client.ts`, `config.ts`, `skills.ts`, `route.ts`) |
| Claude Code plugin | `~/.agents/plugins/decision/hooks/` (`register.ts`, `decision.ts`) |

- Daemon `decision serve` on `http://127.0.0.1:45130` (`DECISION_URL` overrides), run as the
  `decision.service` systemd user unit. Clients change nothing when the daemon is down, slow, or
  answers `status != "routed"`.
- `CONTRACTS.md` is the shared contract: change it first, then both clients. `POST /v1/*` shapes,
  `FeatureResult`, `harness`/`sessionId`, skip reasons.
- A feature change lands in both clients, including client-only behaviour (commands, status line,
  context delivery). Check each harness's own limits and test each one (pi `bun test`, Claude
  `claude plugin test`); where one cannot match, say so in CONTRACTS.md.
- Tier config lives outside this repo at `~/.config/decision/tiers.json` (`tiers.ts`), one list per
  harness (`pi` → `models.profiles` ladder, `claude` → catch-all model).
- `decision audit` joins the decision log with the harness transcripts (`PI_CODING_AGENT_DIR` or
  `~/.pi/agent/sessions`, `~/.claude/projects`).
- Skill exposure is the folder (CONTRACTS.md › find_skill): `.agents/skills-routed/` is find_skill's
  catalog and no harness scans it; `.agents/skills/` holds manual skills the harnesses scan and the
  catalog ignores. Nothing rewrites frontmatter; the old flag pass is in `archive/skill-flags/`.
