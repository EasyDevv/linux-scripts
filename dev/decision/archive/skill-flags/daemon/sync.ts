#!/usr/bin/env bun
/**
 * One-shot sync of the shared skill-flag policy, for harnesses that cannot import `core.ts`
 * directly. Claude Code's `agents-rules` SessionStart hook runs it with the project as cwd:
 *
 *   bun <decision>/skill-flags/sync.ts [--cwd <path>]
 *
 * Prints one line per run; the hook discards stdout so it never becomes session context.
 */
import { formatSyncResult, skillRoots, syncSkillFlags } from "./core.ts";

const index = process.argv.indexOf("--cwd");
const cwd = index > 0 ? (process.argv[index + 1] ?? process.cwd()) : process.cwd();

const result = syncSkillFlags({ roots: skillRoots({ cwd }) });
process.stdout.write(`${formatSyncResult(result)}\n`);
