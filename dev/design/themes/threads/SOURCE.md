# threads

- Live URL: https://www.threads.com/ (logged-in home feed, ko-KR)
- Viewport: 1440×900 desktop (dark + light), 390×844 mobile (dark), page scale 100%
- Token composition: copied from `themes/linear` (the most developed slug in this store) — grouped project primitives (status, ink ladder, controls, shell, feed column, separators/row fills, menu panel, motion, dialog cap), per-scheme overrides in `.dark`, `--color-*` aliases plus the full type scale in `@theme inline`, and primitive chrome in the tail. Values are threads measurements, not linear's.
- Font: measured stack `system-ui, -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif` → `--font-sans` keeps that order and appends `Noto Sans KR` / `Apple SD Gothic Neo` for the Korean copy. Inter stays imported by the shared `@import` lines but is not first. Base type is 15px/21px.
- Canvas: the page itself. No panel fill, radius, or shadow on the shell; the 640px feed column is separated from the canvas by 1px inline borders and rows by a 1px `rgba(...,0.15)` hairline.
- Colors (measured):
  - dark: canvas `rgb(16,16,16)`, ink `rgb(243,245,247)`, elevated/menu `rgb(38,38,38)`, column border `rgb(45,45,45)`, hairline `rgba(243,245,247,0.15)`, menu separator `rgb(51,54,56)`, row hover `rgba(255,255,255,0.08)`, row selected `rgba(255,255,255,0.12)`, counts `rgb(204,204,204)`, time/index `rgb(119,119,119)`
  - light: canvas `rgb(255,255,255)`, ink `rgb(0,0,0)`, elevated `rgb(246,246,246)`, column border `rgb(213,213,213)`, hairline `rgba(0,0,0,0.15)`, row hover `rgba(0,0,0,0.035)`, row selected `rgba(0,0,0,0.06)`, counts `rgb(66,66,66)`, time/index `rgb(153,153,153)`
  - status: link / secondary user names `rgb(0,149,246)` (both schemes), logout row `rgb(255,48,64)`
- Type (measured): column title 20px/25px w600, rail row + body + time 15px/21px (w600 active row, w400 idle), action count 13px/18.2px w400, carousel index 12px/16.8px w600.
- Geometry: rail 252 expanded / 64 icon-only, nav row 200×32 radius 8 with 5.5px 9px padding, 10px gap and an 18px icon; post row padding 12px 24px (12px on mobile); avatar 36 circle with a 12px gutter; action row 36 tall with 8px gaps and 18px icons, inset 8px left of the content; sticky column header 72 tall; menu panel 240 wide, radius 16.
- Mobile (measured): fixed 60px header and 50px bottom nav, both `rgba(16,16,16,0.85)`; post row padding 12px; the rail is not rendered.
- Deliberate deviations from the capture (product plan §3/§6): icon-only 64px rail as the default (`--rail-width`), a right discover column (`--discover-width`), and no floating inset panel. Captures are evidence; `design.json` `notThreads` lists these.
- Captures: `{designDir}/ref/threads.com/` (`desktop/home.png` light, `desktop/home-dark.png`, `desktop/home-collapsed-dark.png`, `mobile/home-dark.png`, `pages/home.mhtml`, `index.json`)
- Tokens: `layout.css` / `spec.json`
- Role map (token names + which page taught them): `chrome.json`
- Tacit composition: `design.json`
