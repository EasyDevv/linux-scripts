# design

Global shadcn theme store. Skills and dashboard `/design` read this path.
Override with `DESIGN_THEMES`. Default is `~/.local/share/scripts/dev/design`.

```text
styles.json                  # slug catalog (toolbar)
themes/_core/layout.css      # scheme contract
themes/<slug>/layout.css     # live theme sources
_inbox/                      # stubs and extraction working files
```

Dashboard host store (`projects.json`, wrap `js/`/`css/`, compiled `.cache/sheets`)
stays in the app: `{designHost}` = `~/dev/dashboard/apps/server/design`.
Compile CLI stays at `{designCli}` = `~/dev/dashboard/apps/client/src/lib/server/design/cli`.

Promote measured look-and-feel only here: `themes/<slug>/{layout.css,spec.json,SOURCE.md,design.json,chrome.json}`.
Incomplete SOURCE-only folders stay in `_inbox/<slug>/`.
