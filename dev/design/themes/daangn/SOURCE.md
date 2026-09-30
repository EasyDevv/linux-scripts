# source — daangn (SEED Design)

## Reference

- Repository: https://github.com/daangn/seed-design — 당근 디자인 시스템 SEED
- Clone: `~/.ref/seed-design` (commit `6288304`, 2026-09-29)
- Token source: `packages/rootage/*.yaml` (foundation) and `packages/rootage/components/*.yaml`
  (component specs), read through the generated `packages/rootage/__generated__/**/*.json`.
- Font stack: `packages/css/base.css` `--seed-font-family`.
- Breakpoints: `packages/css/breakpoints/index.mjs`.
- Token layering copied from `themes/linear` (via `themes/toss`, which already applied it):
  palette → roles → shadcn slots → component geometry → type roles.

## Method

Nothing is measured from pixels. SEED publishes its tokens as data with two colour modes
(`theme-light`, `theme-dark`), so `.build/extract.ts` resolves every rootage token once and
writes `spec.json`; `.build/emit.ts` (the toss emitter) merges that into `_core/layout.css`
and appends `.build/chrome.css` (shadcn `data-slot` chrome from the component specs).

```bash
bun ~/.local/share/scripts/dev/design/themes/daangn/.build/extract.ts   # rootage → spec.json
bun ~/.local/share/scripts/dev/design/themes/daangn/.build/emit.ts      # spec.json + chrome.css → layout.css
```

Refresh after a SEED release: `git -C ~/.ref/seed-design pull`, then the two commands above.

## Token layers

| layer | names | source |
| --- | --- | --- |
| palette | `--palette-gray-00 … 1000`, `--palette-{carrot,blue,red,green,yellow,purple}-100 … 1000`, `--palette-static-{black,white}(-alpha-*)` | `color.yaml` `$color.palette.*` |
| roles | `--fg-*`, `--bg-*`, `--stroke-*` (SEED names kept), `--manner-temp-*`, `--banner-*` | `color.yaml` semantic tokens |
| shadcn | `--background` = basement, `--card` = layer-default, `--primary` = brand-solid, `--border` = stroke-neutral-muted, `--input` = stroke-neutral-weak, `--ring` = focus-ring | mapping in `extract.ts` |
| foundation | `--radius-r0-5 … r6, full`, `--shadow-s1 … s3`, `--duration-d1 … d6`, `--ease-*`, `--scale-s95/97/98`, `--spacing-*`, `--gradient-*`, `--breakpoint-*` | `radius`, `shadow`, `duration`, `timing-function`, `scale`, `dimension`, `gradient` |
| components | `--control-*`, `--field-*`, `--chip-*`, `--list-row-*`, `--tab-*`, `--segmented-*`, `--switch-*`, `--checkbox-*`, `--badge-*`, `--dialog-*`, `--sheet-*`, `--menu-*`, `--snackbar-*`, `--callout-*` | `components/*.yaml` enabled / focused / pressed / selected states |
| type | `--text-t1 … t14` + roles `--text-title`, `--text-heading(-lg/-sm)`, `--text-article`, `--text-body(-sm)`, `--text-note`, `--text-label`, `--text-control(-xs/-lg)`, `--text-caption(-sm)`, `--text-micro` | `font-size`, `line-height`, `font-weight`, `typography.yaml` |

Roles are `var(--palette-*)` references and are redeclared in `.dark`, so a nested `.dark`
subtree recomputes them. shadcn shadows (`--shadow-sm` …) sit on `:root` only (scheme rule) and
point at `--shadow-s1 … s3`, which `.dark` redeclares with SEED's heavier dark shadows.

Utilities in `@theme inline` use the same names as `@seed-design/tailwind4-theme`
(`text-fg-neutral`, `bg-bg-layer-default`, `border-stroke-neutral-muted`, `bg-palette-carrot-600`),
plus `rounded-r3`, `ease-enter`, `px-global-gutter`, `text-t5`, `text-title`.

## Dark mode policy

Official. SEED defines `theme-dark` for every colour token and shadow; the `.dark` block is those
values, nothing derived. Light is the preview default because the Daangn app's default is light.

## Font substitution

SEED ships no webfont: `-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard Variable",
Pretendard, …`. The theme keeps that stack and inserts `"Noto Sans KR"` before the Latin fallbacks so
Korean on Linux does not drop to a CJK default. No `@fontsource` import.

## Type scale

rem steps (follow the user's font scale; SEED clamps each to 0.8 … 1.5× the static px value):

| step | size / line height |
| --- | --- |
| t1 | 11 / 15 |
| t2 | 12 / 16 |
| t3 | 13 / 18 |
| t4 | 14 / 19 |
| t5 | 16 / 22 |
| t6 | 18 / 24 |
| t7 | 20 / 27 |
| t8 | 22 / 30 |
| t9 | 24 / 32 |
| t10 | 26 / 35 |
| t11 | 28 / 38 |
| t12 | 32 / 42 |
| t13 | 40 / 52 |
| t14 | 48 / 60 |

`screenTitle` = t10 bold, `articleBody` = t5 on t6 leading, `articleNote` = t4 on t5 leading.
t11 … t14 are recommended from the `sm` breakpoint (480) up.

## Not covered

- No live capture (`ref/<host>/`) and no theme-ref reconstruction. The docs site is
  https://seed-design.io if a rendered comparison is wanted later.
- No `components/*.svelte` snippets yet; SEED-specific parts (MannerTemp, ImageFrame, ReactionButton,
  ContextualFloatingButton, Stackflow AppScreen) are not ported.
- `--gradient-*` values are stop lists without an angle; the consumer wraps them in `linear-gradient()`.
