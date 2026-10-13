import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import {
	chromeDebugPortForProfile,
	chromeUserDataDirFromArgs,
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
	const root = await mkdtemp("/tmp/control-chrome-profile-");
	tempRoots.push(root);
	await Bun.write(join(root, "package.json"), '{"name":"property-portal"}\n');

	expect(resolveProjectProfileDir(root)).toBe(
		join(root, ".user-data", "chrome-property-portal"),
	);
});

test("uses the project directory name when package.json has no name", async () => {
	const root = await mkdtemp("/tmp/control-chrome-profile-");
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
		join(homedir(), ".cache", "chrome-debug-profile", "9222"),
	);
	expect(resolveDefaultProfileDir(39225, root)).toBe(
		join(root, ".user-data", "chrome-some-project"),
	);
});
