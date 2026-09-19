# linear theme-ref

shadcn-svelte reconstructions of `{designDir}/ref/linear.app/` using `../layout.css`.

Shared chrome: `app-sidebar.svelte`, `app-header.svelte`, `app-footer.svelte` composed by `shell.svelte`.

The footer carries the measured agent chat (`app-footer.svelte`, constants in `agentMark`): the left corner
`Open Help menu` disc, then the right cluster `chat chip → Agent launcher → Chat history` with 2px gaps and a 10px
window inset. Chip and launcher are both 8px-radius controls that read differently on purpose — the chip is the
filled surfaced one while its chat is open (and stays flat/muted while minimized), the launcher is a chromeless
icon+label that only fills on hover. Clicking either opens the 400x600 floating panel (32px right, 34px bottom),
whose 0.8px rim is the same tone as the chip's active fill (`--accent`) over a `--secondary` body, inside a 0.8px
`--background` ring. The launcher plane and the history circle-arrow are Linear's own filled glyphs (kept verbatim
in `agent-glyphs.ts`; lucide has no equivalent). Footer states: a minimized chat with content keeps its chip,
`Close chat` and the chip's own ✕ drop the chip, and opening with no session shows a `New chat` panel with no chip.
Evidence: `{designDir}/ref/linear.app/popovers/agent-{footer,footer-minimized,help,panel}.png` vs `popovers/draft/`.

Property menus (project overview aside): `prop-status.svelte`, `prop-priority.svelte` on `prop-picker.svelte` (RefMenu). Dates/labels: `prop-popover.svelte`.

Issue status glyphs live in `status-glyph.svelte` (measured 14x14 SVGs from the live app: dashed backlog ring, todo/progress arcs, filled done/canceled discs).

team-all toolbar surfaces (measured, live 2026-09-13/14): `team-display-options.svelte` (Display options popover, open by default), `team-filter-popover.svelte` (Add filter menu, opened by its trigger; the two are mutually exclusive like the live toolbar) and `team-aside.svelte` (issue detail rail docked right of the list). Evidence crops: `{designDir}/ref/linear.app/popovers/display-options.png`, `filter-options.png`, `issue-panel.png`.

List row priority cell (measured, live 2026-09-14): `team-list-priority.svelte` replaces the 16px grid column's
`---` placeholder with the icon button that opens the live "Change priority" menu — 16x36 trigger, no disc, glyph in
the row ink rgb(149,149,151) that brightens to #fff while the row is hovered. The menu reuses `ref-menu.svelte`
(`iconInk="muted"`) with the measured surface: 261.6x211 border-box anchored to the cell's left edge 4px under the
row, `Change priority to…` search row + a 37px-tall "P" chip, 6px-inset list of five 32px rows (icon 16x16,
13px/450 label, 12px/500 kbd, trailing check), 248x32 r8 hover/selected pill rgb(49,50,52), option icons
rgb(156,157,159). The live Urgent fill attribute (`lch(66% 80 48)`) is overridden by the row ink in both the cell
and the menu, so the draft paints ink, not a per-priority swatch. Evidence: `{designDir}/ref/linear.app/popovers/priority-list.png`
(live) and `popovers/draft/priority-list.png` (draft).

| page | source | surfaced in the draft |
| --- | --- | --- |
| `projects-all/page.svelte` | `/easydevs/team/EAS/projects/all` | list only |
| `team-all/page.svelte` | `/easydevs/team/EAS/all` | **List ⇄ Board switch** inside the Display options popover; both views render `team-list-view.svelte` / `team-board-view.svelte`; the list row priority cell renders `team-list-priority.svelte` |
| `project-overview/page.svelte` | `/easydevs/project/test-…/overview` | overview + property aside |

Board view (measured, live 2026-09-14): `team-board-card.svelte` renders one card (priority / project / label /
sub-issue chips, assignee avatar, Created footer). Board metrics: 348px columns with no gap, 50px header row with a
46px tab band that fades down the column, 319x117 cards on a 125px pitch, native horizontal scrollbar
(`scrollbar-color: rgb(87,88,90) transparent`), trailing 350px "Hidden columns" rail (scrollWidth 2098 in a 1186px
viewport). Evidence: `{designDir}/ref/linear.app/{desktop,tablet,mobile}/team-all-board.png` and
`{designDir}/ref/linear.app/popovers/board-display-options.png`.

Popover motion (measured 2026-09-14, `popover-motion.ts` + `chrome.json > popoverMotion`): the Display options surface enters over 58ms from `transform-origin: 100% 0` — scale 0.98 → 1 while opacity runs 0 → 2 (the live spring overshoots so the fade reads fast; the resting inline value is `opacity: 2`, painted clamped) — and leaves over 207ms with scale 1 → 0.98 in 49ms and an exponential opacity tail (≈26ms half-life) that unmounts at ~207ms. The Add filter menu runs the same spring on its popper container (frames 0.1971/0.983943 · 0.2919/0.985839 · 0.4418/0.988835, origin `129.2px -3.9px` = centre-x / trigger bottom), while its hover submenus appear instantly (verified frame-by-frame across all 16). Curve samples: `linear(0, 0.1377 22.4%, 0.3149 42.2%, 0.432 69.8%, 1 100%)` for the enter φ.

Filter submenus (measured 2026-09-14, `filter-submenus.ts`): hovering a row that carries a ▸ expands it to the left — the submenu's right edge sits 2.2px inside the menu's left edge, and each surface keeps its measured border-box size. Option rows show a 16x14 select box 14px in with the label at 60px; navigation rows (Dates, Relations, Project properties) drop the box and put the label at 38px; counts are 12px in `menuMark.arrow`. The six tall submenus carry the same 37px "Filter…" row as the menu. They appear instantly (no enter animation). Evidence: `{designDir}/ref/linear.app/popovers/filter-options.png`.

`team-all/page.svelte` owns the shell, the toolbar and the `view` state; the two view bodies stay separate files
(`team-list-view.svelte`, `team-board-view.svelte`) so neither depends on the other's markup. The Display options
segments call back into the page, exactly like the live popover (which swaps its rows for the active layout).
`team-list-view.svelte` owns each row's priority (a record field seeded from `data.ts`), the same way the live list
writes a picked priority back to its issue.

Preview (dashboard must list `theme-linear`):

```text
http://dashboard.localhost/design/draft?file=team-all/page.svelte&project=theme-linear&style=linear&scheme=dark
http://dashboard.localhost/design/draft?file=projects-all/page.svelte&project=theme-linear&style=linear&scheme=dark
```

PNG/MHTML stay in `{designDir}/ref/linear.app/`.
