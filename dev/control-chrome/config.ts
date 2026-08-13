export const DEFAULT_BINARY = "chromium";
export const DEFAULT_PORT = 9222;

export const BROWSER_DEFAULTS = Object.freeze({
	port: DEFAULT_PORT,
	url: "about:blank",
	windowSize: Object.freeze({ width: 1440, height: 900 }) as {
		readonly width: 1440;
		readonly height: 900;
	},
	remoteDebuggingAddress: "127.0.0.1",
	chromeFlags: Object.freeze([
		"--no-first-run",
		"--no-default-browser-check",
		"--force-device-scale-factor=1",
	]),
});

export const LOCK_DEFAULTS = Object.freeze({
	idleTimeoutMs: 60_000,
});

export function buildChromeLaunchArgs(opts: {
	port: number;
	userDataDir: string;
	url: string;
	headless: boolean;
	startMinimized?: boolean;
	extraArgs?: string[];
}): string[] {
	const flags: string[] = [
		`--remote-debugging-port=${opts.port}`,
		`--remote-debugging-address=${BROWSER_DEFAULTS.remoteDebuggingAddress}`,
		...BROWSER_DEFAULTS.chromeFlags,
		`--user-data-dir=${opts.userDataDir}`,
		`--window-size=${BROWSER_DEFAULTS.windowSize.width},${BROWSER_DEFAULTS.windowSize.height}`,
		...(opts.extraArgs ?? []),
	];

	if (opts.headless) flags.push("--headless=new");
	if (opts.startMinimized) flags.push("--start-minimized");

	flags.push(opts.url);
	return flags;
}
