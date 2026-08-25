# draft

Shared core for `iterate-layout-design` and `site-to-design`.

`{designDir}` is `~/.local/share/scripts/dev/design`.

## Layout

```text
projects.json                # registered project roots
js/draft-styles.json         # companies in the draft header select
js/switch-style.js
js/draft-index.js            # manager UI (served, not written into projects)
css/switch.css
css/draft-index.css
scripts/
  collect-computed-styles.ts
  compare-computed-styles.ts
  collect-tailwind-arbitrary.ts
  compare-shadcn-theme.ts
  validate-layout-scheme.ts
  emit-layout-css.ts
  compile-layout-css.ts      # Tailwind-compile layout.css for static drafts
  inject-draft-chrome.ts     # inlined by build-draft-index
  render-draft-data.ts
  list-drafts.ts
  drafts-mutate.ts
  drafts-op.ts               # optional drafts-op:// archive/delete
  build-draft-index.ts       # compile + inject chrome into project drafts
  serve-drafts.ts            # multi-project manager + file server
  projects.ts
templates/
  _core/layout.css          # token scheme contract
  <slug>/layout.css
  <slug>/SOURCE.md
```

Draft pages stay HTML in each project: `{projectRoot}/.drafts/{route}/*.html`. Dummy records are `{projectRoot}/.drafts/{route}/data/`. Theme source is `templates/{slug}/layout.css`. `compile-layout-css.ts` runs Tailwind and the result is inlined into HTML that has `data-layout-css`.

Do not generate `{projectRoot}/.drafts/preview.html`. The manager lives in this app.

## Preview manager

Executor app name: `draft`. Default URL: `http://127.0.0.1:4177/` (`http://draft.localhost/`).

```bash
bun "{designDir}/scripts/serve-drafts.ts" --port 4177 --host 127.0.0.1
```

- **Shell** — `{designDir}/css/draft-index.css` + `{designDir}/js/draft-index.js`. Dark chrome, project → route collapsibles, one iframe.
- **Registry** — `{designDir}/projects.json`. The sidebar **add project** control registers a root and creates `{root}/.drafts/` when missing.
- **Listing** — `list-drafts.ts` scans each registered `{route}/*.html`, skips `preview.html`, `index.html`, and `*/archive/`.
- **Files** — `/p/{projectId}/{route}/{file}.html`.
- **Theme** — each draft already has compiled `layout.css` sheets plus `switch-style.js`. The toolbar sets `?style=` on the iframe.
- **Archive / delete** — `POST /__drafts/archive` and `/__drafts/delete`. Path checks reject `..`, `preview.html`, and files already under `archive/`.

## Scripts

Measure and compare in the browser:

```bash
bun "{designDir}/scripts/collect-computed-styles.ts" --port 9222 --compact \
  --target "title::h1.title" --out templates/<slug>/source-roles.json
bun "{designDir}/scripts/compare-computed-styles.ts" \
  --reference templates/<slug>/source-roles.json \
  --local templates/<slug>/draft-roles.json \
  --mode typography --fail-on-diff
```

Write a portable theme from a spec (shadcn default + measured overrides):

```bash
bun "{designDir}/scripts/emit-layout-css.ts" \
  --spec "{designDir}/templates/airbnb/spec.json"
```

Compile needs a package root that can resolve `tailwindcss` (and the `layout.css` imports). Set `DESIGN_COMPILE_ROOT` or keep the default `~/dev/product/postdock/apps/web`.

Rebuild after adding or changing drafts (does not write `preview.html`):

```bash
bun "{designDir}/scripts/build-draft-index.ts" --root "{projectRoot}"
bun "{designDir}/scripts/build-draft-index.ts" --all
```

## Templates

`templates/{slug}/layout.css` starts from `templates/_core/layout.css`:

- keep the shadcn `:root` / `@theme inline` token names
- `--background` is the canvas, `--card` is elevated; they must differ in `:root` and `.dark`
- fonts, radius, shadows, and spacing stay on `:root`; `.dark` overrides colors only
- put extras after `/* Project primitives */` and `/* Project utilities */`
- do not encode a route or component in a token name
- run `bun "{designDir}/scripts/validate-layout-scheme.ts" --project templates/<slug>/layout.css` after edits

Copy that file over the project's `layout.css` imports only after the user picks a winner. Draft markup uses theme utilities; do not keep a parallel `draft.css`.
