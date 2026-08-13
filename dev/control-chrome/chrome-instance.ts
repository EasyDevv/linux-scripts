import { readFileSync } from "node:fs";
import { readFile, readlink, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { DEFAULT_BINARY } from "./config.ts";

export type LaunchInfo = {
	pid?: number;
	port: number;
	requestedPort?: number;
	binary: string;
	url: string;
	userDataDir: string;
	command: string;
	launchedAt: string;
	source?: "launched" | "attached";
	ephemeral?: boolean;
};

export type KillResult = {
	status: "already-exited" | "terminated" | "killed";
	signal?: "SIGTERM" | "SIGKILL";
};

function readPackageJson(cwd: string): { name?: string } | null {
	try {
		const text = readFileSync(join(cwd, "package.json"), "utf-8");
		const parsed = JSON.parse(text) as unknown;
		if (typeof parsed === "object" && parsed !== null) {
			return parsed as { name?: string };
		}
		return null;
	} catch {
		return null;
	}
}

export function resolveProjectProfileDir(projectRoot = process.cwd()): string {
	const cwd = resolve(projectRoot);
	const pkg = readPackageJson(cwd);
	const name = pkg?.name?.trim();
	if (name) {
		return join(cwd, ".user-data", `chrome-${name}`);
	}
	return join(cwd, ".user-data", `chrome-${basename(cwd)}`);
}

export function launchInfoPath(userDataDir: string): string {
	return join(userDataDir, ".control-chrome-launch.json");
}

export async function readLaunchInfo(
	userDataDir: string,
): Promise<LaunchInfo | null> {
	const file = Bun.file(launchInfoPath(userDataDir));
	if (!(await file.exists())) return null;

	try {
		return JSON.parse(await file.text()) as LaunchInfo;
	} catch (error) {
		throw new Error(
			`Invalid launch metadata at ${launchInfoPath(userDataDir)}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function writeLaunchInfo(info: LaunchInfo): Promise<void> {
	await Bun.write(
		launchInfoPath(info.userDataDir),
		`${JSON.stringify(info, null, 2)}\n`,
	);
}

export async function clearLaunchInfo(userDataDir: string): Promise<void> {
	await unlink(launchInfoPath(userDataDir)).catch((error) => {
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
	});
}

export function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException)?.code;
		if (code === "ESRCH") return false;
		if (code === "EPERM") return true;
		throw error;
	}
}

async function readProcessArgs(pid: number): Promise<string[] | null> {
	if (process.platform !== "linux") return null;

	try {
		const bytes = await readFile(`/proc/${pid}/cmdline`);
		return new TextDecoder().decode(bytes).split("\0").filter(Boolean);
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
		throw error;
	}
}

async function readProcessCwd(pid: number): Promise<string | null> {
	if (process.platform !== "linux") return null;

	try {
		return await readlink(`/proc/${pid}/cwd`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
		throw error;
	}
}

export function chromeDebugPortForProfile(
	args: string[],
	processCwd: string,
	userDataDir: string,
): number | null {
	const commandLine = args.join("\0");
	const profileArg = commandLine.match(
		/(?:^|[\s\0])--user-data-dir=([^\s\0]+)/,
	)?.[1];
	const port = Number(
		commandLine.match(/(?:^|[\s\0])--remote-debugging-port=(\d+)/)?.[1],
	);
	if (!profileArg || !Number.isInteger(port) || port <= 0 || port > 65535)
		return null;

	const profileDir = resolve(processCwd, profileArg);
	return profileDir === resolve(userDataDir) ? port : null;
}

export async function findRunningChromeForProfile(
	userDataDir: string,
): Promise<{ pid: number; port: number } | null> {
	if (process.platform !== "linux") return null;

	let lockTarget: string;
	try {
		lockTarget = await readlink(join(userDataDir, "SingletonLock"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
		throw error;
	}

	const pid = Number(lockTarget.match(/-(\d+)$/)?.[1]);
	if (!Number.isInteger(pid) || pid <= 0 || !processExists(pid)) return null;

	const [args, processCwd] = await Promise.all([
		readProcessArgs(pid),
		readProcessCwd(pid),
	]);
	if (!args?.length || !processCwd) return null;
	const port = chromeDebugPortForProfile(args, processCwd, userDataDir);
	return port === null ? null : { pid, port };
}

export async function processMatchesLaunchInfo(
	info: Pick<LaunchInfo, "pid" | "port" | "userDataDir">,
): Promise<boolean | null> {
	if (!info.pid) return false;
	const args = await readProcessArgs(info.pid);
	if (args === null) return null;
	if (!args.length) return false;
	const processCwd = await readProcessCwd(info.pid);
	if (!processCwd) return false;

	return (
		chromeDebugPortForProfile(args, processCwd, info.userDataDir) === info.port
	);
}

function sendSignal(pid: number, signal: "SIGTERM" | "SIGKILL"): boolean {
	const target = process.platform === "win32" ? pid : -pid;

	try {
		process.kill(target, signal);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ESRCH") return false;
		throw error;
	}
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!processExists(pid)) return true;
		await Bun.sleep(100);
	}
	return !processExists(pid);
}

export async function terminateProcess(
	pid: number,
	timeoutMs = 5000,
): Promise<KillResult> {
	if (!Number.isInteger(pid) || pid <= 0)
		throw new Error(`Invalid PID: ${pid}`);
	if (!processExists(pid)) return { status: "already-exited" };

	sendSignal(pid, "SIGTERM");
	if (await waitForExit(pid, timeoutMs))
		return { status: "terminated", signal: "SIGTERM" };

	sendSignal(pid, "SIGKILL");
	if (await waitForExit(pid, 1000))
		return { status: "killed", signal: "SIGKILL" };

	throw new Error(`Timed out waiting for PID ${pid} to exit`);
}

export function resolveBinary(explicit?: string): string {
	const requested = explicit ?? process.env.CONTROL_CHROME_BIN;
	if (requested) {
		const resolved = Bun.which(requested);
		if (resolved) return resolved;
		throw new Error(
			`Browser binary not found: ${requested}. Install it or pass --binary <path>`,
		);
	}

	const resolved = Bun.which(DEFAULT_BINARY);
	if (resolved) return resolved;

	throw new Error(
		`Default browser binary "${DEFAULT_BINARY}" not found in PATH. ` +
			`Install chromium or pass --binary <path> to use a different browser.`,
	);
}
