import { releaseWindowGuard, unparkWindows } from "./kwin.ts";
import { restoreWindow } from "./minimize.ts";
import { portClass } from "./port-identity.ts";

export async function main(argv: string[]): Promise<void> {
	const at = argv.indexOf("--port");
	const port = at >= 0 ? +(argv[at + 1] ?? 0) : +(argv.find((arg) => /^\d+$/.test(arg)) ?? 0);
	if (!port) {
		console.error("Usage: browser show --port <port>");
		process.exit(1);
	}
	// The guard would park or minimize the window again at once; drop it first.
	const className = portClass(port);
	await releaseWindowGuard(className);
	await unparkWindows(className, true);
	const ok = await restoreWindow(port);
	console.log(ok ? `Window shown (port ${port})` : `✗ could not show the window (port ${port})`);
	process.exit(ok ? 0 : 1);
}
