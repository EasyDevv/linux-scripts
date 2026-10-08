# linear/components

Copy these snippets into an app. Do not import this folder at runtime.

## category-tabs.svelte

Toolbar category tabs (Linear Issues **Active / Backlog / All issues**). Ghost `sm` pills, `h-7` `px-2.5` `font-medium`, selected `--tab-selected` / idle `--tab-idle`.

Reuse:

1. App needs `Button`. Copy this file into `$lib`.
2. `items: { id, label }[]`, `value`, `onPick(id)`.
3. Keep `data-role="chip"` and `aria-pressed`.
4. Do not use `bg-accent` for the selected tab.

## setting-section.svelte + setting-row.svelte

Body of every settings or form dialog: **category heading → `--secondary` well → rows** (Linear Settings › Security, `design.json` `settings.formFamily.groupHeader` / `settingRow`). Dashboard exemplars: `apps/client/src/lib/projects/workflow-dialog.svelte`, `org-goal-dialog.svelte`.

Reuse:

1. Copy both files into `$lib` (they style themselves with scoped CSS + tokens).
2. Body: `<div class="flex flex-col p-4 gap-6">` of `SettingSection`s (24px between groups in a dialog).
3. Each row: `<SettingRow id title description>` with one end-aligned control at a fixed width for its values (select `w-16`/`w-28`/`w-36`, input `w-40`) and `aria-describedby="{id}-desc"`. A changing description (name check) passes `live`.
4. Descriptions are one short line. A wrap is a copy problem: shorten it.
5. A control that does nothing in the current state stays and is `disabled`, with the description saying why. Do not hide the row (the dialog height would jump).
6. Header and footer stay the `controls.dialog` chrome below (kind-word title, circle close, pill Cancel / filled verb).

Not this: label-left `Field.Field` rows with a full-width control (`settings-dialog.svelte`, the older Providers form). Their label column and control column drift apart per row.

## settings-dialog.svelte

Dashboard **Providers** settings (`http://dashboard.localhost/`, source `apps/client/src/routes/+page.svelte`). Same chrome as `/sync` Settings: 480px Dialog, secondary wells, overlay Select, pill Cancel/Save.

Reuse:

1. App needs `Dialog`, `Field`, `Select`, `Input`, `Button`. If missing, copy those primitives from the dashboard `ui/` tree — do not rebuild the overlay.
2. Trigger: `outline` `icon-sm` `rounded-full` Settings icon, `aria-label="Settings"`.
3. Content: `w-[calc(100%-2rem)] max-w-[480px] gap-0 p-0 sm:max-w-[480px]`, `showCloseButton={false}`.
4. Select in a well: trigger `h-[30px]` / `--select-trigger-height`, `sideOffset={-(index * 32 + 30)}`, `avoidCollisions={false}`, `interactOutsideBehavior="ignore"` so the current value stays on the trigger.
5. Well rows: `@container overflow-hidden rounded-md bg-secondary`. Divider `mx-4` height `--hairline-width` fill `--foreground` at 0.1 (`data-role="row-divider"`), not `--border`.
6. Footer: `mx-0 mb-0 border-t-0 bg-transparent`. Cancel `secondary` pill, Save filled pill. Header/footer have no hairline (`design.json` `controls.dialog.noHeaderFooterRule`).

Replace labels, Select options, and `onSave` for the host product. Keep the geometry. New dialogs compose `setting-section` + `setting-row` instead.

## prop-picker.svelte

Linear command-palette popover (02-workspace **속성 · 상태**, 05-prompt **+ 추가**). Search field, 32px rows, hover/selected inset `::before`, optional icon + kbd, Check on the current value.

Reuse:

1. App needs `Popover` and `Button` (for custom `trigger`). Copy `prop-picker.svelte` next to the call site or into `$lib`.
2. Default trigger: labeled 28px inspector row (`label` + current value). Pass `trigger` snippet for a ghost `icon-sm` `+` (or any chrome button).
3. `search` string turns on the 37px filter field (`장르 추가…` / `상태 변경…`). Omit it for a plain list.
4. `align="end"` for header/row `+`. Default `align="start"` for property rows.
5. Items: `{ value, label?, icon?, iconClass?, kbd? }`. `onPick(value)` closes the menu.

Do not restyle the menu surface with `bg-popover` / default Popover shadow. Keep this file’s surface, 13px type, and `prop-menu-item` highlight.

## agent-composer/

Agent chat composer with an inline `/` command and `@` path palette. Box `bg-accent` + `--radius-sm` + `--panel-shadow` + `6px 4px` padding, editor on top, control row under it, palette anchored above the box (dashboard **05-projects**, source `.product/surfaces/05-projects/page.svelte`; reference `novel-writer .product/lib/agent-panel.svelte`).

Reuse:

1. Copy `prop-menu.ts`, `prop-menu.svelte`, `composer-tokens.ts` next to the call site or into `$lib`. The surface, the 32px row, and the `prop-menu-item` highlight are the same values `prop-picker.svelte` and `design.json` `popovers.sharedChrome` carry.
2. Make the composer box `position: relative` and put the palette inside it: `left: 0; right: 0; bottom: calc(100% + 6px); z-index: 1; overflow: hidden; max-width: 100%`, surface width `max-content`, `min-width: 180px`. Title row `8px 18px 2px 14px` in `--text-body-sm` 450 `--muted-foreground`; list `max-height: 320px; overflow-y: auto`.
3. Rows are `label + /alias` badge. Keep `data-highlighted` on the active index, move the index on `onmouseenter`, and `onmousedown` preventDefault so focus stays in the editor.
4. Re-read the caret token on `input`, `keyup`, `click`, and `focus` (`tokenAt(value, selectionStart)`). Reset the active index when the query changes and clear the dismissed flag when the token disappears.
5. Keys on the editor: ↑↓ move with wrap, Enter/Tab pick (`preventDefault`), Esc sets the dismissed flag to the current query. Do not intercept Enter while the menu is closed — the editor keeps its newline and submit stays on the send button.
6. ARIA: the button that owns the popup carries `aria-haspopup="listbox"` + `aria-expanded`, the editor carries `aria-controls` + `aria-activedescendant`, the list is `role="listbox"` with `role="option"` + `aria-selected` rows. `aria-expanded` on the editor itself warns (`a11y_role_supports_aria_props`, role textbox).
7. Pick inserts `{sigil}{alias} ` at the token and puts the caret after it; when a button opened the palette with no token, insert at the caret with one separating space. Clear the caret token when submit empties the field, or the empty field reopens the palette.
8. `hint` is the ghost line left after a pick: show it while the value equals the token, blank the editor’s ink (`color: transparent`) while keeping `caret-color`, and draw the overlay at the editor’s own type and padding.

## status-popover.svelte

02-workspace **속성.상태** row. Current value **검토중** uses `CirclePause` + `text-status-info` + kbd `3`. Copy `prop-picker.svelte` with this file.

Reuse:

1. Bind `value`. `onPick` optional.
2. Keep the five statuses, icon tokens (`text-status-neutral|highlight|info`), and kbd 1–5.
3. Search placeholder `상태 변경…`. Label width `40px` to match other 속성 rows.

Replace the status list only when the product’s states differ. Keep row geometry.

## tag-list-card.svelte

05-prompt **태그** / **서사 엔진** listing card. Folding `InspectorCard`, one refresh in `trailing` (card header right), per-group label + `+` PropPicker, selected values as accent pills.

Reuse:

1. Copy `inspector-card.svelte`, `inspector-chrome.ts`, and `prop-picker.svelte` with this file. App needs `Card` + `Button`.
2. Header refresh: ghost `icon-sm`, `text-muted-foreground hover:text-foreground`, aria `{title} 기본 선택`. Not one refresh per group.
3. Group `+`: PropPicker `trigger` snippet, `align="end"`, search `{label} 추가…`.
4. Pills: ghost `sm` `rounded-full bg-accent px-2.5 text-label-sm font-medium text-foreground`. Click removes.
5. Group header: 28px row, label `text-heading-sm text-muted-foreground`.

Swap `groups` / `defaults` for the host list (tags, cast kinds, …). Keep the header refresh vs row `+` split.

## inspector-card.svelte

Quiet inspector rectangle (`--inspector`, 16px header, fold caret). Needed by `tag-list-card`. Copy `inspector-chrome.ts` beside it.
