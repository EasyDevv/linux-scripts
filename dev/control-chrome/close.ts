import { rm } from "node:fs/promises";

import {
	browserReachable,
	clearPortLock,
	resolvePortState,
} from "./browser-state.ts";
import { acceptPageDialogs, CDP, getBrowserWsUrl } from "./cdp.ts";
import {
	clearLaunchInfo,
	processExists,
	processMatchesLaunchInfo,
	processUsesUserDataDir,
	readLaunchInfo,
	resolveProjectProfileDir,
	terminateProcess,
} from "./chrome-instance.ts";
import { DEFAULT_PORT } from "./config.ts";

const PROFILE_FLUSH_GRACE_MS = 300;

export type CloseOptions = {
	port: number;
	userDataDir?: string;
	pid?: number;
	timeout: number;
	json: boolean;
};

const HELP = `control-chrome close — Stop Chromium launched by control-chrome open

Usage: control-chrome close [options]

Options:
  --port <N>            Remote debugging port (default: 9222)
  --user-data <dir>     Chrome profile dir (default: ./.user-data/chrome-{name})
  --pid <N>             Explicit PID override
  --timeout <ms>        Grace period before SIGKILL (default: 5000)
  --json                Print JSON output
  --help                Show this help`;

function die(msg: string): never {
	console.error(`✗ ${msg}`);
	process.exit(1);
}

function parseArgs(argv: string[]): CloseOptions {
	const options: CloseOptions = {
		port: DEFAULT_PORT,
		timeout: 5000,
		json: false,
	};

	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--port":
				options.port = +(argv[++i] ?? die("Usage: --port <N>"));
				break;
			case "--user-data":
				options.userDataDir = argv[++i] ?? die("Usage: --user-data <dir>");
				break;
			case "--pid":
				options.pid = +(argv[++i] ?? die("Usage: --pid <N>"));
				break;
			case "--timeout":
				options.timeout = +(argv[++i] ?? die("Usage: --timeout <ms>"));
				break;
			case "--json":
				options.json = true;
				break;
			case "--help":
				console.log(HELP);
				process.exit(0);
			default:
				die(`Unknown option: ${argv[i]}`);
		}
	}

	if (!Number.isInteger(options.port) || options.port <= 0)
		die("Port must be a positive integer");
	if (
		options.pid !== undefined &&
		(!Number.isInteger(options.pid) || options.pid <= 0)
	)
		die("PID must be a positive integer");
	if (!Number.isInteger(options.timeout) || options.timeout < 0)
		die("Timeout must be a non-negative integer");
	return options;
}

function renderOutput(output: Record<string, unknown>, json = false) {
	if (json) {
		console.log(JSON.stringify(output, null, 2));
		return;
	}

	const headline =
		typeof output.headline === "string"
			? output.headline
			: output.status === "released-lock"
				? "released browser lock"
				: output.status === "already-exited"
					? `Chrome already exited (pid ${output.pid})`
					: `stopped Chrome pid ${output.pid}`;
	console.log(`✓ ${headline}`);
	console.log(`  port: ${output.port}`);
	console.log(`  profile: ${output.userDataDir}`);
	if (output.pid) console.log(`  pid: ${output.pid}`);
	if (output.signal) console.log(`  signal: ${output.signal}`);
	if (output.note) console.log(`  note: ${output.note}`);
}

async function waitForProcessExit(pid: number, timeoutMs: number) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!processExists(pid)) return true;
		await Bun.sleep(100);
	}
	return !processExists(pid);
}

async function waitForBrowserClose(port: number, timeoutMs: number) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!(await browserReachable(port))) return true;
		await Bun.sleep(100);
	}
	return !(await browserReachable(port));
}

async function closeBrowserPortGracefully(port: number, timeoutMs: number) {
	const wsUrl = await getBrowserWsUrl(port);
	if (!wsUrl) return false;

	const cdp = await CDP.connect(wsUrl);
	try {
		await acceptPageDialogs(port);
		await cdp.send("Browser.close");
	} finally {
		cdp.close();
	}

	return await waitForBrowserClose(port, timeoutMs);
}

async function closeBrowserGracefully(
	port: number,
	pid: number,
	timeoutMs: number,
) {
	const wsUrl = await getBrowserWsUrl(port);
	if (!wsUrl) return false;

	const cdp = await CDP.connect(wsUrl);
	try {
		await acceptPageDialogs(port);
		await cdp.send("Browser.close");
	} finally {
		cdp.close();
	}

	return await waitForProcessExit(pid, timeoutMs);
}

export async function main(argv: string[]): Promise<void> {
	const options = parseArgs(argv);
	const userDataDir = options.userDataDir ?? resolveProjectProfileDir();
	const launchInfo =
		options.pid !== undefined
			? { pid: options.pid, port: options.port, userDataDir }
			: await readLaunchInfo(userDataDir);

	const requestedPortState = await resolvePortState(options.port);
	const launchInfoMatchesRequestedPort =
		launchInfo?.port === options.port ||
		(launchInfo as { requestedPort?: number } | null)?.requestedPort ===
			options.port;

	if (
		options.pid === undefined &&
		requestedPortState.browserReachable &&
		!launchInfoMatchesRequestedPort
	) {
		await Bun.sleep(PROFILE_FLUSH_GRACE_MS);
		const closed = await closeBrowserPortGracefully(
			options.port,
			options.timeout,
		);
		await clearLaunchInfo(userDataDir);
		await clearPortLock(options.port);

		renderOutput(
			{
				status: closed ? "terminated" : "released-lock",
				port: options.port,
				userDataDir,
				browserAction: closed
					? "closed-browser-by-port"
					: "cleared-stale-browser-lock",
				note: closed
					? "Closed the browser reachable on the requested debugging port because recorded launch metadata did not match that port."
					: "Recorded launch metadata did not match the requested port, and the browser did not close via CDP before timeout.",
			},
			options.json,
		);
		return;
	}

	if (!launchInfo?.pid) {
		const portState = requestedPortState;
		if (portState.lock || portState.browserReachable) {
			if (portState.browserReachable) {
				await Bun.sleep(PROFILE_FLUSH_GRACE_MS);
				const closed = await closeBrowserPortGracefully(
					options.port,
					options.timeout,
				);
				await clearLaunchInfo(userDataDir);
				await clearPortLock(options.port);

				renderOutput(
					{
						status: closed ? "terminated" : "released-lock",
						port: options.port,
						userDataDir,
						browserAction: closed
							? "closed-browser-by-port"
							: "cleared-browser-lock",
						note: closed
							? "Closed the browser reachable on the requested debugging port."
							: "The browser reachable on the requested debugging port did not close via CDP before timeout.",
					},
					options.json,
				);
				return;
			}

			await clearLaunchInfo(userDataDir);
			await clearPortLock(options.port);
			renderOutput(
				{
					status: "released-lock",
					port: options.port,
					userDataDir,
					browserAction: "cleared-stale-browser-lock",
					note: "Only stale metadata was present, so it was cleared.",
				},
				options.json,
			);
			return;
		}

		die(
			`No recorded Chrome PID for profile ${userDataDir}. Launch with: control-chrome open --port ${options.port}`,
		);
	}

	if (processExists(launchInfo.pid)) {
		if (options.pid !== undefined) {
			const usesProfile = await processUsesUserDataDir(
				launchInfo.pid,
				userDataDir,
			);
			if (usesProfile === false) {
				die(`PID ${launchInfo.pid} is not using profile ${userDataDir}`);
			}
		} else {
			const matches = await processMatchesLaunchInfo(launchInfo);
			if (matches === false) {
				await clearLaunchInfo(userDataDir);
				await clearPortLock(options.port);
				die(
					`Recorded PID ${launchInfo.pid} no longer matches profile ${userDataDir}; cleared stale metadata.`,
				);
			}
		}
	}

	let result;
	try {
		// Give extension/background timers a brief window to flush throttled
		// profile writes before shutdown starts.
		await Bun.sleep(PROFILE_FLUSH_GRACE_MS);

		const exited = await closeBrowserGracefully(
			launchInfo.port,
			launchInfo.pid,
			options.timeout,
		);
		result = exited
			? { status: "terminated" as const }
			: await terminateProcess(launchInfo.pid, options.timeout);
	} catch {
		result = await terminateProcess(launchInfo.pid, options.timeout);
	}
	await clearLaunchInfo(userDataDir);
	await clearPortLock(options.port);

	if ((launchInfo as { ephemeral?: boolean }).ephemeral) {
		try {
			await rm(userDataDir, { recursive: true, force: true });
		} catch {
			console.warn(`⚠ failed to remove ephemeral profile: ${userDataDir}`);
		}
	}

	renderOutput(
		{
			...result,
			pid: launchInfo.pid,
			port: launchInfo.port,
			userDataDir,
		},
		options.json,
	);
}
