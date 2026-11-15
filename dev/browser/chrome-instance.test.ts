import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import {
	chromeDebugPortForProfile,
	chromeUserDataDirFromArgs,
	ensureUserDataGitignored,
	projectRootForUserDataDir,
	resolveDefaultProfileDir,
	resolveProjectProfileDir,
} from "./chrome-instance.ts";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

test("uses the package name for the project-local default profile", async () => {
	const root = await mkdtemp("/tmp/browser-profile-");
	tempRoots.push(root);
	await Bun.write(join(root, "package.json"), '{"name":"property-portal"}\n');

	expect(resolveProjectProfileDir(root)).toBe(
		join(root, ".user-data", "chrome-property-portal"),
	);
});

test("uses the project directory name when package.json has no name", async () => {
	const root = await mkdtemp("/tmp/browser-profile-");
	tempRoots.push(root);
	await Bun.write(join(root, "package.json"), "{}\n");

	expect(resolveProjectProfileDir(root)).toBe(
		join(root, ".user-data", `chrome-${basename(root)}`),
	);
});

test("matches a relative Chromium profile path against its absolute project path", () => {
	const projectRoot = "/home/example/project";
	expect(
		chromeDebugPortForProfile(
			[
				"/usr/bin/chromium",
				"--remote-debugging-port=9223",
				"--user-data-dir=./.user-data/chrome-project",
			],
			projectRoot,
			join(projectRoot, ".user-data", "chrome-project"),
		),
	).toBe(9223);
});

test("matches Chromium when it rewrites its process title into one argument", () => {
	const projectRoot = "/home/example/project";
	expect(
		chromeDebugPortForProfile(
			[
				"/usr/bin/chromium --remote-debugging-port=9223 --user-data-dir=./.user-data/chrome-project http://localhost:5173",
			],
			projectRoot,
			join(projectRoot, ".user-data", "chrome-project"),
		),
	).toBe(9223);
});

test("extracts a profile path without a debug port", () => {
	const projectRoot = "/tmp/project";
	expect(
		chromeUserDataDirFromArgs(
			[
				"/opt/brave-origin-bin/brave",
				"--user-data-dir=.user-data/chrome-project",
			],
			projectRoot,
		),
	).toBe(join(projectRoot, ".user-data", "chrome-project"));
});

test("default port 9222 uses the global profile, other ports stay project-local", () => {
	const root = "/tmp/some-project";
	expect(resolveDefaultProfileDir(9222, root)).toBe(
		join(homedir(), ".cache", "browser", "profiles", "9222"),
	);
	expect(resolveDefaultProfileDir(39225, root)).toBe(
		join(root, ".user-data", "chrome-some-project"),
	);
});

test("adds /.user-data/ to the project .gitignore once, creating it when missing", async () => {
	const root = await mkdtemp("/tmp/browser-gitignore-");
	tempRoots.push(root);
	await mkdir(join(root, ".git"));
	const profile = join(root, ".user-data", "chrome-project");

	expect(await ensureUserDataGitignored(profile)).toBe(true);
	expect(await readFile(join(root, ".gitignore"), "utf-8")).toBe(
		"/.user-data/\n",
	);
	expect(await ensureUserDataGitignored(profile)).toBe(false);
	expect(await readFile(join(root, ".gitignore"), "utf-8")).toBe(
		"/.user-data/\n",
	);
});

test("appends after content without a trailing newline and skips existing variants", async () => {
	const root = await mkdtemp("/tmp/browser-gitignore-");
	tempRoots.push(root);
	await mkdir(join(root, ".git"));
	await writeFile(join(root, ".gitignore"), "node_modules/");
	const profile = join(root, ".user-data", "chrome-project");

	expect(await ensureUserDataGitignored(profile)).toBe(true);
	expect(await readFile(join(root, ".gitignore"), "utf-8")).toBe(
		"node_modules/\n/.user-data/\n",
	);

	const variant = await mkdtemp("/tmp/browser-gitignore-");
	tempRoots.push(variant);
	await mkdir(join(variant, ".git"));
	await writeFile(join(variant, ".gitignore"), ".user-data/\n");
	expect(
			await ensureUserDataGitignored(
				join(variant, ".user-data", "chrome-project"),
			),
		).toBe(false);
	expect(await readFile(join(variant, ".gitignore"), "utf-8")).toBe(
		".user-data/\n",
	);
});

test("does not touch .gitignore outside a git repo or for global profiles", async () => {
	const root = await mkdtemp("/tmp/browser-gitignore-");
	tempRoots.push(root);
	const profile = join(root, ".user-data", "chrome-project");

	expect(projectRootForUserDataDir(profile)).toBe(root);
	expect(await ensureUserDataGitignored(profile)).toBe(false);
	expect(projectRootForUserDataDir("/tmp/browser-clean-abc")).toBeNull();
	expect(await ensureUserDataGitignored("/tmp/browser-clean-abc")).toBe(
		false,
	);
});
