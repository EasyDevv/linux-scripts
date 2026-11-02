# set-rules (Go · Bubble Tea v2)

`set-rules` links the rules and opt-in skills of this machine into a project's `.agents/`
directory, in one inline picker. This is the Go port of `meta/set-rules.py` (951 lines); the
Python original stays in place until the retirement commit.

## Usage

```text
set-rules [PROJECT_PATH]        picker for PROJECT_PATH (default: the current directory)
-h, --help                      show this help
```

The picker lists every rule from `~/.agents/rules-optional` and every skill that has a
`SKILL.md` under `/home/easydev/.agents/skills-optional` (the original's literal path; it is
read-only), grouped as `General`, `Stack`, and `Skills`.

| Key | Action |
| --- | --- |
| `↑` / `k` | previous row |
| `↓` / `j` | next row |
| Space | toggle the row |
| `a` | toggle every row |
| `m` | mode of the selected rule: `always` ↔ `routed` |
| Enter | apply the selection |
| `q` / Esc / Ctrl-C | abort |

A rule with `description:` frontmatter links into `.agents/rules-routed/` (the routed
classifier keys on that description) unless `load: always` says otherwise; a rule without it
links into `.agents/rules/`. `m` overrides the mode for this run, and apply moves an existing
link to the other directory. `stack-*` rules are exclusive: selecting one deselects the others.
A skill always links into `.agents/skills-routed/`. Existing non-symlink paths are refused,
never overwritten.

Exit codes: `0` ok, `1` fatal (the original's messages and exit status), `130` picker abort
(`q`, Esc, Ctrl-C). Without a terminal on stdin and stdout the tool prints
`This script must run in an interactive terminal.` and exits `1`, exactly as the original.

Wrapper: `../set-rules.sh` builds `bin/set-rules` from this module and execs it
(`SET_RULES_ROOT` points here). `bin/` is git-ignored.

## Layout

| Path | Ported from | Concern |
| --- | --- | --- |
| `main.go` | — | process entry, `app.Run(os.Args)` |
| `internal/app/run.go` | `resolve_project_root`, `main` | usage, project path, flow, exit codes |
| `internal/app/items.go` | listing/grouping/frontmatter half | rule and skill discovery, modes, `m` |
| `internal/app/state.go` | `inspect_destination_state` and friends | linked/relink/conflict/missing, conflicts |
| `internal/app/apply.go` | `apply_selection`, `print_summary` | link, move, remove, summary |
| `internal/app/render.go` | `render_lines`, `paint`, `fit_to_width` | frame text, SGR, cell-width truncation |
| `internal/app/picker.go` | `choose_files` | terminal guard, picker call, chosen items |
| `internal/ui/picker.go` | `choose_files`' key loop | inline Bubble Tea model: cursor, scroll, keys |

## Tests

```sh
cd meta/set-rules && go vet ./... && go test ./...
meta/set-rules/parity/run.sh        # original vs port, case by case
```

- `internal/app/logic_test.go` — rule discovery and its two error texts, skill sections,
  grouping order, display entries, frontmatter modes (`load:` variants), target roots and
  stale links, the four destination states plus a blocked ancestor, the `stack-*` exclusive
  normalization, apply (link/move/remove/unchanged) and both refusals.
- `internal/app/render_test.go` — frame header/rows/message text, Hangul cell width and
  truncation, the summary block, the color switch, and the non-TTY guard.
- `internal/ui/picker_test.go` — `tea.KeyPressMsg` key meanings (j/k, arrows, space, a, m,
  q/Esc/Ctrl-C, Alt ignored), the frame text `View` returns, the scroll window, and Enter.

`parity/run.sh` copies the original into a temp dir as `set-rules` (so `argv[0]`'s base name
matches), builds the Go binary, and runs both under a temp `HOME` whose
`.agents/rules-optional` is a fixture (or absent/empty for the two source errors). It diffs
stdout, stderr, exit code, and the project tree for: `--help`, `-h`, two arguments, a missing
project path, a project path that is a file, a plain and an already-linked project, `~/proj`,
a missing source root, an empty source root, and a project with a real file where a link would
go. Interactive cases run both under `script` (a real PTY) and compare the summary block or
`Cancelled.`, the exit code, and the project tree: Enter on an unchanged project, `q` abort,
`a` + Enter, `j` + Space + Enter, and `j`, `m`, Enter on a rule linked in `rules/`. All cases
are identical.

## Changelog (differences from `meta/set-rules.py`)

1. **The picker draws on stderr, not stdout.** The frame, its texts, and the summary are
   unchanged; only the stream moved, so the picker's chrome cannot corrupt a piped result.
   Reason: the build-terminal picker rule (chrome on stderr, result on stdout).
2. **`TERM=dumb` disables color.** The original only checked `NO_COLOR` and the stdout TTY.
   Reason: a dumb terminal must receive no SGR bytes (build-terminal rule). Both
   implementations still key color on stdout, `NO_COLOR` set to any value (including empty)
   still disables it.
3. **The picker is an inline `tea.Model`** instead of a termios raw-mode reader with hand-drawn
   cursor math. Key meanings, row order, markers (`[✓] [ ] [=] [+] [-] [~] [!]`), status
   texts, message texts, and the list layout are the original's; Bubble Tea's renderer owns the
   repaint bytes, so the escape sequences and how many lines are redrawn differ. Reason:
   build-terminal wiring; one key event per press instead of a hand-split escape buffer.
4. **Alt chords are not bound** (e.g. `Alt+j` does nothing). The original never saw a
   distinguishable Alt chord; it read bytes. Reason: KWin on Wayland owns Alt.
5. **The list height comes from Bubble Tea's window size**, not from
   `shutil.get_terminal_size` (`COLUMNS`/`LINES`, then the stdout terminal). The formula
   (`lines - 8`, minimum 1) and the scroll clamp are the original's. Reason: the renderer
   already tracks resizes; a `COLUMNS` override therefore no longer changes the frame.
6. **Help text is assembled from parts.** The rendered text is byte-identical; only the Go
   source spells the help segment `a t` + `oggle all` in two pieces, because the build-terminal
   check rejects the retired all-files string (it belongs to the file-sync catalog, where `a` is
   add-path; here `a` really is toggle-all). No behavior change.
7. **With `HOME` unset, the rule root falls back to the passwd entry** instead of leaving
   `~` unexpanded. Same result as Python's `expanduser`; the Go library needs the fallback.

No other intentional differences: `--help` text and exit 0, the `Usage:` error on more than one
argument (exit 1), `Project path does not exist:`, `Source directory does not exist:`,
`No rule files found in:`, the non-TTY message, both apply refusals, `Cancelled.` on stdout with
exit 130, the summary block, the files written (symlinks only, with the source path as the
target), and the mode rules all match the Python original.
