# source — toss (TDS Mobile)

## Reference

- Site: `https://tossmini-docs.toss.im/tds-mobile/` — 토스 디자인 시스템 모바일 문서
- Durable capture: `~/.local/share/scripts/dev/design/ref/tossmini-docs.toss.im/`
  (`index.json`, `mobile/*.png`, `desktop/button.png`, `pages/*.mhtml`)
- Component census: 67 doc routes enumerated, 19 pages captured, every route walked
  in a live browser for composition trees.

## Viewport / method

- Component geometry: `Emulation.setDeviceMetricsOverride` 390x844, `deviceScaleFactor 1`,
  mobile emulation, `bun-webview` Chrome on 9222.
- The docs render component demos inside a **scaled phone preview**. `getComputedStyle`
  values and `offsetWidth`/`offsetHeight` are pre-transform, so they report native
  geometry; only `getBoundingClientRect()` is scaled. Every number below is
  `offset*` / computed, never a scaled rect.
- Docs shell: 1440x900, `deviceScaleFactor 1`.

## Font substitution

Live: **Toss Product Sans** (400 / 700 only, build `20260223`, `unicode-range` split into
many subset files). It is a proprietary Toss webfont and is **not** redistributed here.
`--font-sans` therefore leads with `"Toss Product Sans"` and falls back to
`Pretendard → -apple-system → Segoe UI → Roboto → Noto Sans KR`, which keeps Korean
metrics close. Weight 600 in the theme maps to the nearest available synthetic/real
face; the docs only ship 400 and 700, so 600 renders as synthesized semibold.

## TDS colour system (authoritative, from `/foundation/colors/` + resolved tokens)

Base hues 50..900. Light (`colors.*`):

| hue | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grey | #f9fafb | #f2f4f6 | #e5e8eb | #d1d6db | #b0b8c1 | #8b95a1 | #6b7684 | #4e5968 | #333d4b | #191f28 |
| blue | #e8f3ff | #c9e2ff | #90c2ff | #64a8ff | #4593fc | #3182f6 | #2272eb | #1b64da | #1957c2 | #194aa6 |
| red | #ffeeee | #ffd4d6 | #feafb4 | #fb8890 | #f66570 | #f04452 | #e42939 | #d22030 | #bc1b2a | #a51926 |
| orange | #fff3e0 | #ffe0b0 | #ffcd80 | #ffbd51 | #ffa927 | #fe9800 | #fb8800 | #f57800 | #ed6700 | #e45600 |
| yellow | #fff9e7 | #ffefbf | #ffe69b | #ffdd78 | #ffd158 | #ffc342 | #ffb331 | #faa131 | #ee8f11 | #dd7d02 |
| green | #f0faf6 | #aeefd5 | #76e4b8 | #3fd599 | #15c47e | #03b26c | #02a262 | #029359 | #028450 | #027648 |
| teal | #edf8f8 | #bce9e9 | #89d8d8 | #58c7c7 | #30b6b6 | #18a5a5 | #109595 | #0c8585 | #097575 | #076565 |
| purple | #f9f0fc | #edccf8 | #da9bef | #c770e4 | #b44bd7 | #a234c7 | #9128b4 | #8222a2 | #73228e | #65237b |

Grey opacity (light / dark), used for every hairline, well and hover in TDS:

| step | light | dark |
| --- | --- | --- |
| 50 | `rgba(0,23,51,.02)` | `rgba(209,209,253,.05)` |
| 100 | `rgba(2,32,71,.05)` | `rgba(217,217,255,.11)` |
| 200 | `rgba(0,27,55,.10)` | `rgba(222,222,255,.19)` |
| 300 | `rgba(0,29,58,.18)` | `rgba(224,224,255,.27)` |
| 400 | `rgba(0,25,54,.31)` | `rgba(232,232,253,.36)` |
| 500 | `rgba(242,242,255,.47)` | `rgba(3,24,50,.46)` |
| 600 | `rgba(0,19,43,.58)` | `rgba(248,248,255,.60)` |
| 700 | `rgba(253,253,255,.75)` | `rgba(3,18,40,.70)` |
| 800 | `rgba(0,12,30,.80)` | `rgba(253,253,254,.89)` |
| 900 | `#ffffff` | `rgba(2,9,19,.91)` |

Adaptive surfaces (light / dark):

| token | light | dark |
| --- | --- | --- |
| `adaptiveBackground` | `#ffffff` | `#17171c` |
| `adaptiveGreyBackground` | `#f2f4f6` | `#101013` |
| `adaptiveLayeredBackground` | `#ffffff` | `#202027` |
| `adaptiveFloatedBackground` | `#ffffff` | `#2c2c35` |
| `adaptiveHairlineBorder` | `#e5e8eb` | `#3c3c47` |
| `adaptiveDimmedBackground` | `rgba(0,0,0,.56)` | `rgba(0,0,0,.2)` |
| `adaptiveDisabledBlue500` | `#c9e2ff` | `rgba(49,130,246,.2)` |
| `adaptiveBackgroundLevel01/02` | — | `#202027` / `#2c2c35` |

The dark adaptive hue ramps are in `layout.css` under the second `.dark` block; each is a
resolved `adaptive*` custom property read from a live page, not a hand-mix.

## TDS typography scale

Raw scale `--tds-t-f11 … --tds-t-f42` (font size = n px):

- line height `= n × 1.5` for n = 11…29, `= n × 4/3` for n = 30…42
- `icon-height` and `badge-*` travel with the same index
  (f11 icon 12px, f29 icon 33px, f42 icon 48px; badge padding 3px 6px at f11 → 5px 10px at f39)

Semantic aliases (from `/foundation/typography/`), `sub Typography n` rows are the `st` set:

| token | f | size / line height | usage |
| --- | --- | --- | --- |
| Typography 1 | f30 | 30 / 40 | 매우 큰 제목 |
| sub Typography 1 | f29 | 29 / 38 | sub |
| sub Typography 2 | f28 | 28 / 37 | sub |
| sub Typography 3 | f27 | 27 / 36 | sub |
| Typography 2 | f26 | 26 / 35 | 큰 제목 |
| sub Typography 4 | f25 | 25 / 34 | sub |
| sub Typography 5 | f24 | 24 / 33 | 조금 큰 제목 |
| sub Typography 6 | f23 | 23 / 32 | sub |
| Typography 3 | f22 | 22 / 31 | 일반 제목 |
| sub Typography 7 | f21 | 21 / 30 | sub |
| Typography 4 | f20 | 20 / 29 | 작은 제목 |
| sub Typography 8 | f19 | 19 / 28 | 조금 큰 본문 |
| sub Typography 9 | f18 | 18 / 27 | sub |
| Typography 5 | f17 | 17 / 25.5 | 일반 본문 |
| sub Typography 10 | f16 | 16 / 24 | sub |
| Typography 6 | f15 | 15 / 22.5 | 작은 본문 |
| sub Typography 11 | f14 | 14 / 21 | sub |
| Typography 7 | f13 | 13 / 19.5 | 안 읽어도 됨 |
| sub Typography 12 | f12 | 12 / 18 | sub |
| sub Typography 13 | f11 | 11 / 16.5 | 아예 안읽어도 됨 |

Larger text (iOS/Android dynamic type) scales these by ~1.01…1.4×, so the values stay
tokens; hard-coding them breaks larger-text mode.

## Measured control geometry

| role | size | radius | padding | type |
| --- | --- | --- | --- | --- |
| Button small | 44×32 | 8px | 0 10px | 13/16.276/600 |
| Button medium | 73×38 | 10px | 0 16px | 15/18.78/600 |
| Button large | 66×48 | 14px | 0 16px | 17/21.284/600 |
| Button default | 96×56 | 16px | 0 28px | 17/21.284/600 |
| TextButton | 77×28 | 8px (press 9px) | — | 17/21.284/500 |
| IconButton | 48×48 | 12px | 12px, icon 24 | — |
| IconButton bordered | 50×50 | 12px | 12px + 0.8px border | — |
| Checkbox | 24×24 | 6px | label gap 8px | 1px stroke |
| Switch | 50×30 | 15px | thumb 24 on / 16 off | — |
| Badge xsmall | 44×21 | 9px | 3px 7px | 10/15/600 |
| Badge small | 44×24 | 11px | 3px 7px | 12/18/700 |
| Badge medium | 64×26 | 12px | 3px 7px | 13/19.5/700 |
| Badge large | 49×29 | 13px | 4px 8px | 14/21/700 |
| TextField box | 261×55 | 14px | 14px 16px, 0.8px border | 17/25.5/400 |
| SearchField well | 269×44 | 12px | 8px 10px | — |
| SegmentedControl | 253×48 | 14px | 4px 5px | 17/25.5 |
| Tab | 87×47 | — | 0 8px, indicator 2px + 0 10px | 17/21.284 |
| ListRow | 44…82 h | 12px hover | 12px 24px | 17/22.95/500 |
| ListHeader | — | — | 24px 0 8px | 20 title / 13 sub |
| ListFooter | 301×59 | — | 0 24px | 17/21.284/500 |
| GridList cell | 79×75 | 9px | 12px 8px, gap 6px | 14/21/500 |
| Stepper row | 301×74 | — | 3px 24px, icon 30, connector 2×32 | — |
| BoardRow header | 301×56 | 12px hover | 16px 16px 16px 24px | 17/22.95 |
| BottomCTA | — | — | 0 20px 20px | — |

Button label leading is `fontSize × 1.252`, not the scale line height — recorded as
`--control-label-leading`.

## Docs shell (Nextra, not TDS)

Measured at 1440×900: nav 64px / 24px inset, sidebar 256px, main padding
`16px 48px 0`, content column 832px, TOC 256px at x 1184, h1 36/54/700, h2 30/45/600 with
a 0.8px bottom rule, body 16/28/400, preview block white with a 12px radius and a 0.8px
border at 20px padding, inline code 14.4/28 with a 6px radius. Its ink
(`rgb(15,23,42)`, `rgb(51,65,85)`, link `rgb(0,123,255)`, code block `rgb(1,22,39)`) is
Nextra's palette, not TDS — it lives in `ref/chrome.ts` as measured marks and is never
promoted to a token.

## Build

`spec.json` is the value source. `layout.css` is generated by
`emit-layout-css.mts` (token blocks) + `dark-tokens.json` (adaptive dark palette) +
`chrome-tail.css` (primitive chrome), driven by `build.sh`.

The repo CLI `apps/client/src/lib/server/design/cli/emit-layout-css.ts` cannot do this
job today: its `insertBeforeClose()` builds `/\n\t/*s*Project primitivess**/[sS]*$/`,
which is an invalid regex and throws for **every** slug (verified against the existing
`threads` spec as well). The local generator reproduces the same output with a correct
marker match. Fixing the repo CLI is a separate change.

## Not measured

- Hover / pressed paint owner for buttons and list rows (a press overlay div exists at
  1.05–2× the control box, but the state that triggers it was not captured).
- Elevation shadows for modal / bottom sheet: only the `rgba(0,0,0,.56)` scrim was read.
- Box numbers for Keypad, Chart, Top, Result, Rating, Bubble, Menu, Toast, Tooltip,
  Slider, Progress, Skeleton, Loader, NumericSpinner, TableRow, Post, Highlight and
  Border: enumerated in the route census and their prop tables read, but not measured.

## Verification

Run at 1440×900, `deviceScaleFactor 1`, on the managed dashboard stack
(`http://dashboard.localhost`, `executor list` → `dashboard`, web 45110 / api 45111).

```bash
bun ~/.local/share/scripts/dev/design/cli/validate-layout-scheme.ts --all   # toss ok
bun ~/.local/share/scripts/dev/design/cli/check-theme-chrome.ts --theme themes/toss  # ok
bun ~/.local/share/scripts/dev/design/cli/compare-shadcn-theme.ts \
  --project themes/toss/layout.css --default themes/_core/layout.css
bun .agents/skills/site-to-design/scripts/measure-theme-ref.ts --slug toss --scheme light
bun .agents/skills/site-to-design/scripts/measure-theme-ref.ts --slug toss --scheme dark
```

`measure-theme-ref.ts`, light and dark, all three pages: `ok: true`, `fail: []`.

| page | sidebar | inset | inset radius | header | footer |
| --- | --- | --- | --- | --- | --- |
| button | 256px | x256 y12 1172×848 | 12px | 64px | 40px @ y860 |
| components | 256px | same | 12px | 64px | 40px |
| foundation | 256px | same | 12px | 64px | 40px |

Sidebar 256px, header 64px and the 832px content column are the live docs measurements.
The inset starts at x256/y12 rather than y0 because the dashboard shell contract insets the
floating panel by `--panel-inset` (12px); the live docs nav is flush at y0. The footer exists
only because `measure-theme-ref` gates on `data-role=app-footer` — the live page has none.

### Control comparison (live docs vs the reconstruction)

`collect-computed-styles.ts` on both, compared with `compare-computed-styles.ts --mode control`
(`/tmp/site-to-design/toss/cmp/`). Named targets: `button-medium`, `badge-medium`, `switch-on`.

Exact matches: padding, border-radius, font-size, line-height, font-weight, colour, background,
box height, and every measured geometry value. `button-medium` also matches `display: flex`.

Four residual differences, all explained:

1. **font family / text width** — the stacks agree on the measured order
   (`"Toss Product Sans", Tossface, "SF Pro KR", "SF Pro Display", "SF Pro Icons", -apple-system,
   BlinkMacSystemFont, …`); the theme inserts `Pretendard` after `BlinkMacSystemFont` so Korean
   renders without the proprietary webfont. The live page loads the real face, the draft resolves
   Pretendard, so a `13px/700` badge is 64px live and 67.7px in the draft. Box height, padding
   and radius are unaffected.
2. **default border colour** — `rgb(229,231,235)` live is the docs' global Tailwind
   `border-color`; the theme's `*` rule uses the TDS hairline `rgb(229,232,235)`. No measured
   control carries a border of its own, so this is the global default, not a component token.
3. **switch label ink** — `rgb(51,65,85)` is ink inherited from the docs body; the snippet uses
   the TDS grey800 `rgb(51,61,75)`.
4. **checkbox graphic radius** — TDS draws the graphic in an SVG, so the live box reports
   `border-radius: 0px`; the CSS port puts the shape on the box (`9999px` circle / `4px` line).
   Recorded in `components/checkbox.svelte`.
