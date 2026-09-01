import { ProcessManager } from "./process-manager";
import { printViteReadyFallback } from "./vite-adapter";
import { runtimeStateFile } from "./paths";
import type { ManagedProcessState } from "./types";
import { fail, formatSince, printCommand, runText, sleepMs } from "./utils";
import {
	reloadExecutorService,
	verifyExecutorServiceActive,
	showExecutorServiceLogs,
	showInstanceLogs,
} from "./journal";

const pm = new ProcessManager(
	Object.fromEntries(
		Object.entries(process.env).map(([key, value]) => [key, value ?? ""]),
	),
);

function addressMatchesPort(address: string, port: string): boolean {
	return new RegExp(`:${port}$`).test(address);
}

const portConflictRe = /Port\s+\d+\s+is\s+already\s+in\s+use/i;

export interface RuntimeSnapshotView {
	state: ManagedProcessState;
	pid: number;
	startedAt: number | null;
	restartAttempts: number;
	nextRetryAt: number | null;
	lastExit: {
		exitCode: number | null;
		signalCode: string | null;
		at: number;
	} | null;
	lastError: string | null;
}

export interface RuntimeStateView {
	instances: Record<string, RuntimeSnapshotView>;
}

const managedProcessStates = new Set<ManagedProcessState>([
	"stopped",
	"starting",
	"running",
	"stopping",
	"backoff",
	"blocked",
]);

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRuntimeSnapshot(value: unknown): RuntimeSnapshotView | null {
	if (!isObject(value)) return null;
	if (
		typeof value.state !== "string" ||
		!managedProcessStates.has(value.state as ManagedProcessState) ||
		typeof value.pid !== "number" ||
		!Number.isInteger(value.pid) ||
		value.pid < 0
	) {
		return null;
	}

	const lastExit = isObject(value.lastExit)
		? {
				exitCode:
					typeof value.lastExit.exitCode === "number" ||
					value.lastExit.exitCode === null
						? value.lastExit.exitCode
						: null,
				signalCode:
					typeof value.lastExit.signalCode === "string" ||
					value.lastExit.signalCode === null
						? value.lastExit.signalCode
						: null,
				at:
					typeof value.lastExit.at === "number"
						? value.lastExit.at
						: 0,
			}
			: null;

	return {
		state: value.state as ManagedProcessState,
		pid: value.pid,
		startedAt:
			typeof value.startedAt === "number" || value.startedAt === null
				? value.startedAt
				: null,
		restartAttempts:
			typeof value.restartAttempts === "number" &&
			Number.isInteger(value.restartAttempts)
				? value.restartAttempts
				: 0,
		nextRetryAt:
			typeof value.nextRetryAt === "number" || value.nextRetryAt === null
				? value.nextRetryAt
				: null,
		lastExit,
		lastError: typeof value.lastError === "string" ? value.lastError : null,
	};
}

export async function readRuntimeState(): Promise<RuntimeStateView | null> {
	const file = Bun.file(runtimeStateFile);
	if (!(await file.exists())) return null;

	try {
		const raw = (await file.json()) as unknown;
		if (!isObject(raw) || !isObject(raw.instances)) return null;

		const instances: Record<string, RuntimeSnapshotView> = {};
		for (const [name, value] of Object.entries(raw.instances)) {
			const snapshot = parseRuntimeSnapshot(value);
			if (!snapshot) return null;
			instances[name] = snapshot;
		}
		return { instances };
	} catch {
		return null;
	}
}

export function runtimeStateFailure(
	name: string,
	label: string,
	snapshot: RuntimeSnapshotView,
): string | null {
	const detail = snapshot.lastError
		? `: ${snapshot.lastError}`
		: snapshot.lastExit
			? ` (exit ${snapshot.lastExit.exitCode ?? "unknown"}${
					snapshot.lastExit.signalCode
						? `, signal ${snapshot.lastExit.signalCode}`
						: ""
				})`
			: "";

	if (snapshot.state === "blocked") {
		return `[executor] ${label} blocked for ${name}${detail}`;
	}
	if (snapshot.state === "backoff") {
		return `[executor] ${label} failed for ${name}: instance is in backoff${detail}`;
	}
	if (snapshot.state === "stopped") {
		return `[executor] ${label} failed for ${name}: instance is stopped${detail}`;
	}
	return null;
}

function sameRuntimeSnapshot(
	left: RuntimeSnapshotView,
	right: RuntimeSnapshotView,
): boolean {
	return (
		left.state === right.state &&
		left.pid === right.pid &&
		left.startedAt === right.startedAt &&
		left.lastError === right.lastError &&
		left.lastExit?.at === right.lastExit?.at
	);
}

function runtimeStartObserved(
	snapshot: RuntimeSnapshotView,
	before: RuntimeSnapshotView | null,
	requireRestart: boolean,
): boolean {
	if (snapshot.state !== "running" || !processAlive(snapshot.pid)) return false;
	if (!requireRestart || !before || before.state !== "running") return true;
	return snapshot.pid !== before.pid || snapshot.startedAt !== before.startedAt;
}

function processAlive(pid: number): boolean {
	if (pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

export function runtimeStartComplete(
	runtimeAvailable: boolean,
	snapshot: RuntimeSnapshotView | null,
	before: RuntimeSnapshotView | null,
	requireRestart: boolean,
): boolean {
	return (
		runtimeAvailable &&
		snapshot !== null &&
		runtimeStartObserved(snapshot, before, requireRestart)
	);
}

export function runtimeStopComplete(
	runtimeAvailable: boolean,
	snapshot: RuntimeSnapshotView | null,
	initialPid: number,
): boolean {
	return (
		runtimeAvailable &&
		(!snapshot || snapshot.state === "stopped") &&
		!processAlive(initialPid)
	);
}

function printReadinessResult(
	args: string[],
	result: ReturnType<typeof runText>,
): void {
	printCommand(args);
	const stdout = result.stdout.trimEnd();
	const stderr = result.stderr.trimEnd();
	if (stdout) console.log(stdout);
	if (stderr) console.error(stderr);

	const details: string[] = [];
	if (result.spawnError) details.push(String(result.spawnError));
	if (result.timedOut) details.push("timed out");
	if (result.outputOverflow) details.push("output limit exceeded");
	if (details.length > 0) {
		console.error(`[executor] readiness log query failed: ${details.join(", ")}`);
	}
}

async function stableRuntimeStart(
	name: string,
	label: string,
	before: RuntimeSnapshotView | null,
	requireRestart: boolean,
): Promise<boolean> {
	const runtime = await readRuntimeState();
	const snapshot = runtime?.instances[name];
	if (!snapshot) return false;

	const failure = runtimeStateFailure(name, label, snapshot);
	if (failure && (!before || !sameRuntimeSnapshot(snapshot, before))) {
		fail(failure);
	}
	if (
		!runtimeStartComplete(
			Boolean(runtime),
			snapshot,
			before,
			requireRestart,
		)
	) {
		return false;
	}

	await sleepMs(100);
	const confirmedRuntime = await readRuntimeState();
	const confirmed = confirmedRuntime?.instances[name];
	if (!confirmed) return false;
	const confirmedFailure = runtimeStateFailure(name, label, confirmed);
	if (
		confirmedFailure &&
		(!before || !sameRuntimeSnapshot(confirmed, before))
	) {
		fail(confirmedFailure);
	}
	return runtimeStartComplete(
		Boolean(confirmedRuntime),
		confirmed,
		before,
		requireRestart,
	);
}

async function waitForLogPattern(
	name: string,
	pattern: string,
	since: string,
	label: string,
	timeoutSeconds = 15,
	port?: string,
	before: RuntimeSnapshotView | null = null,
	requireRestart = false,
): Promise<void> {
	const args = [
		"/usr/bin/journalctl",
		"--user",
		"-t",
		`executor/${name}`,
		"--since",
		since,
		"--output=cat",
		"--no-pager",
	];
	const deadline = Date.now() + timeoutSeconds * 1_000;
	let conflictHandled = false;
	let logPatternSeen = false;

	while (Date.now() < deadline) {
		if (await stableRuntimeStart(name, label, before, requireRestart)) {
			return;
		}

		const result = runText(args);
		if (result.stdout.includes(pattern)) logPatternSeen = true;

		if (!conflictHandled && port && portConflictRe.test(result.stdout)) {
			conflictHandled = true;
			console.error(
				`[executor] port ${port} is occupied; refusing to kill an external process`,
			);
		}

		await sleepMs(1_000);
	}

	const result = runText(args);
	if (result.stdout.includes(pattern)) logPatternSeen = true;
	printReadinessResult(args, result);
	if (logPatternSeen) {
		console.error(
			`[executor] observed ${label} log output, but runtime state did not reach running`,
		);
	}
	const runtime = await readRuntimeState();
	const snapshot = runtime?.instances[name];
	const failure = snapshot && runtimeStateFailure(name, label, snapshot);
	if (failure) fail(failure);
	fail(`timed out waiting for ${label} on ${name}`);
}

async function waitForInstanceReady(
	name: string,
	pattern: string,
	since: string,
	label: string,
	cmd: string,
	dir: string,
	port: string,
	timeoutSeconds = 15,
): Promise<void> {
	const args = [
		"/usr/bin/journalctl",
		"--user",
		"-t",
		`executor/${name}`,
		"--since",
		since,
		"--output=cat",
		"--no-pager",
	];
	const startedAt = Date.now();
	const deadline = Date.now() + timeoutSeconds * 1_000;
	let portReadyAt = 0;
	let conflictHandled = false;

	while (Date.now() < deadline) {
		const runtime = await readRuntimeState();
		const snapshot = runtime?.instances[name];
		const failure = snapshot && runtimeStateFailure(name, label, snapshot);
		if (failure) fail(failure);
		const runtimeRunning =
			snapshot?.state === "running" && processAlive(snapshot.pid);

		const result = runText(args);
		if (runtimeRunning && result.stdout.includes(pattern)) {
			return;
		}

		if (!conflictHandled && port && portConflictRe.test(result.stdout)) {
			conflictHandled = true;
			console.error(
				`[executor] port ${port} is occupied; refusing to kill an external process`,
			);
		}

		if (runtimeRunning) {
			const addresses = await pm.listeningAddresses(name, cmd);
			if (addresses.some((address) => addressMatchesPort(address, port))) {
				if (!portReadyAt) {
					portReadyAt = Date.now();
				}

				if (Date.now() - portReadyAt >= 5_000) {
					await printViteReadyFallback(
						dir,
						name,
						port,
						Date.now() - startedAt,
					);
					return;
				}
			}
		}

		await sleepMs(portReadyAt ? 500 : 1_000);
	}

	const result = runText(args);
	printReadinessResult(args, result);
	const runtime = await readRuntimeState();
	const snapshot = runtime?.instances[name];
	const failure = snapshot && runtimeStateFailure(name, label, snapshot);
	if (failure) fail(failure);
	fail(`timed out waiting for ${label} on ${name}`);
}

export async function changeAndWait(
	name: string,
	cmd: string,
	dir: string,
	pattern: string,
	label: string,
	readyPattern?: string,
	readyPort?: string,
): Promise<void> {
	const since = formatSince();
	const before = (await readRuntimeState())?.instances[name] ?? null;
	reloadExecutorService();
	verifyExecutorServiceActive();
	await waitForLogPattern(
		name,
		pattern,
		since,
		label,
		15,
		readyPort,
		before,
		label === "reload",
	);
	if (readyPattern && readyPort) {
		await waitForInstanceReady(
			name,
			readyPattern,
			since,
			`${label} ready`,
			cmd,
			dir,
			readyPort,
		);
	} else if (readyPattern) {
		await waitForLogPattern(name, readyPattern, since, `${label} ready`);
	}
	showExecutorServiceLogs(since);
	showInstanceLogs(name, since);
}

export async function stopAndVerify(name: string): Promise<void> {
	const since = formatSince();
	const before = (await readRuntimeState())?.instances[name] ?? null;
	const initialPid = before?.pid ?? 0;

	reloadExecutorService();
	verifyExecutorServiceActive();

	showExecutorServiceLogs(since);

	const args = [
		"/usr/bin/journalctl",
		"--user",
		"-t",
		`executor/${name}`,
		"--since",
		since,
		"--output=cat",
		"--no-pager",
	];

	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const runtime = await readRuntimeState();
		const snapshot = runtime?.instances[name];

		if (snapshot?.state === "running") {
			const restarted =
				!before ||
				before.state !== "running" ||
				snapshot.pid !== before.pid ||
				snapshot.startedAt !== before.startedAt;
			if (restarted) {
				const result = runText(args);
				printReadinessResult(args, result);
				fail(`instance restarted after stop request: ${name}`);
			}
		}

		if (runtimeStopComplete(Boolean(runtime), snapshot ?? null, initialPid)) {
			showInstanceLogs(name, since);
			return;
		}

		const result = runText(args);
		const logs = result.stdout;
		if (logs.includes("[executor] starting ")) {
			printReadinessResult(args, result);
			fail(`instance restarted after stop request: ${name}`);
		}

		await sleepMs(1_000);
	}

	const result = runText(args);
	printReadinessResult(args, result);
	const runtime = await readRuntimeState();
	const snapshot = runtime?.instances[name];
	const detail = snapshot
		? ` (runtime state: ${snapshot.state}${
				snapshot.lastError ? `, ${snapshot.lastError}` : ""
			})`
		: "";
	showInstanceLogs(name, since);
	fail(`timed out waiting for instance to stop: ${name}${detail}`);
}
