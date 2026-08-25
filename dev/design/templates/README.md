# templates/{slug}

Each folder is a drop-in shadcn-svelte theme, not a page layout.

```text
templates/airbnb/
  layout.css   # source of truth — shadcn port and draft compile input
  spec.json    # measured overrides used by emit-layout-css.ts
  SOURCE.md    # live URL, viewport, font substitution
```

Start a slug from `templates/_core/layout.css`. Token **names** still match `skills-ready/shadcn-svelte/theme/default.css`. `--background` (canvas) and `--card` (elevated) stay distinct in `:root` and `.dark`. Fonts, radius, and shadows stay on `:root`. Measured extras sit after `/* Project primitives */` and `/* Project utilities */`. After edits run `bun ../scripts/validate-layout-scheme.ts --project <slug>/layout.css`.

Do not add `draft.css`. Row and grid composition belongs in the draft HTML as theme utilities. A slug without `layout.css` must not appear in `js/draft-styles.json`.
