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

## data-chrome (call-site looks)

`components/ui` is the read-only registry copy, and the shared lint (`shadcn/no-restyle`) refuses look classes on it. A screen names the look instead — `<Button data-chrome="pill muted hover-ink">`, `<Dialog.Content data-chrome="flush">` — and the `/* data-chrome:start … end */` block draws it. The block is identical in `_core` and every slug and is copied whole into each project's `layout.css`; change it in `_core`, then copy it everywhere. Values are what the replaced utility classes produced, in `@layer utilities` at one attribute of specificity, so a component's own state classes still win where they won before.

- Shape: `pill`, `radius-sm`. Ink: `muted`, `soft`, `ink`, `danger`, `on-accent`, `hover-ink`, `hover-danger`, `hover-highlight`. Fill: `accent`, `hover-accent`, `input`, `hover-input`, `danger-solid`.
- No frame: `bare` (or `clear`, `borderless`, `unshadowed` alone), `flush-x`, `field-bare` (a textarea that is the well), `flat` (overlay without shadow or ring).
- Type and spacing: `medium`, `regular`, `mono`, `label-size`, `label-lines`, `body-sm`, `lines-5`, `gap-sm`, `inset`, `inset-under`, `tight`, `prose`, `compact` (settings-row Input / Select trigger), `chip` (pill toggle).
- Settings dialog: `flush` on Content / Header / Footer (also dropdown content, sidebar sub), `wide`, `bar`, `title`, `split`, `end`. App shell: `railless`, `app-head`, `app-group`, `nav-row`.

A new look gets a word here only when a second screen needs it; a one-file behaviour hook stays a `data-part` / `data-role` attribute in that file's own CSS.
