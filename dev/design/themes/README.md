# themes/{slug}

Each folder is a drop-in shadcn-svelte theme, not a page layout.

```text
themes/<slug>/
  layout.css   # source of truth — shadcn port and draft compile input
  spec.json    # measured overrides used by emit-layout-css.ts
  SOURCE.md    # live URL, viewport, font substitution
  design.json  # tacit chrome tokens cannot express (optional; token names, not hex)
  chrome.json  # which live page taught each role; geometry numbers; color fields are token names
  components/  # optional copy-paste snippets (not a runtime import path)
```

Start a slug from `themes/_core/layout.css`. Token **names** match that file. Preview default slug is `shadcn-nova` when no `?style=` is given. `--background` (canvas) and `--card` (elevated) stay distinct in `:root` and `.dark`. Fonts, radius, and shadows stay on `:root`. Measured extras sit after `/* Project primitives */` and `/* Project utilities */`. After edits run `bun ~/.local/share/scripts/dev/design/cli/validate-layout-scheme.ts --all` so every `layout.css` keeps `_core` token names. A single slug: `--project <slug>/layout.css`.

Do not add `draft.css`. Row and grid composition belongs in the draft HTML as theme utilities. Sidebar offcanvas motion is shared: copy `_core`'s `--sidebar-collapse-*` tokens and the `[data-slot=sidebar-gap]` / `[data-slot=sidebar-container]` rule; override values per slug if measured. A slug without `layout.css` must not appear in `styles.json`. Incomplete SOURCE-only slugs stay in `_inbox/`. After a slug exists, keep numbers in `themes/<slug>/chrome.json` — not sitemap dumps or screenshots.
