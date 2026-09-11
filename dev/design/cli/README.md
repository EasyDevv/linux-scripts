# design/cli

Portable theme tools. Theme files stay in `../themes/`. Dashboard compile/inject stay in `{designCli}` (`~/dev/dashboard/apps/client/src/lib/server/design/cli`).

```bash
bun ~/.local/share/scripts/dev/design/cli/validate-layout-scheme.ts --all
bun ~/.local/share/scripts/dev/design/cli/compare-shadcn-theme.ts --project <layout.css>
bun ~/.local/share/scripts/dev/design/cli/check-theme-chrome.ts --theme <themes/<slug>>
bun ~/.local/share/scripts/dev/design/cli/resolve-ref.ts <url-or-host> --json
bun ~/.local/share/scripts/dev/design/cli/save-ref.ts --url <url> --id <page> --viewport desktop
```

Override the store with `DESIGN_THEMES`.
