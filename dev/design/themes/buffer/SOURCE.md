# buffer

- Copied structure from `themes/linear` (most developed slug). Values are Buffer measurements, not Linear's.
- Live URL (product): https://publish.buffer.com/
- Live URL (home): https://publish.buffer.com/home
- Live URL (create): https://publish.buffer.com/create/ideas (landed `?view=board`)
- Live URL (schedule): https://publish.buffer.com/schedule redirected to `/channels/6ae5eb212f1f5ed648313b53/schedule`
- Live URL (insights): https://publish.buffer.com/insights redirected to `/insights/6ae5eb212f1f5ed648313b53`
- Live URL (settings family): https://publish.buffer.com/settings/channels
- Date: 2026-10-23
- Viewport: desktop captures and token reads at 1440×900, deviceScaleFactor 1 (save-ref session). User tab at measure start was 1303×1082, dpr 1.25, `html.dark`. Mobile home capture is the `mobile` viewport.
- Scheme measured: dark, from `html.dark` on the dedicated tab (the logged-in session). Light was measured on that same tab by removing `html.dark` (`:root` vs `:root.dark` in `boot-ahFRqALl.css`). Both schemes are the app's own CSS variables, not a derived palette.
- Dark-mode policy: no appearance/theme/dark/light control was linked from the home nav or the settings/channels page. Preferences exists in the settings rail and was not opened. `support.buffer.com` search for "dark mode" returned an app shell, not an article that says the product is light-only. The publish CSS ships both schemes, so `.dark` is authoritative.
- Primary CTA paint (`New`, `Connect Channel`) stayed `rgb(143, 198, 125)` / ink `rgb(35, 36, 36)` after the class toggle. Light `--color-bg-brand` resolved to `rgb(176, 236, 156)` and was not what the button painted. `--primary` uses the painted button.
- Structural shadows (`--shadow-*`) sit on `:root` only. `--shadow-1` / `--shadow-2` were identical in both schemes. `--shadow-lg` and above use the dark `--shadow-3` string. Light `--shadow-3` / `--shadow-menu` were measured and are not installed (structural tokens cannot live in `.dark`).
- Font: body is Inter (imported `@fontsource-variable/inter`). Headings computed `Stolzl` first, then the system stack. Stolzl is not bundled; without that file, headings fall back. `--font-serif` and `--font-mono` are the shared contract stacks, not read off a Buffer element.
- `--chart-axis-nudge`, `--card-footer`, sidebar collapse duration/ease: required shared contract values. Inventory detected no motion on home.
- Captures: `ref/publish.buffer.com/` (`desktop/home.png`, `create.png`, `schedule.png`, `insights.png`, `settings.png`, `mobile/home.png`, `pages/*.mhtml`).
- Tokens: `layout.css` / `spec.json`. Roles: `chrome.json`. Composition: `design.json`.
