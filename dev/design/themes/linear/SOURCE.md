# linear

- Live URL (product): https://linear.app/easydevs/projects/all
- Live URL (inbox shell seam): https://linear.app/easydevs/inbox
- Live URL (settings family): https://linear.app/easydevs/settings/workspace
- Live URL (settings form wells): https://linear.app/easydevs/settings/teams/EAS/general
- Live URL (settings form toggles): https://linear.app/easydevs/settings/teams/EAS/workflow
- Live URL (issue label colors): https://linear.app/easydevs/settings/issue-labels
- Live URL (project status colors): https://linear.app/easydevs/settings/project-statuses
- Live URL (issue status colors): https://linear.app/easydevs/team/EAS/all
- Status colors: info `rgb(78, 167, 252)`, highlight `rgb(187, 135, 252)`, danger `rgb(235, 87, 87)`, neutral `rgb(149, 162, 179)`
- Viewport: 1440×900, page scale 100%, `html.dark`
- Responsive (settings General screencast): rail stays 244 with `--panel-inset` gutter while shrinking; at `--sidebar-hide-below` (1100px) the rail slides start (`--sidebar-collapse-duration` / `--sidebar-collapse-ease`); tablet keeps horizontal form rows; mobile stacks wells (`@container` 28rem)
- Font: Inter Variable → Inter + Noto Sans KR
- `.dark` is the measured workspace. `:root` uses Linear’s `--*-light` variables so the draft scheme toggle can switch modes.
- Tokens: `layout.css` / `spec.json`
- Role map (token names + which page taught them): `chrome.json`
- Tacit composition: `design.json`
