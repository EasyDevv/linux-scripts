#!/usr/bin/env bun
// Claude Code hooks for the shared lint config; the counterpart of pi's `auto-lint` extension.
//   collect  PostToolUse: remember the file an Edit/Write touched.
//   run      Stop: `dlint --write` those files and `cargo clippy` their crates, then hand the diagnostics that
//            remain back to Claude once (exit 2); a second stop in a row never blocks.
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const DIR = import.meta.dir;
const MAX_FILES = 200;
const MAX_CHARS = 8_000;
const BIOME_TIMEOUT_MS = 60_000;
const CLIPPY_TIMEOUT_MS = 180_000;

const JS_SOURCE = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
const JSON_SOURCE = new Set([".json", ".jsonc"]);
const JSON_EXCLUDE = new Set(["package-lock.json", "npm-shrinkwrap.json"]);
const IGNORED_DIR = new Set(["node_modules", "target", "dist", ".git", "vendor"]);
const JS_MARKERS = [
	"package.json",
	"bun.lock",
	"bun.lockb",
	"pnpm-lock.yaml",
	"yarn.lock",
	"deno.json",
	"tsconfig.json",
];

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

const cwd = input.cwd ?? process.cwd();
const touched = existsSync(listPath) ? [...new Set(readFileSync(listPath, "utf8").split("\n").filter(Boolean))] : [];
rmSync(listPath, { force: true });

const jsProject = JS_MARKERS.some((name) => existsSync(join(cwd, name)));
const biomeTargets: string[] = [];
const crates = new Set<string>();
for (const raw of touched) {
	const file = resolve(cwd, raw);
	const rel = relative(cwd, file);
	if (rel === ".." || rel.startsWith(`..${sep}`) || !existsSync(file)) continue;
	if (file.split(/[\\/]/).some((part) => IGNORED_DIR.has(part))) continue;
	const ext = extname(file).toLowerCase();
	const base = file.split(/[\\/]/).pop() ?? "";
	if (JS_SOURCE.has(ext) || (jsProject && JSON_SOURCE.has(ext) && !JSON_EXCLUDE.has(base))) biomeTargets.push(file);
	if (ext === ".rs") {
		for (let dir = dirname(file); ; dir = dirname(dir)) {
			const manifest = join(dir, "Cargo.toml");
			if (existsSync(manifest) && /^\[package\]\s*$/m.test(readFileSync(manifest, "utf8"))) {
				crates.add(dir);
				break;
			}
			if (dirname(dir) === dir) break;
		}
	}
}

const diagnostics: string[] = [];
const run = (cmd: string[], cwd: string, timeout: number) => {
	const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", timeout });
	return {
		code: result.exitCode ?? 1,
		text: `${result.stdout.toString()}\n${result.stderr.toString()}`.trim(),
	};
};

if (biomeTargets.length > 0) {
	const files = biomeTargets.slice(0, MAX_FILES);
	const { code, text } = run(
		[join(DIR, "dlint"), "--write", "--colors=off", "--no-errors-on-unmatched", ...files],
		cwd,
		BIOME_TIMEOUT_MS,
	);
	if (code !== 0) diagnostics.push(`biome: ${text || `exit ${code}`}`);
}

const clippyArgs: string[] = existsSync(join(DIR, "clippy-args.json"))
	? JSON.parse(readFileSync(join(DIR, "clippy-args.json"), "utf8"))
	: [];
for (const crate of crates) {
	const cmd = [
		"env",
		`CLIPPY_CONF_DIR=${DIR}`,
		"cargo",
		"clippy",
		...(clippyArgs.length > 0 ? ["--", ...clippyArgs] : []),
	];
	const { code, text } = run(cmd, crate, CLIPPY_TIMEOUT_MS);
	if (code !== 0 || /\b(?:warning|error|help):/.test(text))
		diagnostics.push(`clippy (${crate}): ${text || `exit ${code}`}`);
}

if (diagnostics.length === 0 || input.stop_hook_active) process.exit(0);
const body = diagnostics.join("\n\n");
console.error(
	[
		"auto-lint remaining: biome --write / clippy left diagnostics. Fix them in the listed files. Do not start unrelated work.",
		body.length > MAX_CHARS ? `${body.slice(0, MAX_CHARS)}\n…truncated` : body,
	].join("\n\n"),
);
process.exit(2);
