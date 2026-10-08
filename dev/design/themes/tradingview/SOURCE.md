# tradingview

- Live URLs: 헤더 **프로덕트** 메뉴의 하위 페이지 23개(`chrome.json` `pages`). 대표 측정 페이지는 `/screener/`, `/portfolios/`, `/economic-calendar/`, `/yield-curves/`.
- 측정일: 2026-09-29. Viewport 1440×900, devicePixelRatio 1.25, `html.theme-dark`, 로그인 상태, 오른쪽 위젯 바 열림.
- Captures: `{designDir}/ref/kr.tradingview.com/` (`desktop/*.png`, `pages/*.mhtml`, `index.json`), computed style dumps in `ref/kr.tradingview.com/computed/`.
- 팔레트 출처: TradingView 자체 CSS 변수 (`--color-text-primary/secondary`, `--color-pane-bg`, `--color-pane-secondary-bg`, `--color-input-bg`, `--color-border-table`, `--color-brand`, `--color-cold-gray-*`, `--color-minty-green-*`, `--color-ripe-red-*`).
  - dark: canvas `#000`, pane `#0f0f0f`, pane-secondary `#1f1f1f`, input `#2e2e2e`, text `#dbdbdb`/`#8c8c8c`, border-table `#2e2e2e`, outlined control border `#4a4a4a`, brand `#2962ff`, nav active `#5b9cf6`, up `#22ab94`, down `#f7525f`.
  - light (theme-light tab): canvas `#fff`, text `#0f0f0f`/`#707070`, border-table `#f2f2f2`, pane-secondary `#f2f2f2`, separator `#ebebeb`, hover `#f2f2f2`, toolbar active `#e3effd`, up `#089981`, down `#f7525f`.
  - light values **not** read from a live light render and mirrored from the dark role on the cold-gray scale: `--card` (`#f9f9f9`, canvas and card must differ), `--input` (`#dbdbdb`), `--tab-selected` (`#0f0f0f`, inverted like dark). Re-measure on a light capture before promoting.
- Hairlines: live borders compute as 0.8px at DPR 1.25 (one device pixel). `--hairline-width` is 1px at DPR 1.
- Font: `-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif` (live) + `"Noto Sans KR"` for Hangul. The `@fontsource-variable/inter` import is kept from `_core` for the compile contract; the family does not use Inter.
- Shell: top header 64px, flush main with 20px gutter, right widget bar = 300px panel + 1px canvas seam + 45px icon toolbar. No floating inset panel.
- Tokens: `layout.css` / `spec.json`. Role map: `chrome.json`. Composition: `design.json`.
- 2026-10-07 supplement: `/symbols/NASDAQ-QQQ/` and `/symbols/NASDAQ-QQQ/technicals/` (dark, 1440×900, DPR 1). Adds tooltip (`--color-cold-gray-750` plate, measured on a dotted-underline term), period range buttons, interval tabs, underline tabs, tags, outlined and notice cards, rating counters, hero/section/stat type, rating colors (`--color-buy/neutral/sell`), sticky symbol summary bar. Light values for `--tooltip`, `--notice` mirror dark (not read from a light render). Chart canvas internals (area gradient, last-value tag) are described, not measured.
- First pass (Site stage). Draft loop ran in the quant project (`~/dev/private/quant/.product`), which drove the 2026-10-07 supplement.
