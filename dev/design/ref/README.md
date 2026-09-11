# ref/{host}

Durable live-site analysis, keyed by hostname (`linear.app`), not theme slug.

```text
ref/<host>/
  index.json                 # pages, viewports, relative PNG + snapshot paths
  {desktop,tablet,mobile}/   # PNG captures
  pages/{id}.mhtml           # single-file static render (CDP Page.captureSnapshot)
```

Look up a URL before recapturing:

```bash
bun ~/.local/share/scripts/dev/design/cli/resolve-ref.ts https://linear.app/easydevs/team/EAS/all --json
bun ~/.local/share/scripts/dev/design/cli/save-ref.ts --url "https://linear.app/..." --id team-all --viewport desktop
```
