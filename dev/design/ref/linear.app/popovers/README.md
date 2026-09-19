# linear.app overview popovers

Cropped PNG evidence from `https://linear.app/easydevs/project/test-e6937f6cefe6/overview` (1440×900, dpr 1) vs theme-ref draft.

```text
popovers/{id}.png        live overlay
popovers/draft/{id}.png  reconstruction
popovers/index.json      live capture meta
popovers/draft/index.json
```

Ids: `project-actions`, `help`, `workspace`, `status`, `display-options`, `issue-panel`, `board-display-options`, `filter-options`, `priority-list` (the team-all list row's Change priority menu, 2026-09-14), plus draft-only `notifications`, `priority`, `lead`, `target-date`, `labels`, `milestone-actions`, `slack`, `resources`.

Agent chat (measured on `https://linear.app/easydevs/{agent,projects/all,team/EAS/all}`, CDP 9201, 2026-09-14) — shared chrome in `themes/linear/ref/app-footer.svelte`:

- `agent-help` — the footer's left corner control (`Open Help menu`), 24×24 circle at x10.
- `agent-footer` — open-chat state: the chip is filled and carries its ✕, then the `Agent` launcher and `Chat history`.
- `agent-footer-minimized` — after `Close chat` there is no chip at all; the launcher and `Chat history` stay.
- `agent-panel` — the 400×600 floating chat, opened 32px from the window's right edge and 34px off the bottom.

Live footer crops use a 340×40 window crop at the window's bottom-right (or 300×42 at the bottom-left for `agent-help`); the panel crop is 404×604 around the panel's border box. Draft counterparts sit in `draft/` at the same relative crop.
