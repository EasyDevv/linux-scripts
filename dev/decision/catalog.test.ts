import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CatalogReader, parseFrontmatter, projectRoot } from "./catalog.ts";

const roots: string[] = [];
function temp(): string {
	const dir = mkdtempSync(join(tmpdir(), "decision-catalog-"));
	roots.push(dir);
	return dir;
}
afterAll(() => {
	for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function write(path: string, text: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, text);
}

describe("parseFrontmatter", () => {
	test("plain, quoted, folded and list values", () => {
		const { meta, body } = parseFrontmatter(
			[
				"---",
				"name: demo",
				'description: "Quoted: with a colon, and \\"escapes\\"."',
				"folded: >",
				"  first line",
				"  second line",
				"skills: [a, 'b', c]",
				"---",
				"",
				"# Title",
			].join("\n"),
		);
		expect(meta.name).toBe("demo");
		expect(meta.description).toBe('Quoted: with a colon, and "escapes".');
		expect(meta.folded).toBe("first line second line");
		expect(meta.skills).toEqual(["a", "b", "c"]);
		expect(body).toBe("# Title");
	});

	test("an unquoted colon in a description still reads, and bullet lists work", () => {
		const { meta } = parseFrontmatter(
			["---", "description: Use when: a thing happens", "skills:", "  - x", "  - y", "---", "body"].join("\n"),
		);
		expect(meta.description).toBe("Use when: a thing happens");
		expect(meta.skills).toEqual(["x", "y"]);
	});

	test("no frontmatter leaves the body whole", () => {
		expect(parseFrontmatter("# Only body\n- a")).toEqual({ meta: {}, body: "# Only body\n- a" });
	});
});

describe("projectRoot", () => {
	test("nearest ancestor with .git, else cwd", () => {
		const exists = (p: string) => p === "/work/app/.git";
		expect(projectRoot("/work/app/src/deep", exists)).toBe("/work/app");
		expect(projectRoot("/elsewhere/dir", exists)).toBe("/elsewhere/dir");
	});
});

describe("CatalogReader", () => {
	test("reads global and project routed skills and rules; manual skills and dotdirs are skipped", () => {
		const home = temp();
		const repo = temp();
		mkdirSync(join(repo, ".git"));
		write(join(home, ".agents/skills-routed/alpha/SKILL.md"), "---\nname: alpha\ndescription: Does alpha.\n---\n# Alpha");
		write(join(home, ".agents/skills/manual/SKILL.md"), "---\nname: manual\ndescription: no\n---\n");
		write(join(home, ".agents/skills-routed/.cache/SKILL.md"), "---\nname: cache\ndescription: no\n---\n");
		write(join(home, ".agents/skills-routed/nodesc/SKILL.md"), "---\nname: nodesc\n---\n");
		write(
			join(home, ".agents/rules-routed/style.md"),
			"---\ndescription: Code style work.\nskills: [alpha]\n---\n\n# Style\n\n- tabs",
		);
		write(join(repo, ".agents/skills-routed/beta/SKILL.md"), "---\ndescription: Does beta.\n---\n");
		write(join(repo, ".agents/rules-routed/local.md"), "---\ndescription: Local work.\n---\n# Local\n- x");
		const entries = new CatalogReader(home).read(join(repo, "src"));
		expect(entries.map((e) => `${e.kind}:${e.name}:${e.scope}`).sort()).toEqual([
			"rule:local:project",
			"rule:style:global",
			"skill:alpha:global",
			"skill:beta:project",
		]);
		const style = entries.find((e) => e.name === "style");
		expect(style?.skills).toEqual(["alpha"]);
		expect(style?.body).toBe("# Style\n\n- tabs");
		expect(style?.path).toBe(join(home, ".agents/rules-routed/style.md"));
		expect(entries.find((e) => e.name === "beta")?.description).toBe("Does beta.");
	});

	test("a project entry replaces the global one of the same name", () => {
		const home = temp();
		const repo = temp();
		mkdirSync(join(repo, ".git"));
		write(join(home, ".agents/rules-routed/same.md"), "---\ndescription: global\n---\n# G");
		write(join(repo, ".agents/rules-routed/same.md"), "---\ndescription: project\n---\n# P");
		const [only, ...rest] = new CatalogReader(home).read(repo);
		expect(rest).toEqual([]);
		expect(only).toMatchObject({ scope: "project", description: "project" });
	});

	test("a rule without a description is described by its title and first bullet", () => {
		const home = temp();
		write(join(home, ".agents/rules-routed/bare.md"), "# Bare rule\n\n- Do the `thing` first.\n");
		const [rule] = new CatalogReader(home).read();
		expect(rule?.description).toBe("Bare rule. Do the thing first.");
	});

	test("edits, additions and deletions show on the next read", () => {
		const home = temp();
		const file = join(home, ".agents/rules-routed/live.md");
		write(file, "---\ndescription: one\n---\n# A\n- a");
		const reader = new CatalogReader(home);
		expect(reader.read()[0]?.description).toBe("one");
		write(file, "---\ndescription: two, longer\n---\n# A\n- a");
		utimesSync(file, new Date(), new Date(Date.now() + 5_000));
		expect(reader.read()[0]?.description).toBe("two, longer");
		write(join(home, ".agents/skills-routed/new/SKILL.md"), "---\ndescription: new skill\n---\n");
		expect(reader.read().map((e) => e.name)).toEqual(["new", "live"]);
		rmSync(file);
		expect(reader.read().map((e) => e.name)).toEqual(["new"]);
	});

	test("a cwd that is the home itself does not double-read the global catalog", () => {
		const home = temp();
		mkdirSync(join(home, ".git"));
		write(join(home, ".agents/skills-routed/solo/SKILL.md"), "---\ndescription: solo\n---\n");
		const entries = new CatalogReader(home).read(home);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.scope).toBe("global");
	});
});
