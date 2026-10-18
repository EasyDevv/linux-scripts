import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { matchesGlob, mentionedPaths } from "./path-trigger.ts";

describe("mentionedPaths", () => {
	test("paths in prose, with Korean particles, backticks, and touched files", () => {
		const got = mentionedPaths("`docs/plan`에 쓰고 src/app.ts, README.md를 봐. 1.34 s 걸림", "/repo", "/repo", [
			"/repo/apps/x.svelte",
			"/elsewhere/y.ts",
		]);
		expect(got.sort()).toEqual(["README.md", "apps/x.svelte", "docs/plan", "src/app.ts"]);
	});

	test("cwd-relative and ~ paths resolve; URLs and outside paths drop", () => {
		const root = `${homedir()}/proj`;
		expect(mentionedPaths("see ./lib/a.ts and ~/proj/b.md", root, `${root}/pkg`)).toEqual(["pkg/lib/a.ts", "b.md"]);
		expect(mentionedPaths("open https://x.dev/docs/a.md", "/repo")).toEqual([]);
	});
});

describe("matchesGlob", () => {
	test("files match the glob; a directory matches a glob rooted at or above it", () => {
		expect(matchesGlob("docs/**/*.md", "docs/plan/a.md")).toBe(true);
		expect(matchesGlob("docs/**/*.md", "docs/plan")).toBe(true);
		expect(matchesGlob("docs/**/*.md", "docs/plan/a.ts")).toBe(false);
		expect(matchesGlob("docs/**/*.md", "src")).toBe(false);
		expect(matchesGlob("**/*.svelte", "src")).toBe(false);
		expect(matchesGlob("**/*.{ts,svelte}", "src/a.svelte")).toBe(true);
	});
});
