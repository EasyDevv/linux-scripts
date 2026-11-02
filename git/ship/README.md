# ship (Go · Bubble Tea v2)

`ship` stages everything, commits with a message, and pushes in one step; `ship repo` connects
or creates a GitHub repository first. This is the Go port of `../ship.ts` (327 lines) and
`../picker.ts`; the TypeScript original stays in place as the reference.

## Usage

```text
ship [options]                  commit every change and push
ship repo [name] [options]      connect or create a GitHub repo, then push

-m, --message <text>            commit message
                                default: names of the 5 most-changed files
    --no-push                   commit only
    --repo [name]               no remote → create or connect without asking
    --public                    visibility of a new repository
    --private                   (default)
-h, --help                      show this help
```

- On a clean tree, `ship` pushes commits that no remote has yet (`2 unpushed commits`).
- `--no-push` stops after the commit.
- Without a remote and on a terminal, `ship` asks `No remote configured. Create a GitHub repository? [Y/n] ` (default Yes).
- `ship repo` replaces an existing origin; `ship --repo` never does. `origin` must be a
  `https://github.com/…` or `git@github.com:…` URL.
- With no TTY on stdin/stderr, the visibility picker is skipped and `private` is used.
- If `package.json` has a `db:snapshot` script, it runs (via `bun run db:snapshot`) before committing;
  a failure aborts the ship.

Exit codes: `0` ok, `1` fatal, `2` bad arguments, `130` picker abort (`q`, Esc, Ctrl-C).
`fatal:` messages go to stderr; the picker draws inline on stderr and leaves no alt-screen.

Wrapper: `../ship.sh` builds `bin/ship` from this module and execs it (`SHIP_ROOT` points here).
`bin/` is git-ignored.

## Layout

| Path | Ported from | Concern |
| --- | --- | --- |
| `main.go` | — | process entry, `app.Run(os.Args[1:])` |
| `internal/app/args.go` | `ship.ts` help + `parseArgs` | flags, node `parseArgs` diagnostics, help layout |
| `internal/app/color.go` | `ship.ts` color switch | one color switch (both TTYs, `NO_COLOR`, `TERM`) |
| `internal/app/git.go` | `ship.ts` git calls | argument-array git commands, captured vs inherited output |
| `internal/app/github.go` | `ship.ts` GitHub section | `gh` login/view/create, origin guard, picker call |
| `internal/app/commit.go` | `ship.ts` `db:snapshot` + `commit()` | pre-step, `--numstat` default message |
| `internal/app/run.go` | `ship.ts` top level | positional rules, flow, push fallback, exit codes |
| `internal/ui/picker.go` | `picker.ts` | inline Bubble Tea model, same keys and texts |

## Tests

```sh
cd git/ship && go vet ./... && go test ./...
git/ship/parity/run.sh        # original vs port, case by case
```

- `internal/app/args_test.go` — flag forms, Bun `parseArgs` error strings, help text (plain, colored).
- `internal/app/commit_test.go` — default message builder (top 5 basenames, `and N other(s)`, binary skip), flag message, `db:snapshot` truthiness.
- `internal/app/color_test.go` — the color switch (`NO_COLOR` empty vs set, `TERM=dumb`, one stream piped).
- `internal/ui/picker_test.go` — ports `picker.test.ts`: key meanings, move clamps, abort, frame text, Hangul cell width.

`parity/run.sh` runs `bun git/ship-ts/ship.ts` and the Go binary on identical fresh fixtures (temp `HOME`,
temp `GIT_CONFIG_GLOBAL`, fixed commit dates, local bare remotes, a fake `gh` first on `PATH`,
`https://github.com/` rewritten to the local bare repos so nothing reaches the network) and diffs
stdout, stderr, exit code, and post-state (HEAD subject, status, remotes, `gh` argv, bare refs).
Cases: `--help` (NO_COLOR=1), unknown flag, `--public --private`, extra positionals (both forms),
not a repo, 7 changed files (message checked through `git log`), binary-only change, `-m`,
`--no-push`, two unpushed commits on a clean tree, push with no upstream, nothing to do, no remote
without a TTY, `--repo` (new repo, private default), `--repo app2 --public`, `ship repo my-app
--public`, `--repo` with an existing repo, `db:snapshot` success and failure, and colored `--help`
on a real PTY. All cases are identical.

## Changelog (differences from `git/ship-ts/ship.ts`)

1. **`TERM=dumb` disables color.** The TS switch only looked at both TTYs and `NO_COLOR`; the
   build-terminal rule adds `TERM != dumb`. Reason: a dumb terminal must receive no SGR bytes.
2. **Picker abort exits 130 instead of 1.** Same fatal message (`aborted; no repository was
   created`); `q`, Esc, and Ctrl-C all take this path. Reason: the build-terminal abort rule
   (128+SIGINT) so a following `&&` command does not run.
3. **The picker is an inline `tea.Model`** instead of a raw-mode reader with cursor math. Keys,
   title, rows, hints, and footer text are unchanged; Bubble Tea's renderer draws the frames, so the
   exact escape/replay bytes and the repaint strategy differ. Reason: build-terminal wiring; one
   key event per press instead of a hand-split escape buffer.
4. **A failing `git add` / `git commit` exits 1 after git's own output.** The TS left the rejected
   Bun shell promise uncaught, so Bun printed a `ShellError` stack trace before exiting 1. Reason:
   no stack trace belongs on a CLI's stderr; the exit code matches.
5. **A missing `git`/`gh` binary reports `fatal: <exec error>` (exit 1)** instead of an uncaught
   `ShellError` stack. `gh` is still probed with a PATH lookup first, so the
   `GitHub CLI (gh) is not installed` fatal is unchanged.
6. **Prompts use a plain line reader** instead of `node:readline`: the `[Y/n]` and
   `Repository name [x]: ` texts and the `.trim()` of the answer are unchanged, but there is no
   in-line editing or history (the terminal's canonical mode still handles backspace). An EOF while
   a TTY prompt is open reports `fatal: EOF` and exits 1; the readline promise never settled before.
7. **`db:snapshot` still runs `bun run db:snapshot`** (same command, same inherited output).
   Reason: the project script owns its runtime. A spawn failure of `bun` is ignored, matching the
   original's `try/catch`.

No other intentional differences: help text/layout, parse diagnostics, `fatal:` messages, positional
rules, the `--numstat` message ranking (stable sort, top 5, ` and N other(s)`, binary lines
skipped), `git add .` scoped to the invocation directory, `db:snapshot` before commit, unpushed
counting, the no-remote skip notice, the `[Y/n]` default Yes, the origin URL guard, and the
`no upstream branch` push fallback all behave as in the TS original.
