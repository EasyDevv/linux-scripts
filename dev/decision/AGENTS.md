# decision

Typed routing decisions served over HTTP to two harnesses. This repo is the source of truth; the
harness-side clients are thin and fail-open.

## Design intent (user-confirmed 261023)

Settle a design change against these before tuning numbers. Reopen one only on a new fact, and name it.

- **Purpose: behaviour quality.** decision exists so the agent follows the skill and procedure the
  work needs. Smaller context and cheaper models serve that goal; neither may override it.
- **A miss is worse than an extra.** When recall and tokens or cache conflict, recall wins, with no
  token cap. Measure recall before exact and precision.
- **Authority: inject when confident, hint otherwise.** A high-p skill's body goes into context, and
  the rest stay as names and paths. Never block or undo an action because a skill was not read.
- **Every sentence a person writes is routed:** the prompt, question answers (`AskUserQuestion`,
  `ask_user_question`), queued and steering messages, and feedback typed into a denial or a plan
  review. Text the agent writes itself is not routed.
- **Latency: find_skill may hold the start of a turn for about 3 s.** Judge every candidate in that
  window (parallel or one wide call); at the deadline, return what has come back.
- **Failure: code fallback.** When Jev is down or slow, `paths:` globs and keyword matching still
  return candidates, as hints only: no bodies and nothing blocked.
- **Routing knowledge lives in the router.** A `SKILL.md` `description` says what the skill does.
  General routing judgments ("pasted inspector JSON or a log is payload, not the request"; "an error
  in a running app is reproduced first") live in `prompts/find_skill/` and `evals/`, not in
  descriptions.
- **Verified by labelled eval plus session replay.** `decision eval` reports recall, then exact. A
  reported failure is replayed with `claude -p` (or pi) to check behaviour: was the skill read, did
  the agent ask instead of act.
- **Scope: global features only.** Core features serve every harness: `find_skill` (+rules),
  `model_route`, `guard` + `loop`, and `find_tool`. A feature only one app uses moves into that app;
  `dispatch` belongs to the dashboard, which may still call `POST /v1/decide` for Jev.

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
