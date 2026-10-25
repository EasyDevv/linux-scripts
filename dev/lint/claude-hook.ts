#!/usr/bin/env bun
// Claude Code hooks for the shared lint config; pi's `auto-lint` extension drives the same `lint-files.ts`.
//   collect  PostToolUse: remember the file an Edit/Write touched.
//   run      Stop: lint those files (`dlint --write --quiet` per package directory, `cargo clippy` per crate), then
//            hand the diagnostics that remain back to Claude once (exit 2); a second stop in a row never blocks.
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasFindings, planLint, runJobs } from "./lint-files.ts";

const MAX_CHARS = 8_000;

type HookInput = {
	session_id?: string;
	cwd?: string;
	stop_hook_active?: boolean;
	tool_input?: { file_path?: string; notebook_path?: string };
};

const input: HookInput = JSON.parse((await Bun.stdin.text()) || "{}");
const listPath = join(tmpdir(), `claude-lint-${(input.session_id ?? "none").replace(/[^\w-]/g, "")}.txt`);
const mode = process.argv[2];

if (mode === "collect") {
	const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
	if (file) appendFileSync(listPath, `${file}\n`);
	process.exit(0);
}
if (mode !== "run") {
	console.error("usage: claude-hook.ts collect|run");
	process.exit(1);
}

const touched = existsSync(listPath) ? readFileSync(listPath, "utf8").split("\n").filter(Boolean) : [];
rmSync(listPath, { force: true });

const plan = planLint({ cwd: input.cwd ?? process.cwd(), paths: touched });
const diagnostics = runJobs(plan)
	.filter(hasFindings)
	.map((result) => `${result.name} (${result.cwd}): ${result.output || `exit ${result.code}`}`);

if (diagnostics.length === 0 || input.stop_hook_active) process.exit(0);
const body = diagnostics.join("\n\n");
console.error(
	[
		"auto-lint remaining: dlint (bun fmt/eslint) / clippy left diagnostics. Fix the ones you introduced in the listed files; baselined legacy findings of the same rule in a file can be listed with them. Do not start unrelated work.",
		body.length > MAX_CHARS ? `${body.slice(0, MAX_CHARS)}\n…truncated` : body,
	].join("\n\n"),
);
process.exit(2);
