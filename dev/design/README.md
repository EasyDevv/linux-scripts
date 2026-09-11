# design

Global shadcn theme store. Skills and dashboard `/design` read this path.
Override with `DESIGN_THEMES`. Default is `~/.local/share/scripts/dev/design`.

```text
styles.json                  # slug catalog (toolbar); first entry is the preview default
themes/_core/layout.css      # scheme contract
themes/shadcn-nova/          # default preview slug when no ?style=
themes/<slug>/layout.css     # live theme sources
ref/<host>/                  # live site analysis: PNG + pages/*.mhtml + index.json
themes/<slug>/ref/           # shadcn-svelte reconstructions of those pages
cli/                         # portable collect/compare/validate/chrome gates
_inbox/                      # stubs and extraction working files
```

Dashboard host store (`projects.json`, wrap `js/`/`css/`, compiled `.cache/sheets`)
stays in the app: `{designHost}` = `~/dev/dashboard/apps/server/design`.
Compile/inject stay at `{designCli}` = `~/dev/dashboard/apps/client/src/lib/server/design/cli`.

Promote measured look-and-feel only here: `themes/<slug>/{layout.css,spec.json,SOURCE.md,design.json,chrome.json}`.
Incomplete SOURCE-only folders stay in `_inbox/<slug>/`.
