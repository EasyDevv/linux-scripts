# linear theme-ref

shadcn-svelte reconstructions of `{designDir}/ref/linear.app/` using `../layout.css`.

Shared chrome: `app-sidebar.svelte`, `app-header.svelte`, `app-footer.svelte` composed by `shell.svelte`.

Property menus (project overview aside): `prop-status.svelte`, `prop-priority.svelte` on `prop-picker.svelte` (RefMenu). Dates/labels: `prop-popover.svelte`.

| page | source |
| --- | --- |
| `projects-all/page.svelte` | `/easydevs/team/EAS/projects/all` |
| `team-all/page.svelte` | `/easydevs/team/EAS/all` |
| `project-overview/page.svelte` | `/easydevs/project/test-…/overview` |

Preview (dashboard must list `theme-linear`):

```text
http://dashboard.localhost/design/draft?file=projects-all/page.svelte&project=theme-linear&style=linear&scheme=dark
```

PNG/MHTML stay in `{designDir}/ref/linear.app/`.
