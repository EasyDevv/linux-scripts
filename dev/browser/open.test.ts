import { afterEach, expect, test } from "bun:test";

import { androidLaunchArgs, parseArgs } from "./open.ts";

const realExit = process.exit;

afterEach(() => {
	process.exit = realExit;
});

/** parseArgs reports a bad flag through die(), which exits. */
function captureExit(run: () => void): { code: number; message: string } {
	let code: number | undefined;
	let message = "";
	const realError = console.error;
	process.exit = ((value?: number) => {
		code = value ?? 0;
		throw new Error("exit");
	}) as never;
	console.error = (text: string) => {
		message = text;
	};
	try {
		run();
	} catch {
		// die() threw out of the stubbed exit.
	} finally {
		console.error = realError;
	}
	if (code === undefined) throw new Error("parseArgs did not exit");
	return { code, message };
}

test("android and record are off by default", () => {
	const options = parseArgs([]);
	expect(options.android).toBe(false);
	expect(options.record).toBe(false);
	expect(options.recordFrames).toBeNull();
});

test("open parks the window in the background by default so it does not steal the desktop", () => {
	const options = parseArgs([]);
	expect(options.minimize).toBe(true);
	expect(options.park).toBe(true);
});

test("--minimize, --background and --normal pick the window mode", () => {
	expect(parseArgs(["--minimize"])).toMatchObject({ minimize: true, park: false });
	expect(parseArgs(["--background"])).toMatchObject({ minimize: true, park: true });
	expect(parseArgs(["--normal"])).toMatchObject({ minimize: false, park: false });
	expect(parseArgs(["--no-minimize"])).toMatchObject({ minimize: false, park: false });
	expect(parseArgs(["--minimize", "--background"])).toMatchObject({ park: true });
});


test("--normal never turns the taskbar flash on, and the flash is opt-in", () => {
	expect(parseArgs([]).flash).toBe(false);
	expect(parseArgs(["--normal"]).flash).toBe(false);
	expect(parseArgs(["--normal"]).minimize).toBe(false);
	expect(parseArgs(["--flash"]).flash).toBe(true);
	expect(parseArgs(["--flash"]).minimize).toBe(true);
});

test("--android turns on phone emulation", () => {
	expect(parseArgs(["--android"]).android).toBe(true);
});

test("--record without a count records until close", () => {
	const options = parseArgs(["--record"]);
	expect(options.record).toBe(true);
	expect(options.recordFrames).toBeNull();
});

test("--record N captures N frames", () => {
	const options = parseArgs(["--record", "12"]);
	expect(options.record).toBe(true);
	expect(options.recordFrames).toBe(12);
});

test("--record does not swallow the next flag", () => {
	const options = parseArgs(["--record", "--port", "9233"]);
	expect(options.recordFrames).toBeNull();
	expect(options.port).toBe(9233);
});

test("--record rejects a count that is not positive", () => {
	const zero = captureExit(() => parseArgs(["--record", "0"]));
	expect(zero.code).toBe(1);
	expect(zero.message).toContain("Usage: --record [N]");

	const text = captureExit(() => parseArgs(["--record", "many"]));
	expect(text.code).toBe(1);
});

test("android launch flags carry the mobile user agent and touch", () => {
	const [userAgent, touch] = androidLaunchArgs(true);
	expect(userAgent).toStartWith("--user-agent=Mozilla/5.0 (Linux; Android 15");
	expect(userAgent).toContain("Mobile Safari/537.36");
	expect(touch).toBe("--touch-events=enabled");
	expect(androidLaunchArgs(false)).toEqual([]);
});

test("--load-timeout takes seconds; 0 skips the page check", () => {
	expect(parseArgs([]).loadTimeoutMs).toBe(15_000);
	expect(parseArgs(["--load-timeout", "0"]).loadTimeoutMs).toBe(0);
	expect(parseArgs(["--load-timeout", "2.5"]).loadTimeoutMs).toBe(2500);
	expect(captureExit(() => parseArgs(["--load-timeout", "x"])).code).not.toBe(0);
});

test("a clean open never attaches to a browser already on the port", async () => {
	const { ownsBrowserOn } = await import("./open.ts");
	expect(await ownsBrowserOn(9222, { clean: true, userDataDir: undefined })).toBe(false);
});

test("a profile whose SingletonLock names a live pid is reported as held", async () => {
	const { profileHolderPid } = await import("./open.ts");
	const { mkdtempSync, symlinkSync, rmSync } = await import("node:fs");
	const { join } = await import("node:path");
	const { tmpdir } = await import("node:os");
	const live = mkdtempSync(join(tmpdir(), "holder-"));
	symlinkSync(`host-${process.pid}`, join(live, "SingletonLock"));
	expect(profileHolderPid(live)).toBe(process.pid);
	const dead = mkdtempSync(join(tmpdir(), "holder-"));
	symlinkSync("host-999999999", join(dead, "SingletonLock"));
	expect(profileHolderPid(dead)).toBeNull();
	expect(profileHolderPid(join(tmpdir(), "no-such-profile"))).toBeNull();
	rmSync(live, { recursive: true });
	rmSync(dead, { recursive: true });
});

test("script runs only keep the extension they load", async () => {
	const { extensionArgs } = await import("./open.ts");
	expect(extensionArgs({ loadExtension: undefined, keepExtensions: false })).toEqual([
		"--disable-extensions",
	]);
	expect(extensionArgs({ loadExtension: "/x", keepExtensions: false })).toEqual([
		"--load-extension=/x",
		"--disable-extensions-except=/x",
	]);
});

test("--keep-extensions leaves the profile's extensions alone", async () => {
	const { extensionArgs } = await import("./open.ts");
	expect(extensionArgs({ loadExtension: undefined, keepExtensions: true })).toEqual([]);
	expect(extensionArgs({ loadExtension: "/x", keepExtensions: true })).toEqual([
		"--load-extension=/x",
	]);
});
