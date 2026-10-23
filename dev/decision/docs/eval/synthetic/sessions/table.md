| idx | injected (body) | hinted (p) | read/used | miss? | unneeded? | asked? | label doubt |
|---|---|---|---|---|---|---|---|
| 0 | build-frontend, rules svelte-effects + frontend-consistency | bun-webview .67, shadcn-svelte .65 | svelte-effects context used in diagnosis; no SKILL.md read | none | frontend-consistency (no capture compare) | yes (asked to re-enable Edit) | no |
| 1 | rules frontend-consistency + svelte-effects | shadcn-svelte .96, build-frontend .78 | shadcn-svelte/SKILL.md | none | both rules | yes (target tree absent) | no |
| 4 | rule svelte-effects | shadcn-svelte .89, bun-webview .61 | shadcn-svelte/SKILL.md | bun-webview (repro unavailable: Bash denied) | svelte-effects | yes | expected bun-webview is right, environment blocked it |
| 6 | none | bun-webview .89, browser .76 | bun-webview/SKILL.md, browser/SKILL.md | none | none | yes (Bash denied) | no |
| 8 | rule svelte-effects | bun-webview .95, browser .78, orca-cli .67 | bun-webview/SKILL.md | none | svelte-effects, orca-cli | yes (Bash denied) | no |
| 9 | browser (.98) | none | browser body used; no file read | none | none | yes (Bash denied, .invalid host) | no |
| 12 | analyze-pi-sessions .98, analyze-claude-sessions .86 | improve-decision-workflow .82 | analyze-pi-sessions/references/analysis-rubric.md | none | analyze-claude-sessions, improve-decision-workflow | no (both runs rc=1 error_max_turns) | label right; retry also max-turns |
| 15 | write-plan .97 | none | write-plan references structure.md, changes.md | none | none | yes (changed decision not supplied) | no |
| 18 | none | write-a-rule .64 | write-a-rule/SKILL.md (turn 2) | body-level miss, hint worked | write-a-skill also hinted/evaluated | yes | no; label fine |
| 19 | build-frontend .96, improve-ux .88; rules frontend-consistency + svelte-effects | shadcn-svelte .60 | none; Bash denied | capture not possible (environment) | improve-ux, svelte-effects | yes (Bash denied) | no |
| 20 | none | none | none | none | none | no (answered directly) | no (correctly-none) |
| 22 | none | none | none | none | none | no (answered directly) | no (correctly-none) |

Notes: injection means `body` present in the shadow find_skill result; hints are names/paths only and the agent may Read them.
The plugin URL proof: session e1a292dd (scenario 0) had find_skill/harness=claude entries in `$S/state/decision/log-261023.jsonl`; `~/.local/state/decision/log-261023.jsonl` had 0 lines mentioning any of the 12 session ids. `DECISION_URL` is read in `register.ts` `locate()` via `parseConfig(..., $.env.get("DECISION_URL"), ...)`, and env wins over `claude.json`.
Audit (`XDG_STATE_HOME=$S/state bun main.ts audit --since 1d --harness claude`) agrees on injected-noise (bun-webview/shadcn/browser/build-frontend/improve-ux/svelte-effects) but disagrees on hints: it reports "write-a-rule read without a recommendation" for 96145d91, because a hint (no body) is not counted as a recommendation, and it flags improve-decision-workflow noise for sessions where it was only hinted. docs/audit and candidates/find_skill.jsonl were restored to tracked state.
Environment caveat: Bash/Edit were disallowed as specified, so browser/bun-webview/capture scenarios could not act; several agents correctly asked instead. The fake project lacked the `$lib/components/ui` files (write-protected by the tool guard), which made scenarios 1/4 ask about the target tree.
