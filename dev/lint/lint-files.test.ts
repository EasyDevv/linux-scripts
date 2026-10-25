import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
	classifyTouchedFiles,
	findCargoPackageDir,
	hasFindings,
	hasPackageTable,
	isCodeSource,
	isIgnoredPath,
	isJsProject,
	isRustSource,
	type LintResult,
	planLint,
	remainingDiagnostics,
} from "./lint-files.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "lint-files-"));
}

function result(name: "dlint" | "clippy", overrides: Partial<LintResult> = {}): LintResult {
	return { name, cwd: "/", code: 0, killed: false, output: "", ...overrides };
}

test("ignored paths skip vendor trees", () => {
	expect(isIgnoredPath("/proj/node_modules/foo.ts")).toBe(true);
	expect(isIgnoredPath("/proj/target/debug/lib.rs")).toBe(true);
	expect(isIgnoredPath("/proj/src/lib.rs")).toBe(false);
});

test("code and rust source markers", () => {
	expect(isCodeSource("/proj/app.ts")).toBe(true);
	expect(isCodeSource("/proj/Page.svelte")).toBe(true);
	expect(isCodeSource("/proj/layout.css")).toBe(true);
	expect(isCodeSource("/proj/data.json")).toBe(false);
	expect(isCodeSource("/proj/lib.rs")).toBe(false);
	expect(isRustSource("/proj/lib.rs")).toBe(true);
	expect(isRustSource("/proj/app.ts")).toBe(false);
});

test("js project markers", () => {
	const cwd = tempDir();
	try {
		expect(isJsProject(cwd)).toBe(false);
		writeFileSync(join(cwd, "package.json"), "{}");
		expect(isJsProject(cwd)).toBe(true);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("classify sends code files to dlint and leaves json alone", () => {
	const cwd = tempDir();
	try {
		writeFileSync(join(cwd, "app.ts"), "export {}\n");
		writeFileSync(join(cwd, "Page.svelte"), "<p>hi</p>\n");
		writeFileSync(join(cwd, "layout.css"), "p {}\n");
		writeFileSync(join(cwd, "data.json"), "{}\n");
		writeFileSync(join(cwd, "lib.rs"), "fn main() {}\n");
		const classified = classifyTouchedFiles(cwd, ["app.ts", "Page.svelte", "layout.css", "data.json", "lib.rs"]);
		expect(classified.code.map((p) => p.slice(cwd.length + 1)).sort()).toEqual(["Page.svelte", "app.ts", "layout.css"]);
		expect(classified.rust.map((p) => p.slice(cwd.length + 1))).toEqual(["lib.rs"]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("classify skips files outside cwd", () => {
	const cwd = tempDir();
	try {
		writeFileSync(join(cwd, "in.ts"), "export {}\n");
		const outside = join(cwd, "..", "out.ts");
		writeFileSync(outside, "export {}\n");
		const classified = classifyTouchedFiles(cwd, ["in.ts", outside]);
		expect(classified.code).toEqual([join(cwd, "in.ts")]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("findCargoPackageDir stops at [package], not workspace", () => {
	const cwd = tempDir();
	try {
		writeFileSync(join(cwd, "Cargo.toml"), '[workspace]\nmembers = ["crate"]\n');
		mkdirSync(join(cwd, "crate", "src"), { recursive: true });
		writeFileSync(join(cwd, "crate", "Cargo.toml"), '[package]\nname = "crate"\nversion = "0.1.0"\n');
		writeFileSync(join(cwd, "crate", "src", "lib.rs"), "");
		expect(hasPackageTable("[workspace.package]\n")).toBe(false);
		expect(findCargoPackageDir(join(cwd, "crate", "src", "lib.rs"))).toBe(join(cwd, "crate"));
		expect(findCargoPackageDir(join(cwd, "Cargo.toml"))).toBe(undefined);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("planLint runs dlint --write --quiet per package dir and clippy with CLIPPY_CONF_DIR", () => {
	const root = tempDir();
	try {
		const cwd = join(root, "proj");
		const client = join(cwd, "apps", "client");
		const lintDir = join(root, "lint");
		mkdirSync(join(client, "src"), { recursive: true });
		mkdirSync(join(cwd, "src"), { recursive: true });
		mkdirSync(lintDir, { recursive: true });
		writeFileSync(join(cwd, "package.json"), "{}");
		writeFileSync(join(client, "package.json"), "{}");
		writeFileSync(join(client, "src", "Page.svelte"), "<p>hi</p>\n");
		writeFileSync(join(cwd, "src", "app.ts"), "export {}\n");
		writeFileSync(join(cwd, "src", "lib.rs"), "fn main() {}\n");
		writeFileSync(join(cwd, "Cargo.toml"), '[package]\nname = "proj"\nversion = "0.1.0"\n');
		writeFileSync(join(lintDir, "dlint"), "");
		writeFileSync(join(lintDir, "clippy-args.json"), '["-W","clippy::all"]\n');
		const plan = planLint({
			cwd,
			paths: [join(client, "src", "Page.svelte"), join(cwd, "src", "app.ts"), join(cwd, "src", "lib.rs")],
			lintDir,
			scanProject: false,
		});
		const dlint = plan.jobs.filter((job) => job.name === "dlint");
		expect(dlint.map((job) => [job.cwd, job.command, job.args])).toEqual([
			[client, join(lintDir, "dlint"), ["--write", "--quiet", join("src", "Page.svelte")]],
			[cwd, join(lintDir, "dlint"), ["--write", "--quiet", join("src", "app.ts")]],
		]);
		const clippy = plan.jobs.find((job) => job.name === "clippy");
		expect(clippy).toBeDefined();
		expect(clippy?.command).toBe("env");
		expect(clippy?.args[0]).toBe(`CLIPPY_CONF_DIR=${lintDir}`);
		expect(clippy?.args.slice(1)).toEqual(["cargo", "clippy", "--", "-W", "clippy::all"]);
		expect(clippy?.cwd).toBe(cwd);
		expect(plan.notes).toEqual([]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("planLint scanProject only checks cwd when no touched files", () => {
	const root = tempDir();
	try {
		const cwd = join(root, "proj");
		const lintDir = join(root, "lint");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(lintDir, { recursive: true });
		writeFileSync(join(cwd, "package.json"), "{}");
		writeFileSync(join(cwd, "Cargo.toml"), '[package]\nname = "proj"\nversion = "0.1.0"\n');
		writeFileSync(join(lintDir, "dlint"), "");
		const plan = planLint({ cwd, paths: [], lintDir, scanProject: true });
		expect(plan.jobs[0]?.name).toBe("dlint");
		expect(plan.jobs[0]?.args).toEqual(["--quiet", "."]);
		expect(plan.jobs[0]?.cwd).toBe(cwd);
		expect(plan.jobs[1]?.name).toBe("clippy");
		expect(plan.jobs[1]?.cwd).toBe(cwd);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("planLint notes a missing dlint instead of planning a job", () => {
	const root = tempDir();
	try {
		const cwd = join(root, "proj");
		mkdirSync(cwd, { recursive: true });
		writeFileSync(join(cwd, "package.json"), "{}");
		writeFileSync(join(cwd, "app.ts"), "export {}\n");
		const plan = planLint({ cwd, paths: ["app.ts"], lintDir: join(root, "lint"), scanProject: false });
		expect(plan.jobs).toEqual([]);
		expect(plan.notes).toEqual(["dlint: missing lint/dlint"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("hasFindings reads dlint by exit code and clippy by output", () => {
	expect(hasFindings(result("clippy", { code: 0, output: "warning: unused variable: `x`" }))).toBe(true);
	expect(hasFindings(result("clippy", { code: 1, killed: true, output: "warning: unused variable: `x`" }))).toBe(false);
	expect(hasFindings(result("dlint", { code: 1, output: "shadcn/no-restyle" }))).toBe(true);
	expect(hasFindings(result("dlint", { code: 0 }))).toBe(false);
	expect(hasFindings(result("clippy", { code: 0, output: "Finished `dev` profile" }))).toBe(false);
});

test("remainingDiagnostics keeps full dlint output and skips timeouts", () => {
	const diagnostic = `${"x".repeat(400)}\nshadcn/no-restyle`;
	expect(remainingDiagnostics([result("dlint", { code: 1, output: diagnostic })])).toBe(diagnostic);
	expect(
		remainingDiagnostics([result("dlint"), result("clippy", { code: 1, killed: true, output: "timed out" })]),
	).toBe("");
	expect(remainingDiagnostics([result("clippy", { code: 0, output: "warning: unused variable" })])).toBe(
		"warning: unused variable",
	);
});

test("CLI reports an empty plan as JSON and exits 0", () => {
	const cwd = tempDir();
	try {
		const run = Bun.spawnSync([process.execPath, join(import.meta.dir, "lint-files.ts"), "--json", "--cwd", cwd], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(run.stderr.toString()).toBe("");
		expect(run.exitCode).toBe(0);
		expect(JSON.parse(run.stdout.toString())).toEqual({ notes: [], results: [], diagnostics: "" });
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
