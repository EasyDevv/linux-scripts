import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guard } from "./guard.ts";
import { describeMissing, resolveMissing } from "./path-resolve.ts";

let home = "";
let project = "";
const put = (path: string, text = "x") => {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, text);
};

beforeAll(() => {
	home = mkdtempSync(join(tmpdir(), "pr-home-"));
	project = join(home, "dev", "app");
	put(join(home, ".agents/skills-archive/clarify-request/SKILL.md"));
	put(join(home, ".agents/skills-optional/research/shape-product/SKILL.md"));
	put(join(home, ".agents/skills-optional/research/shape-product/references/layout.md"));
	put(join(home, ".agents/skills-routed/web/browse-site/SKILL.md"));
	put(join(home, ".agents/skills-routed/web/browse-site/examples/dcinside-layout.md"));
	put(join(project, ".agents/skills-routed/research/shape-product/SKILL.md"));
	put(join(project, ".agents/skills-routed/research/shape-product/references/layout.md"));
	put(join(project, "src/lib/a.ts"));
	put(join(project, "docs/plan/one.md"));
	put(join(home, "twin/a/SKILL.md"));
	put(join(home, ".agents/skills-optional/dup/SKILL.md"));
	put(join(home, ".agents/skills-routed/dup/SKILL.md"));
});

const ctx = () => ({ home, cwd: project });

describe("resolveMissing: skill folders", () => {
	test("a skill that moved to another skills-* folder is rewritten", () => {
		const r = resolveMissing(join(home, ".agents/skills-optional/writing/clarify-request/SKILL.md"), ctx());
		expect(r).toMatchObject({ kind: "rewrite", path: join(home, ".agents/skills-archive/clarify-request/SKILL.md") });
	});

	test("a project skill path re-based onto ~/.agents resolves to the project's own copy", () => {
		const r = resolveMissing(join(home, ".agents/skills-routed/research/shape-product/references/layout.md"), ctx());
		expect(r).toMatchObject({ kind: "rewrite", path: join(project, ".agents/skills-routed/research/shape-product/references/layout.md") });
	});

	test("outside the project the global copy is the only candidate", () => {
		const r = resolveMissing(join(home, ".agents/skills-routed/research/shape-product/SKILL.md"), { home, cwd: home });
		expect(r).toMatchObject({ kind: "rewrite", path: join(home, ".agents/skills-optional/research/shape-product/SKILL.md") });
	});

	test("a file moved inside the skill is found by name", () => {
		const r = resolveMissing(join(home, ".agents/skills-routed/web/browse-site/references/examples/dcinside-layout.md"), ctx());
		expect(r).toMatchObject({
			kind: "rewrite",
			path: join(home, ".agents/skills-routed/web/browse-site/examples/dcinside-layout.md"),
			why: "the file moved inside the skill",
		});
	});

	test("two skills with the same name are ambiguous", () => {
		expect(resolveMissing(join(home, ".agents/skills/dup/SKILL.md"), ctx())?.kind).toBe("hint");
	});

	test("a path that exists is left alone", () => {
		expect(resolveMissing(join(project, "src/lib/a.ts"), ctx())).toBeUndefined();
	});
});

describe("resolveMissing: other paths", () => {
	test("lists the nearest existing directory and same-name files below it", () => {
		const r = resolveMissing(join(project, "docs/one.md"), ctx());
		expect(r).toMatchObject({ kind: "hint", nearest: join(project, "docs"), entries: ["plan/"] });
		expect(r?.kind === "hint" && r.matches).toEqual([join(project, "docs/plan/one.md")]);
		expect(r?.kind === "hint" && describeMissing(r)).toContain("plan/");
	});

	test("a relative path is resolved against cwd", () => {
		expect(resolveMissing("src/lib/b.ts", ctx())).toMatchObject({ kind: "hint", nearest: join(project, "src/lib") });
	});

	test("under the home directory itself no wide search runs", () => {
		const r = resolveMissing(join(home, "nothing.md"), ctx());
		expect(r).toMatchObject({ kind: "hint", nearest: home, matches: [] });
	});

	test("a missing tree falls back to the deepest directory that exists", () => {
		const r = resolveMissing(join(project, "no/such/deep/file.ts"), ctx());
		expect(r).toMatchObject({ kind: "hint", nearest: project });
	});
});

describe("guard path_resolve", () => {
	const call = (tool: string, args: Record<string, unknown>) =>
		guard({ harness: "pi", cwd: project, phase: "call", tool, args }, home);
	const failed = (tool: string, args: Record<string, unknown>, output: string) =>
		guard({ harness: "pi", cwd: project, phase: "result", tool, args, output, isError: true }, home);

	test("read on a moved skill file runs with the new path; other args stay", () => {
		const r = call("read", { path: join(home, ".agents/skills-optional/writing/clarify-request/SKILL.md"), limit: 80 });
		expect(r.action).toBe("rewrite");
		expect(r.rules).toEqual(["path_resolve"]);
		expect(r.args).toEqual({ path: join(home, ".agents/skills-archive/clarify-request/SKILL.md"), limit: 80 });
		expect(r.message).toContain("Use that path from now on");
	});

	test("Claude Read carries file_path", () => {
		const r = guard(
			{
				harness: "claude",
				cwd: project,
				phase: "call",
				tool: "Read",
				args: { file_path: join(home, ".agents/skills-optional/writing/clarify-request/SKILL.md") },
			},
			home,
		);
		expect(r.args?.file_path).toBe(join(home, ".agents/skills-archive/clarify-request/SKILL.md"));
	});

	test("find on a moved skill directory is rewritten", () => {
		const r = call("find", { pattern: "**/layout.md", path: join(home, ".agents/skills-routed/research/shape-product/references") });
		expect(r.action).toBe("rewrite");
	});

	test("an existing path and a write are untouched", () => {
		expect(call("read", { path: join(project, "src/lib/a.ts") }).action).toBe("none");
		expect(call("write", { path: join(home, ".agents/skills-optional/w/clarify-request/SKILL.md") }).status).toBe("skipped");
	});

	test("a failed read with no better place gets the directory listing", () => {
		const r = failed("read", { path: join(project, "docs/one.md") }, "ENOENT: no such file or directory, access 'x'");
		expect(r.action).toBe("hint");
		expect(r.message).toContain("plan/");
		expect(r.message).toContain(join(project, "docs/plan/one.md"));
	});

	test("an unrelated failure gets no path hint", () => {
		expect(failed("read", { path: join(project, "docs/one.md") }, "EACCES: permission denied").action).toBe("none");
		expect(failed("read", { path: join(project, "src/lib/a.ts") }, "ENOENT").action).toBe("none");
	});

	test("a failed edit on a missing file gets the path hint, on a present file the edit hint", () => {
		const r = failed("edit", { path: join(project, "docs/one.md"), oldText: "a", newText: "b" }, "ENOENT: no such file");
		expect(r.rules).toEqual(["path_resolve"]);
	});

	test("wide find stays denied before the path rule", () => {
		expect(call("find", { pattern: "*.md", path: home }).rules).toEqual(["wide_search"]);
	});
});
