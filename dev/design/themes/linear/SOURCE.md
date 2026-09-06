# linear

- Live URL (product): https://linear.app/easydevs/projects/all
- Live URL (settings family): https://linear.app/easydevs/settings/workspace
- Live URL (settings form wells): https://linear.app/easydevs/settings/teams/EAS/general
- Live URL (settings form toggles): https://linear.app/easydevs/settings/teams/EAS/workflow
- Viewport: 1440×900, page scale 100%, `html.dark`
- Responsive (settings General screencast): rail stays 244 with `--panel-inset` gutter while shrinking; at `--sidebar-hide-below` (1100px) the rail slides start (`--sidebar-collapse-duration` / `--sidebar-collapse-ease`); tablet keeps horizontal form rows; mobile stacks wells (`@container` 28rem)
- Font: Inter Variable → Inter + Noto Sans KR
- `.dark` is the measured workspace. `:root` uses Linear’s `--*-light` variables so the draft scheme toggle can switch modes.
- Tokens: `layout.css` / `spec.json`
- Role map (token names + which page taught them): `chrome.json`
- Tacit composition: `design.json`
