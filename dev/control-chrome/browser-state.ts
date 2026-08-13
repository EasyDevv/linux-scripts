import { mkdir, open, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { hostname, homedir } from "node:os";
import { join } from "node:path";

import { LOCK_DEFAULTS } from "./config.ts";
import { processExists } from "./chrome-instance.ts";

export type PortLock = {
	version: 1;
	port: number;
	requestedPort: number;
	owner: string;
	userDataDir: string;
	url: string;
	browserPid?: number;
	browserSource: "launching" | "launched" | "attached";
	createdAt: string;
	updatedAt: string;
	lastUsedAt?: string;
	idleTimeoutMs?: number;
	keepaliveUntil?: string;
	note?: string;
};

export type PortState = {
	port: number;
	browserReachable: boolean;
	portBindable: boolean;
	lock: PortLock | null;
	lockStatus: "none" | "active" | "stale-cleared";
};

type ClaimResult =
	| { acquired: true; lock: PortLock }
	| { acquired: false; state: PortState };

const PORT_SCAN_LIMIT = 100;

export function stateRootDir(): string {
	return join(homedir(), ".cache", "control-chrome", "state");
}

function locksDir(): string {
	return join(stateRootDir(), "locks");
}

export function portLockPath(port: number): string {
	return join(locksDir(), `port-${port}.json`);
}

export function defaultLockOwner(): string {
	return `${hostname()}:${process.pid}`;
}

async function readJsonFile<T>(path: string): Promise<T | null> {
	const file = Bun.file(path);
	if (!(await file.exists())) return null;

	try {
		return JSON.parse(await file.text()) as T;
	} catch (error) {
		throw new Error(
			`Invalid JSON metadata at ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
	await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function browserReachable(port: number): Promise<boolean> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
			signal: AbortSignal.timeout(750),
		});
		return response.ok;
	} catch {
		return false;
	}
}

export async function canBindPort(port: number): Promise<boolean> {
	return await new Promise<boolean>((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.listen(port, "127.0.0.1", () => {
			server.close(() => resolve(true));
		});
	});
}

function parseTimestamp(value: string | undefined): number | null {
	if (!value) {
		return null;
	}

	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? null : timestamp;
}

function resolveLastUsedAt(lock: PortLock): number | null {
	return (
		parseTimestamp(lock.lastUsedAt) ??
		parseTimestamp(lock.updatedAt) ??
		parseTimestamp(lock.createdAt)
	);
}

function resolveIdleTimeoutMs(lock: PortLock): number {
	return Number.isInteger(lock.idleTimeoutMs) && lock.idleTimeoutMs! > 0
		? lock.idleTimeoutMs!
		: LOCK_DEFAULTS.idleTimeoutMs;
}

function lockIsStale(lock: PortLock, reachable: boolean): boolean {
	const now = Date.now();
	const keepaliveUntil = parseTimestamp(lock.keepaliveUntil);
	if (keepaliveUntil !== null && keepaliveUntil > now) {
		return false;
	}

	if (lock.browserPid && !reachable && !processExists(lock.browserPid)) {
		return true;
	}

	const lastUsedAt = resolveLastUsedAt(lock);
	if (lastUsedAt === null) {
		return true;
	}

	return now - lastUsedAt > resolveIdleTimeoutMs(lock);
}

export async function readPortLock(port: number): Promise<PortLock | null> {
	return await readJsonFile<PortLock>(portLockPath(port));
}

export async function writePortLock(lock: PortLock): Promise<void> {
	await mkdir(locksDir(), { recursive: true });
	await writeJsonFile(portLockPath(lock.port), lock);
}

export async function clearPortLock(port: number): Promise<void> {
	await unlink(portLockPath(port)).catch((error) => {
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
	});
}

export async function resolvePortState(port: number): Promise<PortState> {
	const reachable = await browserReachable(port);
	let lock = await readPortLock(port);
	let lockStatus: PortState["lockStatus"] = lock ? "active" : "none";

	if (lock && lockIsStale(lock, reachable)) {
		await clearPortLock(port);
		lock = null;
		lockStatus = "stale-cleared";
	}

	return {
		port,
		browserReachable: reachable,
		portBindable: reachable ? false : await canBindPort(port),
		lock,
		lockStatus,
	};
}

export async function claimPortLock(
	seed: Omit<PortLock, "version" | "createdAt" | "updatedAt">,
): Promise<ClaimResult> {
	await mkdir(locksDir(), { recursive: true });
	const now = new Date().toISOString();
	const lock: PortLock = {
		...seed,
		version: 1,
		createdAt: now,
		updatedAt: now,
		lastUsedAt: seed.lastUsedAt ?? now,
		idleTimeoutMs: seed.idleTimeoutMs ?? LOCK_DEFAULTS.idleTimeoutMs,
	};

	try {
		const handle = await open(portLockPath(seed.port), "wx");
		await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`);
		await handle.close();
		return { acquired: true, lock };
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
		const state = await resolvePortState(seed.port);
		if (state.lockStatus === "stale-cleared") return await claimPortLock(seed);
		return { acquired: false, state };
	}
}

export async function refreshPortLock(
	port: number,
	patch: Partial<Omit<PortLock, "port" | "version" | "createdAt">>,
): Promise<PortLock | null> {
	const current = await readPortLock(port);
	if (!current) return null;

	const next: PortLock = {
		...current,
		...patch,
		updatedAt: new Date().toISOString(),
	};
	await writePortLock(next);
	return next;
}

export async function findAvailablePort(startPort: number): Promise<number> {
	for (let port = startPort; port < startPort + PORT_SCAN_LIMIT; port++) {
		const state = await resolvePortState(port);
		if (state.lock || state.browserReachable || !state.portBindable) continue;
		return port;
	}

	throw new Error(
		`Could not find an available Chrome debugging port between ${startPort} and ${startPort + PORT_SCAN_LIMIT - 1}`,
	);
}
