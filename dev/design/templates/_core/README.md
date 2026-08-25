# templates/_core

Canonical shadcn `layout.css` **scheme**, not a company theme.

- Copy this file to `templates/<slug>/layout.css` or a project `src/routes/layout.css`.
- Change token **values**. Keep names, section comments, and the light/dark split.
- Fonts, radius, shadows, and spacing live on `:root` only. `.dark` overrides colors (and `color-scheme`).
- `--background` (canvas) and `--card` (elevated) must differ in both modes.

Validate:

```bash
bun ~/.local/share/scripts/dev/design/scripts/validate-layout-scheme.ts --project <layout.css>
```

Stock shadcn token names for diffs stay in `~/.agents/skills-ready/shadcn-svelte/theme/default.css`.
