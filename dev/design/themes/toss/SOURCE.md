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

## Dark mode policy

**Apps in Toss does not support dark mode.** From the toss-docs MCP (`apps_in_toss` source):

- `guide/faq.md` — "현재 앱인토스 미니앱에서는 다크 모드를 지원하지 않아요. 라이트 모드 기준으로 개발/디자인 및 출시해야 해요."
- `design/prepare/design.md` — "다크 모드는 추후 지원할 예정이에요. 지금은 라이트 모드 기준으로만 디자인해 주세요."
- `checklist/app-nongame.md` (release review) — "미니앱 테마는 라이트 모드로 구현돼 있어요."

Only scoped APIs mention dark: `TossAds.attachBanner` `theme: auto|light|dark`, `NavigationBar` `theme`
(icon/text colour only), `InitialProps.initialColorPreference`. The TDS Mobile docs name colours
`adaptive.*` but never document switching. TDS React Native's `ShadowBackground` example uses
`lightColor: '#000'`, `darkColor: '#fff'`.

So **light is the only authoritative scheme**. The `.dark` block is unofficial reference data (the
adaptive pairs the docs site still ships) plus three derived tweaks; this theme deliberately keeps
black floating shadows in dark rather than the RN example's white.

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

Grey opacity (light / dark), used for every hairline, well and hover in TDS.
The raw census stores each adaptive pair unordered; light is the dark-blue-based tint at every
step (500, 700, 900 were swapped in the 260928 pass and are corrected here):

| step | light | dark |
| --- | --- | --- |
| 50 | `rgba(0,23,51,.02)` | `rgba(209,209,253,.05)` |
| 100 | `rgba(2,32,71,.05)` | `rgba(217,217,255,.11)` |
| 200 | `rgba(0,27,55,.10)` | `rgba(222,222,255,.19)` |
| 300 | `rgba(0,29,58,.18)` | `rgba(224,224,255,.27)` |
| 400 | `rgba(0,25,54,.31)` | `rgba(232,232,253,.36)` |
| 500 | `rgba(3,24,50,.46)` | `rgba(242,242,255,.47)` |
| 600 | `rgba(0,19,43,.58)` | `rgba(248,248,255,.60)` |
| 700 | `rgba(3,18,40,.70)` | `rgba(253,253,255,.75)` |
| 800 | `rgba(0,12,30,.80)` | `rgba(253,253,254,.89)` |
| 900 | `rgba(2,9,19,.91)` | `#ffffff` |

Adaptive surfaces (light / dark):

| token | light | dark |
| --- | --- | --- |
| `adaptiveBackground` | `#ffffff` | `#17171c` |
| `adaptiveGreyBackground` | `#f2f4f6` | `#101013` |
| `adaptiveLayeredBackground` | `#ffffff` | `#202027` |
| `adaptiveFloatedBackground` | `#ffffff` | `#2c2c35` |
| `adaptiveHairlineBorder` | `#e5e8eb` | `#3c3c47` |
| `adaptiveDimmedBackground` | `rgba(0,0,0,.2)` | `rgba(0,0,0,.56)` |
| `adaptiveDisabledBlue500` | `#c9e2ff` | `rgba(49,130,246,.2)` |
| `adaptiveBackgroundLevel01/02` | — | `#202027` / `#2c2c35` |

How light and dark were told apart: the docs force `<html class="light">`, and `:root` there
resolves every `adaptive*` property to its **dark** value (`--adaptiveGrey700 = #c3c3c6`,
`--adaptiveDimmedBackground = rgba(0,0,0,.56)`), while components render the light literals.
The live Dialog / Modal / BottomSheet dim was measured open: black at opacity .2 → light = .2.
Hue ramps were resolved by luminance order (light 50 is lightest, dark 50 is darkest) and the
known light 500 of each hue. All ten steps of all eight hues plus greyOpacity are in `layout.css`
(`:root` light, `.dark` dark).

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

In `layout.css` these are `--text-t1 … --text-t7` and `--text-st1 … --text-st13` (+ `--line-height`),
usable as `text-t5` utilities. Larger text (iOS/Android dynamic type) scales them by ~1.01…1.4×, so
the values stay tokens; hard-coding them breaks larger-text mode.

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
| Checkbox | 24×24 | SVG (22 disc / 16×11 check) | label gap 8px | — |
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
| ListHeader | 301×81 | — | 24px 0 8px | 17/25.5/700 title / 13 sub |
| ListFooter | 301×59 | — | 0 24px | 17/21.284/500 |
| GridList cell | 79×75 | 9px | 12px 8px, gap 6px | 14/21/500 |
| Stepper row | 301×74 | — | 3px 24px, icon 30, connector 2×32 | — |
| BoardRow header | 301×56 | 12px hover | 16px 16px 16px 24px | 17/22.95 |
| BottomCTA | — | — | 0 20px 20px | — |

Button label leading is `fontSize × 1.252`, not the scale line height — recorded as
`--control-label-leading`. List texts (ListRow, BoardRow, Post headings) use × 1.35 (`--text-row*`).
This table is the first-pass subset; the full set of 47 components is in `chrome.json` `roles`.

## Docs shell (Nextra, not TDS)

Measured at 1440×900: nav 64px / 24px inset, sidebar 256px, main padding
`16px 48px 0`, content column 832px, TOC 256px at x 1184, h1 36/54/700, h2 30/45/600 with
a 0.8px bottom rule, body 16/28/400, preview block white with a 12px radius and a 0.8px
border at 20px padding, inline code 14.4/28 with a 6px radius. Its ink
(`rgb(15,23,42)`, `rgb(51,65,85)`, link `rgb(0,123,255)`, code block `rgb(1,22,39)`) is
Nextra's palette, not TDS — it lives in `ref/chrome.ts` as measured marks and is never
promoted to a token.

## Build

`spec.json` is the value source; `layout.css` is generated — do not edit it by hand.

```bash
bun ~/.local/share/scripts/dev/design/themes/toss/.build/emit.ts
```

`.build/emit.ts` merges `spec.json` into `themes/_core/layout.css` (shadcn tokens replaced in place,
everything else under the block's `/* Project primitives */` / `/* Project utilities */` marker,
`spec.comments` as group headers) and appends `.build/chrome.css` (primitive `[data-slot]` chrome).
Unlike the dashboard's `emit-layout-css.ts`, it can add non-shadcn tokens to `.dark`, which the
adaptive palette needs.

Token layers (linear's structure): palette ramps → roles (`--surface-*`, `--ink-*`, `--status-*`)
→ component geometry (`--control-*`, `--field-*`, `--list-row-*`, `--dialog-*` …). The type scale
(`--text-t1…t7`, `--text-st1…st13`, roles, control and list texts) lives in `:root` as runtime values
and `@theme inline` only points at them: Tailwind v4 emits `@theme` variables only when CSS it
compiles references them, so a snippet's scoped `var(--text-t5)` would otherwise be undefined.

## Motion / page transitions

Searched with the toss-docs MCP (`apps_in_toss`, `tds_mobile`, `tds_react_native`, examples) on 2026-09-30
for 화면 전환 / 애니메이션 / transition / navigation. **No page-transition duration, easing or keyframe
is documented.** Only these rules and component entrances exist (recorded in `design.json` `motion`):

- `documentation/react-native/screen-navigation/navigation.md` — Granite routing runs on React Navigation;
  "WebView 환경에서는 프로젝트에 설정한 웹 라우터(예: React Router)의 규칙을 수정 없이 그대로 따릅니다."
- `documentation/integration/props.md` — `allowsBackForwardNavigationGestures` (iOS, default `true`): swipe back/forward.
- `checklist/app-nongame.md`, `app-game.md` — "스크롤, 터치, 화면 전환 등 인터랙션 반응이 2초 이상 지연되지 않아요.";
  "특정 화면 전환 시 바텀시트로 사용자의 행동을 강제로 유도하지 않아요."; Android back goes back or closes.
- `design/consumer-ux-guide.md` — no decorative effects; no loading animation when nothing is awaited;
  "3D 그래픽이나 애니메이션은 토스에서 제공한 모듈에 포함된 리소스만 사용할 수 있어요."
- `guide/monetization/in-app-ad.md` — interstitial ads show "화면 전환 시점", at step boundaries.
- TDS Mobile BottomCTA `showAfterDelay { animation: 'slide' | 'fade' | 'scale', delay }` (seconds), `show`,
  `hideOnScroll`; BottomSheet `animation` (slide-up, default `true`) + `animationDelay` (ms);
  Toast 3000ms in app, 5s on web with a button; RN ProgressBar `withAnimation`.

No `layout.css` token was added: the docs give no number to promote. The sheet (0.3s) and toast (0.25s)
snippet timings reuse `--panel-fold-ease` and remain unmeasured.

## Not measured

- **Dark rendering of components.** The docs force `.light`; dark values come from the adaptive
  pairs. Three dark tweaks are derived, not measured: floating shadows turn black
  (`.dark --shadow-float*`, `--shadow-toast`, `--shadow-thumb*`), the dark Button label follows
  `--surface-base`, the Highlight mask stays static (`--highlight-dim`).
- Tooltip large (never opened in the capture) and SegmentedControl large.
- Pressed-state paint for buttons and list rows (press layers exist; the snippets use
  `brightness(.92)` / greyOpacity50-100, not a measured value).
- Agreement v3 and ListRow legacy (superseded APIs).

Every other component route was measured at 390×844: static previews dumped to depth 7
(`.preview` blocks), overlays opened with a real click and measured after 0.9–1.8s.
Per-component numbers are in `chrome.json` `roles.*.geometry` and each snippet's header comment.

## Verification

Run at 1440×900, `deviceScaleFactor 1`, against `http://dashboard.localhost` (managed entry
`dashboard`, web 45110 / api 45111).

```bash
bun ~/.local/share/scripts/dev/design/cli/validate-layout-scheme.ts --project themes/toss/layout.css  # ok
bun ~/.local/share/scripts/dev/design/cli/check-theme-chrome.ts --theme themes/toss                   # ok
bun ~/.local/share/scripts/dev/design/cli/compare-shadcn-theme.ts --project themes/toss/layout.css     # missing 0, unsectioned 0
bun ~/.agents/skills-ready/site-to-design/scripts/measure-theme-ref.ts --slug toss --scheme light      # 8 pages ok
bun ~/.agents/skills-ready/site-to-design/scripts/measure-theme-ref.ts --slug toss --scheme dark       # 8 pages ok
```

`measure-theme-ref.ts`: foundation, button, controls, inputs, lists, content, overlays, feedback —
light and dark, `ok: true`, `fail: []`. Every section of every page was also captured light and
dark and read side by side; no console errors on any page.

### Draft geometry vs live (offset boxes of the snippet roots)

Match: Button 32/38/48/56 · Switch 50×30 · Badge 21/24/26/29 · IconButton 48 / 50 (border) ·
Segmented 48 · Tab 47/37 · TextField box 55, line 37, big 46, hero 40, wrapper 138 · SearchField
well 44 · Slider 40 · ListRow 47/44/55/71 · ListFooter 59 · BoardRow 56 · TableRow 42 · GridList 75 ·
Stepper 74 · ListHeader 81 · Dialog 320 wide · Toast 47/48 top, 51/60 bottom · Tooltip 36/49 ·
ProgressBar 5/2/8 · Loader 48/60/80 · Keypad row 66 · BottomCTA bar 76 · Result 273 · BarChart 205.

Residuals, all font- or border-driven: NumericSpinner tiny/small 88/106 vs 87/105 (value box is
as wide as "000" in the fallback font) · Menu 188 vs 186 (0.8px rule ×2) · Bubble 48 vs 50 (the
live 26px line box comes from Toss Product Sans metrics; the snippet keeps the same inline-block
structure).

### Control comparison (260928 pass, still valid)

`collect-computed-styles.ts` → `compare-computed-styles.ts --mode control` on `button-medium`,
`badge-medium`, `switch-on`: padding, radius, font-size, line-height, weight, colour, background
and box height match. Residuals: text width from the font substitution (badge 64 vs 67.7px), the
docs' global Tailwind border colour, and inherited docs ink on the switch label. The checkbox
graphic is now an SVG like TDS (it was a CSS box in the first pass).
