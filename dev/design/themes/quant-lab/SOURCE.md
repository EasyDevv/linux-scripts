# quant-lab

- Derived slug, not a new live measurement. Every color, type and shell value comes from `themes/tradingview/` (kr.tradingview.com product pages, 2026-09-29, and the 2026-10-07 symbol-page supplement); read that slug's `SOURCE.md` for URLs, viewport and font substitution.
- Added 2026-11-08 from the quant research lab (`~/dev/private/quant`, plan `docs/plan/261107-research-lab-board-merge.md` P6): the card board the lab's Loop screens use as their body.
  - `layout.css` / `spec.json`: the "Card board" primitives `--board-max`, `--board-gap`, `--board-gap-wide`, `--card-pad-top`, `--card-pad-x`, `--card-pad-bottom`, `--card-head-height`, `--step-tile-height`. Values are the live board's (`apps/client/src/lib/research/board/`), measured at 1440 and 3840 dark.
  - `design.json`: family `card-board` and the `board` block (container, grid layouts, card, step tile, chip, pill, ghost).
- `data-chrome` block: unchanged from `_core` / tradingview.
- `diff -r themes/tradingview themes/quant-lab` should show only the slug name, this file, the layout.css head comment and the board additions.
