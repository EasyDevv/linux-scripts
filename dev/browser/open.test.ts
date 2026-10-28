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
