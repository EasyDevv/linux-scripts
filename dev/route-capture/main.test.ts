import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import {
	createExclusiveRunner,
	discoverSvelteKitRoutes,
	ensureGeneratedPathsIgnored,
	extractInternalLinks,
	routeFromSvelteKitSourcePath,
	screenshotFileName,
} from "./main.ts";

let tmpRoot = "";

beforeEach(async () => {
	tmpRoot = await mkdtemp("/tmp/route-capture-test-");
});

afterEach(async () => {
	await rm(tmpRoot, { recursive: true, force: true });
});

test("converts SvelteKit route groups and dynamic segments", () => {
	expect(
		routeFromSvelteKitSourcePath(
			"apps/client/src/routes/(protected)/admin/users/+page.svelte",
		),
	).toMatchObject({ path: "/admin/users", dynamic: false });
	expect(
		routeFromSvelteKitSourcePath(
			"apps/client/src/routes/(protected)/property/[dataId]/+page.svelte",
		),
	).toMatchObject({ path: "/property/:dataId", dynamic: true });
	expect(routeFromSvelteKitSourcePath("src/routes/+layout.svelte")).toBeNull();
});

test("discovers static and dynamic routes across an app workspace", async () => {
	const routeRoot = join(tmpRoot, "apps", "client", "src", "routes");
	await mkdir(join(routeRoot, "(protected)", "property", "[id]"), {
		recursive: true,
	});
	await mkdir(join(routeRoot, "(protected)", "settings"), {
		recursive: true,
	});
	await Bun.write(join(routeRoot, "+page.svelte"), "");
	await Bun.write(
		join(routeRoot, "(protected)", "settings", "+page.svelte"),
		"",
	);
	await Bun.write(
		join(routeRoot, "(protected)", "property", "[id]", "+page.svelte"),
		"",
	);
	await Bun.write(join(routeRoot, "(protected)", "settings", "+page.ts"), "");

	const routes = await discoverSvelteKitRoutes(tmpRoot);
	expect(routes.map((route) => [route.path, route.dynamic])).toEqual([
		["/", false],
		["/property/:id", true],
		["/settings", false],
	]);
});

test("ignores generated captures and project Chrome profiles once", async () => {
	await Bun.write(join(tmpRoot, ".gitignore"), "node_modules/\n");
	expect(await ensureGeneratedPathsIgnored(tmpRoot)).toBe(true);
	expect(await ensureGeneratedPathsIgnored(tmpRoot)).toBe(false);

	const contents = await Bun.file(join(tmpRoot, ".gitignore")).text();
	expect(contents).toContain("/.capture/");
	expect(contents).toContain("/.user-data/");
	expect(contents.match(/\.capture\//g)).toHaveLength(1);
});

test("keeps only same-origin page links within the application base path", () => {
	expect(
		extractInternalLinks(
			[
				"/portal/settings#section",
				"/portal/property/abc",
				"/api/health",
				"https://example.test/other",
				"mailto:team@example.test",
			],
			"http://localhost:5173/portal/property",
			"http://localhost:5173/portal/",
		),
	).toEqual([
		"http://localhost:5173/portal/property/abc",
		"http://localhost:5173/portal/settings",
	]);
});

test("uses readable, query-safe screenshot filenames", () => {
	expect(screenshotFileName("http://localhost:5173/")).toBe("index.png");
	expect(screenshotFileName("http://localhost:5173/admin/users")).toBe(
		"admin--users.png",
	);
	expect(
		screenshotFileName("http://localhost:5173/property?view=grid"),
	).toMatch(/^property--[a-z0-9]+\.png$/);
});

test("runs capture work exclusively and releases the queue after failure", async () => {
	const runExclusive = createExclusiveRunner();
	let active = 0;
	let maxActive = 0;
	const enter = () => {
		active++;
		maxActive = Math.max(maxActive, active);
	};

	const first = runExclusive(async () => {
		enter();
		await Bun.sleep(10);
		active--;
		throw new Error("expected failure");
	}).catch((error) => error);
	const second = runExclusive(async () => {
		enter();
		active--;
		return "completed";
	});

	expect(await first).toBeInstanceOf(Error);
	expect(await second).toBe("completed");
	expect(maxActive).toBe(1);
});
