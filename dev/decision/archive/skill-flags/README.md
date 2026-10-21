# skill-flags (archived 2026-10-21)

Wrote `disable-model-invocation: true` into every scanned `SKILL.md` so no harness listed routed skills.
That also made the Skill tool refuse them (it reads the flag as "user only"), so a hinted skill could not be loaded.

Replaced by folders: `.agents/skills-routed/` (find_skill's catalog, scanned by no harness) and
`.agents/skills/` (manual skills, authored flag). `daemon/` is the old module, unchanged.
