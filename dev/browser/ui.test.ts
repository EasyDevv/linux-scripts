import { expect, test } from "bun:test";

import { rowsFromProcs, serviceUnit } from "./list.ts";
import { classifyKey, renderHelp, splitKeys } from "./ui.ts";

test("splitKeys separates combined reads", () => {
	expect(splitKeys("j\r")).toEqual(["j", "\r"]);
	expect(splitKeys("\x1b[B\x1b[A\r")).toEqual(["\x1b[B", "\x1b[A", "\r"]);
	expect(splitKeys("\x1bOBx\x1b")).toEqual(["\x1bOB", "x", "\x1b"]);
	expect(splitKeys("\x1b[4~G")).toEqual(["\x1b[4~", "G"]);
});

test("classifyKey maps arrows, vim keys, and abort", () => {
	expect(classifyKey("j")).toBe("down");
	expect(classifyKey("\x1b[A")).toBe("up");
	expect(classifyKey("G")).toBe("last");
	expect(classifyKey("\r")).toBe("enter");
	expect(classifyKey("\x03")).toBe("abort");
	expect(classifyKey("x")).toEqual({ char: "x" });
	expect(classifyKey("\x1b[Z")).toBeNull();
});

test("renderHelp is plain without color and paints with it", () => {
	const help = "browser x — y\n\nUsage\n  browser x --a <b>   desc (default: 1)";
	expect(renderHelp(help, false)).toBe(help);
	const painted = renderHelp(help, true);
	expect(painted).toContain("\x1b[");
	expect(painted.replace(/\x1b\[[0-9;]*m/g, "")).toBe(help);
});

test("serviceUnit picks .service leaves only", () => {
	expect(serviceUnit("0::/user.slice/user-1000.slice/user@1000.service/app.slice/chrome.service\n")).toBe("chrome.service");
	expect(serviceUnit("0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-x-1.scope")).toBeNull();
	expect(serviceUnit("0::/user.slice/user-1000.slice/user@1000.service")).toBeNull();
});

test("rowsFromProcs: one chromium row per port, unit from children, obscura engines", () => {
	const cg = (leaf: string) => `0::/user.slice/user@1000.service/app.slice/${leaf}`;
	const rows = rowsFromProcs([
		{ pid: 1, argv: ["/usr/bin/chrome", "--remote-debugging-port=9201", "--user-data-dir=/p"], cgroup: cg("app-chrome-1.scope"), cwd: "/" },
		{ pid: 2, argv: ["/usr/bin/chrome", "--type=renderer", "--remote-debugging-port=9201"], cgroup: cg("chrome.service"), cwd: "/" },
		{ pid: 3, argv: ["chromium", "--remote-debugging-port=9223", "--user-data-dir=/tmp/browser-clean-ab"], cgroup: cg("app-x.scope"), cwd: "/" },
		{ pid: 4, argv: ["/home/u/.local/bin/obscura", "serve", "--stealth", "--port", "9300", "--storage-dir", "/s/9222"], cgroup: cg("app-y.scope"), cwd: "/" },
		{ pid: 5, argv: ["obscura", "fetch", "https://a.com", "--stealth"], cgroup: "", cwd: "/" },
		{ pid: 6, argv: ["obscura-worker"], cgroup: "", cwd: "/" },
	]);
	expect(rows.map((r) => [r.engine, r.port, r.unit, r.kind, r.note])).toEqual([
		["chromium", 9201, "chrome.service", "/p", null],
		["chromium", 9223, null, "clean profile", null],
		["obscura", 9300, null, "serve", "session 9222"],
		["obscura", null, null, "fetch", "https://a.com"],
	]);
});
