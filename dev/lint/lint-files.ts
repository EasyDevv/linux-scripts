#!/usr/bin/env bun
// The shared lint runner behind Claude Code's `claude-hook.ts` and pi's `auto-lint` extension: plan `dlint` per
// package directory and `cargo clippy` per crate for the touched files, run them, and report what remains.
//   lint-files.ts [--scan] [--json] [--cwd dir] [files...]
//     files    `dlint --write --quiet` them from their package directory and `cargo clippy` their crates
//     --scan   with no lintable files, check the whole cwd instead (never writes: that would mass-rewrite the tree)
//     --json   print `{ notes, results, diagnostics }` for callers that render their own summary; otherwise print the
//              diagnostics
//   exit 0 clean, 1 diagnostics remain
// JSON is left alone: compact JSON keeps what agents read small.
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

export const LINT_DIR = import.meta.dir;
export const DLINT_TIMEOUT_MS = 120_000;
export const CLIPPY_TIMEOUT_MS = 180_000;
export const MAX_DLINT_FILES = 200;

/** Files `dlint` formats or lints. */
const CODE_SOURCE = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts", ".svelte", ".css"]);
const JS_MARKERS = [
	"package.json",
	"bun.lock",
	"bun.lockb",
	"pnpm-lock.yaml",
	"yarn.lock",
	"deno.json",
	"deno.jsonc",
	"tsconfig.json",
	"jsconfig.json",
];
const IGNORED_DIR = new Set([
	"node_modules",
	"target",
	"dist",
	".git",
	"vendor",
	".svelte-kit",
	"build",
	".output",
	".wxt",
]);

export type LintJob = {
	name: "dlint" | "clippy";
	command: string;
	args: string[];
	cwd: string;
	timeout: number;
};

export type LintPlan = { jobs: LintJob[]; notes: string[] };

/** One finished job; `output` is stdout and stderr joined and trimmed. */
export type LintResult = { name: LintJob["name"]; cwd: string; code: number; killed: boolean; output: string };

type Exists = (path: string) => boolean;
type ReadFile = (path: string) => string;
const readUtf8: ReadFile = (path) => readFileSync(path, "utf8");

export function isIgnoredPath(filePath: string): boolean {
	return filePath.split(/[\\/]/).some((part) => IGNORED_DIR.has(part));
}

export function isCodeSource(filePath: string): boolean {
	return CODE_SOURCE.has(extname(filePath).toLowerCase());
}

export function isRustSource(filePath: string): boolean {
	return extname(filePath).toLowerCase() === ".rs";
}

export function isJsProject(cwd: string, exists: Exists = existsSync): boolean {
	return JS_MARKERS.some((name) => exists(join(cwd, name)));
}

export function hasPackageTable(toml: string): boolean {
	return /^\[package\]\s*$/m.test(toml);
}

export function findCargoPackageDir(
	filePath: string,
	exists: Exists = existsSync,
	readFile: ReadFile = readUtf8,
): string | undefined {
	for (let dir = dirname(filePath); ; dir = dirname(dir)) {
		const manifest = join(dir, "Cargo.toml");
		if (exists(manifest) && hasPackageTable(readFile(manifest))) return dir;
		if (dirname(dir) === dir) return undefined;
	}
}

/** dlint runs from the nearest package.json directory, where `eslint-suppressions.json` and `.gitignore` live. */
export function findPackageDir(filePath: string, cwd: string, exists: Exists = existsSync): string {
	for (let dir = dirname(filePath); ; dir = dirname(dir)) {
		if (exists(join(dir, "package.json"))) return dir;
		if (dir === cwd || dirname(dir) === dir) return cwd;
	}
}

export function readClippyArgs(lintDir: string, readFile: ReadFile = readUtf8, exists: Exists = existsSync): string[] {
	const file = join(lintDir, "clippy-args.json");
	if (!exists(file)) return [];
	try {
		const parsed: unknown = JSON.parse(readFile(file));
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
	} catch {
		return [];
	}
}

/** Existing code and Rust files under cwd, deduplicated, outside vendor and build trees. */
export function classifyTouchedFiles(
	cwd: string,
	paths: string[],
	options: { exists?: Exists } = {},
): { code: string[]; rust: string[] } {
	const exists = options.exists ?? existsSync;
	const code: string[] = [];
	const rust: string[] = [];
	const seen = new Set<string>();
	for (const raw of paths) {
		if (raw.length === 0) continue;
		const absolute = resolve(cwd, raw);
		if (seen.has(absolute)) continue;
		seen.add(absolute);
		if (isIgnoredPath(absolute) || !exists(absolute)) continue;
		const rel = relative(cwd, absolute);
		if (rel === ".." || rel.startsWith(`..${sep}`)) continue;
		if (isCodeSource(absolute)) code.push(absolute);
		if (isRustSource(absolute)) rust.push(absolute);
	}
	return { code, rust };
}

/**
 * Touched files get `dlint --write --quiet` per package directory. A project scan (no touched files) only checks:
 * a write over the whole tree would mass-rewrite it.
 */
export function planLint(input: {
	cwd: string;
	paths: string[];
	lintDir?: string;
	scanProject?: boolean;
	exists?: Exists;
	readFile?: ReadFile;
}): LintPlan {
	const lintDir = input.lintDir ?? LINT_DIR;
	const exists = input.exists ?? existsSync;
	const readFile = input.readFile ?? readUtf8;
	const classified = classifyTouchedFiles(input.cwd, input.paths, { exists });
	const notes: string[] = [];
	const jobs: LintJob[] = [];
	const dlint = join(lintDir, "dlint");

	let codeFiles = classified.code;
	if (codeFiles.length > MAX_DLINT_FILES) {
		codeFiles = codeFiles.slice(0, MAX_DLINT_FILES);
		notes.push(`dlint: truncated to ${MAX_DLINT_FILES} files`);
	}
	const groups = new Map<string, string[]>();
	for (const file of codeFiles) {
		const pkg = findPackageDir(file, input.cwd, exists);
		groups.set(pkg, [...(groups.get(pkg) ?? []), relative(pkg, file)]);
	}
	const scan = groups.size === 0 && input.scanProject === true && isJsProject(input.cwd, exists);
	if (groups.size > 0 || scan) {
		if (!exists(dlint)) notes.push("dlint: missing lint/dlint");
		else if (scan) {
			jobs.push({ name: "dlint", command: dlint, args: ["--quiet", "."], cwd: input.cwd, timeout: DLINT_TIMEOUT_MS });
		} else {
			for (const [pkg, files] of groups) {
				jobs.push({
					name: "dlint",
					command: dlint,
					args: ["--write", "--quiet", ...files],
					cwd: pkg,
					timeout: DLINT_TIMEOUT_MS,
				});
			}
		}
	}

	const clippyDirs = new Set<string>();
	for (const file of classified.rust) {
		const pkg = findCargoPackageDir(file, exists, readFile);
		if (pkg) clippyDirs.add(pkg);
	}
	if (clippyDirs.size === 0 && input.scanProject === true && exists(join(input.cwd, "Cargo.toml"))) {
		clippyDirs.add(input.cwd);
	}
	const clippyArgs = readClippyArgs(lintDir, readFile, exists);
	for (const dir of clippyDirs) {
		const args = [`CLIPPY_CONF_DIR=${lintDir}`, "cargo", "clippy"];
		if (clippyArgs.length > 0) args.push("--", ...clippyArgs);
		jobs.push({ name: "clippy", command: "env", args, cwd: dir, timeout: CLIPPY_TIMEOUT_MS });
	}

	return { jobs, notes };
}

export function clippyHasFindings(output: string): boolean {
	return /\b(?:warning|error|help):/.test(output);
}

/** Whether a finished job left something to fix: dlint by exit code, clippy also by its warnings. */
export function hasFindings(result: LintResult): boolean {
	if (result.killed) return false;
	return result.code !== 0 || (result.name === "clippy" && clippyHasFindings(result.output));
}

export function runJobs(plan: LintPlan): LintResult[] {
	return plan.jobs.map((job) => {
		const result = Bun.spawnSync([job.command, ...job.args], {
			cwd: job.cwd,
			stdout: "pipe",
			stderr: "pipe",
			timeout: job.timeout,
		});
		const output = [result.stdout.toString(), result.stderr.toString()].filter(Boolean).join("\n").trim();
		return { name: job.name, cwd: job.cwd, code: result.exitCode ?? 1, killed: result.exitCode === null, output };
	});
}

/** The full output of every job with findings; timeouts are left to the caller's summary. */
export function remainingDiagnostics(results: LintResult[]): string {
	return results
		.filter(hasFindings)
		.map((result) => (result.output.length > 0 ? result.output : `${result.name}: exit ${result.code}`))
		.join("\n\n");
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	let cwd = process.cwd();
	let scanProject = false;
	let json = false;
	const paths: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--scan") scanProject = true;
		else if (arg === "--json") json = true;
		else if (arg === "--cwd" && args[i + 1] !== undefined) cwd = resolve(args[++i]);
		else if (arg.startsWith("-")) {
			console.error(`lint-files: unknown option ${arg} (use --scan, --json, --cwd dir)`);
			process.exit(2);
		} else paths.push(arg);
	}
	const plan = planLint({ cwd, paths, scanProject });
	const results = runJobs(plan);
	const diagnostics = remainingDiagnostics(results);
	if (json) {
		const reported = results.map((result) => ({ ...result, findings: hasFindings(result) }));
		console.log(JSON.stringify({ notes: plan.notes, results: reported, diagnostics }));
	} else if (diagnostics.length > 0) console.log(diagnostics);
	process.exit(diagnostics.length > 0 ? 1 : 0);
}
