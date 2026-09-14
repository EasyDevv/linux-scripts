# linear/components

Copy these snippets into an app. Do not import this folder at runtime.

## category-tabs.svelte

Toolbar category tabs (Linear Issues **Active / Backlog / All issues**). Ghost `sm` pills, `h-7` `px-2.5` `font-medium`, selected `--tab-selected` / idle `--tab-idle`.

Reuse:

1. App needs `Button`. Copy this file into `$lib`.
2. `items: { id, label }[]`, `value`, `onPick(id)`.
3. Keep `data-role="chip"` and `aria-pressed`.
4. Do not use `bg-accent` for the selected tab.

## settings-dialog.svelte

Dashboard **Providers** settings (`http://dashboard.localhost/`, source `apps/client/src/routes/+page.svelte`). Same chrome as `/sync` Settings: 480px Dialog, secondary wells, overlay Select, pill Cancel/Save.

Reuse:

1. App needs `Dialog`, `Field`, `Select`, `Input`, `Button`. If missing, copy those primitives from the dashboard `ui/` tree — do not rebuild the overlay.
2. Trigger: `outline` `icon-sm` `rounded-full` Settings icon, `aria-label="Settings"`.
3. Content: `w-[calc(100%-2rem)] max-w-[480px] gap-0 p-0 sm:max-w-[480px]`, `showCloseButton={false}`.
4. Select in a well: trigger `h-[30px]` / `--select-trigger-height`, `sideOffset={-(index * 32 + 30)}`, `avoidCollisions={false}`, `interactOutsideBehavior="ignore"` so the current value stays on the trigger.
5. Well rows: `@container overflow-hidden rounded-md bg-secondary`. Divider `mx-4` height `--hairline-width` fill `--foreground` at 0.1 (`data-role="row-divider"`), not `--border`.
6. Footer: `mx-0 mb-0 border-t-0 bg-transparent`. Cancel `secondary` pill, Save filled pill. Header/footer have no hairline (`design.json` `controls.dialog.noHeaderFooterRule`).

Replace labels, Select options, and `onSave` for the host product. Keep the geometry.

## prop-picker.svelte

Linear command-palette popover (02-workspace **속성 · 상태**, 05-prompt **+ 추가**). Search field, 32px rows, hover/selected inset `::before`, optional icon + kbd, Check on the current value.

Reuse:

1. App needs `Popover` and `Button` (for custom `trigger`). Copy `prop-picker.svelte` next to the call site or into `$lib`.
2. Default trigger: labeled 28px inspector row (`label` + current value). Pass `trigger` snippet for a ghost `icon-sm` `+` (or any chrome button).
3. `search` string turns on the 37px filter field (`장르 추가…` / `상태 변경…`). Omit it for a plain list.
4. `align="end"` for header/row `+`. Default `align="start"` for property rows.
5. Items: `{ value, label?, icon?, iconClass?, kbd? }`. `onPick(value)` closes the menu.

Do not restyle the menu surface with `bg-popover` / default Popover shadow. Keep this file’s surface, 13px type, and `prop-menu-item` highlight.

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
