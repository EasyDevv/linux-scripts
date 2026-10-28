import { expect, test } from "bun:test";

import {
	backgroundScriptSource,
	guardPluginName,
	keepMinimizedScriptSource,
	unparkScriptSource,
} from "./kwin.ts";

test("the guard is named per window class so close and show can unload it", () => {
	expect(guardPluginName("cdp-9222")).toBe("browser-guard-cdp-9222");
	expect(guardPluginName("cdp-9223")).not.toBe(guardPluginName("cdp-9222"));
});

const sources = {
	minimize: keepMinimizedScriptSource,
	background: backgroundScriptSource,
};

for (const [mode, build] of Object.entries(sources)) {
	test(`${mode} guard matches only its own window class`, () => {
		const source = build("cdp-9222");
		expect(source).toContain('const cls = "cdp-9222";');
		expect(source).toContain("String(w");
		expect(source).not.toContain("cdp-9223");
	});

	test(`${mode} guard stays loaded: it never unloads itself`, () => {
		expect(build("cdp-9222")).not.toContain("unloadScript");
	});

	test(`${mode} guard: a class name cannot break out of the script source`, () => {
		const source = build('x"; evil(); "');
		expect(source).toContain(JSON.stringify('x"; evil(); "'));
		expect(source).not.toContain('"x"; evil()');
	});

	test(`${mode} guard also catches windows opened later`, () => {
		expect(build("cdp-9222")).toContain("workspace.windowAdded.connect");
		expect(build("cdp-9222")).toContain("workspace.stackingOrder");
	});
}

test("the minimize guard minimizes a window again whenever it is restored", () => {
	const source = keepMinimizedScriptSource("cdp-9222");
	expect(source).toContain("window.minimizedChanged.connect");
	expect(source).toContain("if (!window.minimized) window.minimized = true;");
});

test("the background guard sinks the window below all others and out of the switcher, without moving it", () => {
	const source = backgroundScriptSource("cdp-9222");
	for (const flag of ["keepBelow", "skipTaskbar", "skipSwitcher", "skipPager"]) {
		expect(source).toContain(`w.${flag} = true;`);
	}
	expect(source).toContain("w.keepBelowChanged.connect");
	expect(source).not.toContain("frameGeometry");
	expect(source).not.toContain("minimized = true");
});

test("the background guard hands focus back to the window the user was in", () => {
	const source = backgroundScriptSource("cdp-9222");
	expect(source).toContain("workspace.windowActivated.connect");
	expect(source).toContain("workspace.activeWindow = prev;");
	expect(source).toContain("workspace.windowRemoved.connect");
});

test("unpark restores the flags, brings an off-screen window back and unloads itself", () => {
	const source = unparkScriptSource("cdp-9222", "browser-unpark-x", false);
	for (const flag of ["keepBelow", "skipTaskbar", "skipSwitcher", "skipPager"]) {
		expect(source).toContain(`w.${flag} = false;`);
	}
	expect(source).toContain("w.frameGeometry.x >= edge");
	expect(source).toContain('"browser-unpark-x"');
	expect(source).not.toContain("workspace.activeWindow = w;");
	expect(unparkScriptSource("cdp-9222", "n", true)).toContain("workspace.activeWindow = w;");
});
