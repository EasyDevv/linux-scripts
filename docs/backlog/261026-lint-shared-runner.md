# Shared lint runner: open checks

On 261026, `dev/lint/lint-files.ts` became the one runner behind Claude Code's lint hook and pi's auto-lint. dlint now formats with `bun fmt` (Bun 1.4.4) instead of Prettier. The standing constraint is in `.agents/rules-routed/dev-lint-consumers.md`.

## Verified (261026)

- `bun test dev/lint/lint-files.test.ts`: 12 pass. `bun test extensions/lib/auto-lint.test.ts` in `~/.pi/agent`: 8 pass.
- Hook end-to-end in `~/dev/product/property-portal/apps/test` (pins `bun@1.4.2`) with a stale `PROTO_BUN_VERSION=1.4.2`: the file was formatted and the hook exited 0. With an ESLint error, it exited 2 and handed the diagnostic back.
- `bun fmt` and Prettier list the same 80 files in `~/.pi/agent`. Across ~1,470 files, output differs in 6, all from Bun keeping what was written (CSS trailing zeros, `url('…')` quotes) or Svelte `<pre>` indentation.

## Backlog

- pi's `extensions/auto-lint.ts` has not run inside a live pi session. Check: in a pi session, edit one `.ts` file and let the turn settle (expect `auto-lint: dlint: …`), then run `/lint` with no edits (expect a project-scan summary).
- `~/.pi/agent/scripts/check.ts` reports `17 new`: format and ESLint findings in files changed outside this work. It also flags 3 baselined entries as fixed (`auto-lint.ts`, `auto-lint.test.ts`, `check.ts`). Decide whether to fix them or run `bun scripts/check.ts --update-baseline`.
- `dev/lint/lint-files.ts` and `lint-files.test.ts` are untracked, and the `~/.pi/agent` changes are uncommitted next to unrelated work. Commit only `extensions/auto-lint.ts`, `extensions/lib/auto-lint.ts`, `extensions/lib/auto-lint.test.ts` and `scripts/check.ts` there.
- Once `bun fmt` has run for a while, decide whether to drop `prettier` from `dev/lint/package.json`. It stays for now because `prettier.config.js` resolves `prettier-plugin-svelte` and editors may use it. Check: `bun fmt --doctor` in `dev/lint`.
