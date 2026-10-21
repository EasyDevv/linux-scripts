import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyHiddenFlag,
	discoverProjectSkillRoots,
	FLAG_KEY,
	formatSyncResult,
	listSkillFiles,
	projectRootFor,
	readSkillFlagConfig,
	skillRoots,
	syncSkillFlags,
	watchTargets,
} from "./core.ts";

const roots: string[] = [];
function temp(prefix = "decision-skill-flags-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	roots.push(dir);
	return dir;
}
afterAll(() => {
	for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function skillMd(name: string, flag?: string): string {
	const flagLine = flag === undefined ? "" : `\n${FLAG_KEY}: ${flag}`;
	return `---\nname: ${name}\ndescription: test${flagLine}\n---\n\n# ${name}\n`;
}

function writeSkill(dir: string, name: string, flag?: string): string {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "SKILL.md");
	writeFileSync(file, skillMd(name, flag));
	return file;
}

function hasFlag(filePath: string): boolean {
	return readFileSync(filePath, "utf8").includes(`${FLAG_KEY}: true`);
}

describe("syncSkillFlags", () => {
	test("hides every skill in every root, _manual or not, once", () => {
		const base = temp();
		const skills = join(base, "skills");
		const optional = join(base, "skills-optional");
		const visible = writeSkill(join(skills, "visible"), "visible");
		const manual = writeSkill(join(skills, "_manual", "manual"), "manual", "true");
		const off = writeSkill(join(optional, "off"), "off", "false");

		const first = syncSkillFlags({ roots: [skills, optional] });
		expect(first.scanned).toBe(3);
		expect(first.changed.map((change) => change.name).sort()).toEqual(["off", "visible"]);
		for (const file of [visible, manual, off]) expect(hasFlag(file)).toBe(true);
		expect(readFileSync(off, "utf8")).not.toContain(`${FLAG_KEY}: false`);

		const second = syncSkillFlags({ roots: [skills, optional] });
		expect(second.scanned).toBe(3);
		expect(second.changed).toEqual([]);
	});

	test("counts a root symlink into _manual as one skill", () => {
		const base = temp();
		const skills = join(base, "skills");
		const realSkill = join(skills, "_manual", "hidden");
		const realFile = writeSkill(realSkill, "hidden");
		symlinkSync(realSkill, join(skills, "hidden"));

		const result = syncSkillFlags({ roots: [skills] });
		expect(result.scanned).toBe(1);
		expect(result.changed.map((change) => change.name)).toEqual(["hidden"]);
		expect(hasFlag(realFile)).toBe(true);
	});

	test("dry run reports without writing", () => {
		const base = temp();
		const skills = join(base, "skills");
		const file = writeSkill(join(skills, "visible"), "visible");

		const result = syncSkillFlags({ roots: [skills], apply: false });
		expect(result.changed.map((change) => change.name)).toEqual(["visible"]);
		expect(hasFlag(file)).toBe(false);
	});

	test("skips SKILL.md without frontmatter and leaves unrelated frontmatter untouched", () => {
		const base = temp();
		const skills = join(base, "skills");
		mkdirSync(join(skills, "broken"), { recursive: true });
		writeFileSync(join(skills, "broken", "SKILL.md"), "# No frontmatter\n");
		const parsed = applyHiddenFlag("---\nname: x\ndescription: y\n---\nBody\n");
		expect(parsed).toBe(`---\nname: x\ndescription: y\n${FLAG_KEY}: true\n---\nBody\n`);
		expect(applyHiddenFlag(`---\nname: x\n${FLAG_KEY}: true\n---\nBody\n`)).toBeNull();
	});
});

describe("root discovery", () => {
	test("finds every project .agents/skills, skipping node_modules and dot dirs", () => {
		const base = temp();
		writeSkill(join(base, "product", "a", ".agents", "skills", "one"), "one");
		writeSkill(join(base, "deep", "x", "b", ".agents", "skills", "two"), "two");
		writeSkill(join(base, "node_modules", "pkg", ".agents", "skills", "skip"), "skip");
		writeSkill(join(base, ".hidden", ".agents", "skills", "skip"), "skip");

		const found = discoverProjectSkillRoots(base, 6).map((root) => root.slice(base.length + 1));
		expect(found.sort()).toEqual(["deep/x/b/.agents/skills", "product/a/.agents/skills"]);
	});

	test("honors maxDepth", () => {
		const base = temp();
		writeSkill(join(base, "a", "b", "c", ".agents", "skills", "deep"), "deep");
		expect(discoverProjectSkillRoots(base, 1)).toEqual([]);
		expect(discoverProjectSkillRoots(base, 4)).toHaveLength(1);
	});

	test("project root walks up to .git or .agents, and skillRoots dedupes", () => {
		const base = temp();
		const project = join(base, "repo");
		mkdirSync(join(project, ".git"), { recursive: true });
		const nested = join(project, "apps", "client");
		mkdirSync(nested, { recursive: true });
		const agents = join(base, "agents-home");
		writeSkill(join(agents, "skills", "global"), "global");
		writeSkill(join(project, ".agents", "skills", "local"), "local");

		expect(projectRootFor(nested)).toBe(project);
		const found = skillRoots({
			cwd: nested,
			agentsDir: agents,
			config: { projectRoots: [base], maxDepth: 6 },
		});
		expect(found).toHaveLength(2);
		expect(found.some((root) => root.endsWith("/local"))).toBe(false);
		expect(found.some((root) => root.endsWith(join(".git", "x")))).toBe(false);
		expect(found).toContain(join(agents, "skills"));
		expect(found).toContain(join(project, ".agents", "skills"));

		const result = syncSkillFlags({ roots: found });
		expect(result.changed.map((change) => change.name).sort()).toEqual(["global", "local"]);
	});

	test("watchTargets marks group and skill dirs without descending into a skill", () => {
		const base = temp();
		const skills = join(base, "skills");
		writeSkill(join(skills, "plain"), "plain");
		writeSkill(join(skills, "_manual", "manual"), "manual");

		const targets = watchTargets([skills]);
		expect(targets.get(skills)).toBe("group");
		expect(targets.get(join(skills, "plain"))).toBe("skill");
		expect(targets.get(join(skills, "_manual"))).toBe("group");
		expect(targets.get(join(skills, "_manual", "manual"))).toBe("skill");
	});

	test("listSkillFiles stops at the first SKILL.md per tree", () => {
		const base = temp();
		const skills = join(base, "skills");
		writeSkill(join(skills, "android", "nested"), "nested");
		const parent = writeSkill(join(skills, "android"), "android");
		expect(listSkillFiles(skills)).toEqual([parent]);
	});
});

describe("config", () => {
	test("defaults to ~/dev when the file is missing or broken", () => {
		const path = join(temp(), "missing.json");
		expect(readSkillFlagConfig(path)).toEqual({ projectRoots: [join(homedir(), "dev")], maxDepth: 2 });

		writeFileSync(path, "{not json");
		expect(readSkillFlagConfig(path).projectRoots).toEqual([join(homedir(), "dev")]);
	});

	test("expands ~ and keeps a configured depth", () => {
		const path = join(temp(), "skill-flags.json");
		writeFileSync(path, JSON.stringify({ projectRoots: ["~/code"], maxDepth: 3 }));
		expect(readSkillFlagConfig(path)).toEqual({ projectRoots: [join(homedir(), "code")], maxDepth: 3 });
	});

	test("formatSyncResult names what changed", () => {
		const quiet = formatSyncResult({ roots: ["/a"], scanned: 2, changed: [] });
		expect(quiet).toContain("2 scanned");
		const loud = formatSyncResult({ roots: ["/a"], scanned: 2, changed: [{ path: "/a/x/SKILL.md", name: "x" }] });
		expect(loud).toContain("hid x");
	});
});
