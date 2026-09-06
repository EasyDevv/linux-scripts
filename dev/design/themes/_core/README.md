# themes/_core

Canonical shadcn `layout.css` **scheme**, not a company theme.

- Copy this file to `themes/<slug>/layout.css` or a project `src/routes/layout.css`.
- Change token **values**. Keep names, section comments, and the light/dark split.
- Fonts, radius, shadows, and spacing live on `:root` only. `.dark` overrides colors (and `color-scheme`).
- `--background` (canvas) and `--card` (elevated) must differ in both modes.
- Sidebar collapse: `--sidebar-collapse-duration` and `--sidebar-collapse-ease` on `[data-slot=sidebar-gap]` / `[data-slot=sidebar-container]`. Keep those names. A slug may add `--sidebar-hide-below`.

Validate:

```bash
bun ~/dev/dashboard/apps/client/src/lib/server/design/cli/validate-layout-scheme.ts --all
bun ~/dev/dashboard/apps/client/src/lib/server/design/cli/validate-layout-scheme.ts --project <layout.css>
```

Stock shadcn token names for diffs stay in `~/.agents/skills-ready/shadcn-svelte/theme/default.css`.
