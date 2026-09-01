import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { stateDir } from "./paths";
import type {
	ManagedProcessExit,
	ManagedProcessSnapshot,
	ManagedProcessState,
	NormalizedInstance,
} from "./types";
import { extractPort, journalLog, runText, sleepMs } from "./utils";

const controlRunOptions = {
	timeoutMs: 2_000,
	maxBuffer: 1 * 1024 * 1024,
};
const defaultBackoffDelaysMs = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const defaultBackoffJitter = 0.2;
const defaultNormalRuntimeMs = 60_000;
const defaultTerminationGraceMs = 5_000;

let cachedUid: string | null = null;

interface ProcessManagerOptions {
	systemdCatPath?: string;
	lsofPath?: string;
	psPath?: string;
	backoffDelaysMs?: readonly number[];
	backoffJitter?: number;
	normalRuntimeMs?: number;
	terminationGraceMs?: number;
	onStateChange?: () => void;
}

interface UserProcess {
	pid: number;
	args: string;
}

interface ProcessIdentity {
	version: 1;
	pid: number;
	startTime: string | null;
	commandFingerprint: string;
}

function errorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function shortError(error: unknown): string {
	return errorText(error).replace(/\s+/g, " ").trim().slice(0, 300);
}

function controlHelperFailure(
	helper: string,
	result: ReturnType<typeof runText>,
	allowEmptyResult = false,
): Error | null {
	if (result.ok) return null;

	const isExpectedEmptyResult =
		allowEmptyResult &&
		result.exitCode === 1 &&
		result.spawnError === null &&
		!result.timedOut &&
		!result.outputOverflow &&
		result.stdout.trim() === "" &&
		result.stderr.trim() === "";
	if (isExpectedEmptyResult) return null;

	let detail: string;
	if (result.spawnError !== null) {
		detail = errorText(result.spawnError);
	} else if (result.timedOut) {
		detail = "timed out";
	} else if (result.outputOverflow) {
		detail = "output exceeded the limit";
	} else {
		detail =
			result.exitCode === null
				? "ended without an exit code"
				: `exited with code ${result.exitCode}`;
		if (result.signalCode) detail += ` (signal ${result.signalCode})`;
		if (result.stderr.trim()) detail += `: ${shortError(result.stderr)}`;
	}

	return new Error(`${helper} helper failed: ${detail}`);
}

function requireControlSuccess(
	helper: string,
	result: ReturnType<typeof runText>,
	allowEmptyResult = false,
): void {
	const failure = controlHelperFailure(helper, result, allowEmptyResult);
	if (failure) throw failure;
}

function parsePidOutput(output: string, helper: string): number[] {
	const pids: number[] = [];
	for (const line of output.split(/\r?\n/)) {
		const value = line.trim();
		if (!value) continue;
		if (!/^\d+$/.test(value)) {
			throw new Error(`${helper} helper returned invalid PID output`);
		}
		const pid = Number(value);
		if (!Number.isSafeInteger(pid) || pid <= 0) {
			throw new Error(`${helper} helper returned an invalid PID`);
		}
		pids.push(pid);
	}
	return [...new Set(pids)];
}

function isSpawnConfigurationError(error: unknown): boolean {
	const value = error as NodeJS.ErrnoException;
	return value.code === "ENOENT" || value.code === "EACCES";
}

function commandFingerprint(command: string): string {
	return String(Bun.hash(command));
}

async function ensureStateDir(): Promise<void> {
	mkdirSync(stateDir, { recursive: true });
}

export async function clearStateDir(): Promise<void> {
	await ensureStateDir();
	rmSync(stateDir, { recursive: true, force: true });
	mkdirSync(stateDir, { recursive: true });
}

function instancePidFile(name: string): string {
	return `${stateDir}/${name}.pid`;
}

function instanceIdentityFile(name: string): string {
	return `${stateDir}/${name}.identity.json`;
}

async function writeInstancePidFile(name: string, pid: number): Promise<void> {
	await ensureStateDir();
	await Bun.write(instancePidFile(name), `${pid}\n`);
}

async function removeInstanceState(name: string): Promise<void> {
	try {
		unlinkSync(instancePidFile(name));
	} catch {
		// The pid file may already have been removed.
	}
	try {
		unlinkSync(instanceIdentityFile(name));
	} catch {
		// The identity file may already have been removed.
	}
}

async function readInstancePid(name: string): Promise<number | null> {
	const file = Bun.file(instancePidFile(name));
	if (!(await file.exists())) {
		return null;
	}

	const raw = (await file.text()).trim();
	if (!raw) {
		return null;
	}

	const pid = Number(raw);
	return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function readInstanceIdentity(
	name: string,
): Promise<ProcessIdentity | null> {
	const file = Bun.file(instanceIdentityFile(name));
	if (!(await file.exists())) return null;

	try {
		const value = (await file.json()) as Partial<ProcessIdentity>;
		if (
			value.version !== 1 ||
			typeof value.pid !== "number" ||
			!Number.isSafeInteger(value.pid) ||
			value.pid <= 0 ||
			(value.startTime !== null && typeof value.startTime !== "string") ||
			typeof value.commandFingerprint !== "string" ||
			value.commandFingerprint.length === 0
		) {
			return null;
		}
		return value as ProcessIdentity;
	} catch {
		return null;
	}
}

async function writeInstanceIdentity(
	name: string,
	pid: number,
	cmd: string,
): Promise<void> {
	await ensureStateDir();
	const startTime = await readProcStartTime(pid);
	const tmpFile = `${instanceIdentityFile(name)}.${process.pid}.${Date.now()}.tmp`;
	try {
		await Bun.write(
			tmpFile,
			`${JSON.stringify(
				{
					version: 1,
					pid,
					startTime,
					commandFingerprint: commandFingerprint(cmd),
				} as ProcessIdentity,
			)}\n`,
		);
		renameSync(tmpFile, instanceIdentityFile(name));
	} finally {
		try {
			unlinkSync(tmpFile);
		} catch {
			// The rename already removed the temporary name.
		}
	}
}

async function readProcStartTime(pid: number): Promise<string | null> {
	try {
		const text = await Bun.file(`/proc/${pid}/stat`).text();
		const closeParen = text.lastIndexOf(")");
		if (closeParen === -1) return null;
		const fields = text.slice(closeParen + 1).trim().split(/\s+/);
		// The slice starts at field 3; starttime is field 22.
		return fields[19] ?? null;
	} catch {
		return null;
	}
}

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function processNeedsSignal(pid: number): boolean {
	if (!processExists(pid)) return false;
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const closeParen = stat.lastIndexOf(")");
		if (closeParen !== -1) {
			const state = stat.slice(closeParen + 1).trimStart()[0];
			if (state === "Z" || state === "X") return false;
		}
	} catch {
		// If procfs cannot be inspected, preserve the conservative kill(0) result.
	}
	return true;
}

function getUid(): string {
	if (cachedUid) {
		return cachedUid;
	}

	const uid = process.getuid?.();
	if (uid !== undefined) {
		cachedUid = String(uid);
		return cachedUid;
	}

	const result = runText(["/usr/bin/id", "-u"], controlRunOptions);
	requireControlSuccess("id", result);
	cachedUid = result.stdout.trim();
	if (!cachedUid) throw new Error("id helper returned an empty UID");
	return cachedUid;
}

function userProcesses(psPath = "/bin/ps"): UserProcess[] {
	const uid = getUid();
	if (!uid) throw new Error("id helper returned an empty UID");

	const result = runText(
		[psPath, "-u", uid, "-o", "pid=,args="],
		controlRunOptions,
	);
	requireControlSuccess("ps", result);

	return result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const match = line.match(/^(\d+)\s*(.*)$/);
			if (!match) throw new Error("ps helper returned invalid process output");
			return { pid: Number(match[1]), args: match[2] };
		})
		.filter((entry) => Number.isSafeInteger(entry.pid) && entry.pid > 0);
}

function childPids(parentPid: number, psPath = "/bin/ps"): number[] {
	if (!processExists(parentPid)) return [];

	const result = runText(
		[psPath, "-o", "pid=", "--ppid", String(parentPid)],
		controlRunOptions,
	);
	requireControlSuccess("ps", result);
	return parsePidOutput(result.stdout, "ps");
}

interface PidCollection {
	pids: number[];
	error: Error | null;
}

function collectDescendantPidsWithStatus(
	rootPid: number,
	psPath = "/bin/ps",
): PidCollection {
	const queue = [rootPid];
	const seen = new Set<number>();
	const output: number[] = [];
	let firstError: Error | null = null;

	while (queue.length > 0) {
		const current = queue.shift() as number;
		if (seen.has(current)) continue;

		seen.add(current);
		output.push(current);
		try {
			for (const child of childPids(current, psPath)) queue.push(child);
		} catch (error) {
			firstError ??= error instanceof Error ? error : new Error(errorText(error));
		}
	}

	return { pids: output, error: firstError };
}

function collectDescendantPids(
	rootPid: number,
	psPath = "/bin/ps",
): number[] {
	const collected = collectDescendantPidsWithStatus(rootPid, psPath);
	if (collected.error) throw collected.error;
	return collected.pids;
}

function processGroupIds(pids: number[], psPath = "/bin/ps"): number[] {
	const livePids = pids.filter((pid) => processExists(pid));
	if (livePids.length === 0) return [];

	const result = runText(
		[psPath, "-o", "pid=,pgid=", "-p", livePids.join(",")],
		controlRunOptions,
	);
	requireControlSuccess("ps", result);

	const groups = new Set<number>();
	for (const line of result.stdout.split(/\r?\n/)) {
		const value = line.trim();
		if (!value) continue;
		const match = value.match(/^(\d+)\s+(\d+)$/);
		if (!match) throw new Error("ps helper returned invalid process-group output");
		const pid = Number(match[1]);
		const pgid = Number(match[2]);
		if (Number.isSafeInteger(pid) && Number.isSafeInteger(pgid) && pgid > 1) {
			// Only kill a group whose leader was observed in this managed tree.
			// This prevents a systemd-cat wrapper's inherited supervisor group from
			// being signalled accidentally.
			if (pids.includes(pgid)) groups.add(pgid);
		}
	}
	return [...groups];
}

async function terminateProcessTree(
	rootPid: number,
	graceMs = defaultTerminationGraceMs,
	psPath = "/bin/ps",
): Promise<void> {
	const knownPids = new Set<number>([rootPid]);
	const processGroups = new Set<number>();
	let inspectionFailed = false;

	const inspect = (): void => {
		const collected = collectDescendantPidsWithStatus(rootPid, psPath);
		for (const pid of collected.pids) knownPids.add(pid);
		if (collected.error) inspectionFailed = true;

		try {
			for (const pgid of processGroupIds([...knownPids], psPath)) {
				if (knownPids.has(pgid)) processGroups.add(pgid);
			}
		} catch {
			// Individual PID cleanup remains available when process-group inspection
			// is unavailable. Do not treat an unknown tree as safely gone.
			inspectionFailed = true;
		}
	};

	const signalKnownProcesses = (signal: "SIGTERM" | "SIGKILL"): void => {
		for (const pid of [...knownPids].reverse()) {
			try {
				process.kill(pid, signal);
			} catch {
				// Ignore dead processes.
			}
		}
		for (const pgid of processGroups) {
			try {
				process.kill(-pgid, signal);
			} catch {
				// Ignore dead process groups.
			}
		}
	};

	const hasLiveKnownProcess = (): boolean =>
		[...knownPids].some((pid) => processNeedsSignal(pid));

	// Inspect before signalling so a child that exits with its parent is still
	// retained in knownPids after it is reparented.
	inspect();
	signalKnownProcesses("SIGTERM");

	const deadline = Date.now() + Math.max(0, graceMs);
	while (Date.now() < deadline) {
		inspect();
		if (!inspectionFailed && !hasLiveKnownProcess()) return;
		await sleepMs(Math.min(100, Math.max(1, deadline - Date.now())));
	}

	inspect();
	signalKnownProcesses("SIGKILL");

	// SIGKILL is immediate, but wait briefly for the OS to reap known children
	// before reporting the transition complete.
	const killDeadline =
		Date.now() + Math.min(1_000, Math.max(100, graceMs));
	while (Date.now() < killDeadline) {
		if (!hasLiveKnownProcess()) return;
		await sleepMs(Math.min(25, Math.max(1, killDeadline - Date.now())));
		inspect();
	}
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function executableExists(path: string): boolean {
	try {
		return Boolean(Bun.which(path));
	} catch {
		return false;
	}
}

async function storedProcessMatches(
	name: string,
	pid: number,
	cmd: string,
): Promise<boolean> {
	if (!processExists(pid)) return false;

	const identityFile = Bun.file(instanceIdentityFile(name));
	if (!(await identityFile.exists())) {
		// A legacy PID file without an identity sidecar cannot establish
		// ownership. In particular, command-line substring matches are not
		// sufficient to authorize terminating a port occupant.
		return false;
	}

	const identity = await readInstanceIdentity(name);
	if (!identity || identity.pid !== pid) return false;
	const currentStartTime = await readProcStartTime(pid);
	if (identity.startTime && currentStartTime) {
		return identity.startTime === currentStartTime;
	}
	return identity.commandFingerprint === commandFingerprint(cmd);
}

function copyExit(value: ManagedProcessExit | null): ManagedProcessExit | null {
	return value ? { ...value } : null;
}

function copySnapshot(value: ManagedProcessSnapshot): ManagedProcessSnapshot {
	return { ...value, lastExit: copyExit(value.lastExit) };
}

export interface ManagedProcess {
	readonly name: string;
	readonly pid: number;
	readonly running: boolean;
	readonly state: ManagedProcessState;
	readonly snapshot: ManagedProcessSnapshot;
	restart(): Promise<void>;
	stop(): Promise<void>;
}

export class ProcessManager {
	private readonly systemdCatPath: string;
	private readonly lsofPath: string;
	private readonly psPath: string;
	private readonly backoffDelaysMs: readonly number[];
	private readonly backoffJitter: number;
	private readonly normalRuntimeMs: number;
	private readonly terminationGraceMs: number;
	private readonly onStateChange?: () => void;

	constructor(
		private env: Record<string, string>,
		options: ProcessManagerOptions = {},
	) {
		this.systemdCatPath = options.systemdCatPath ?? "/usr/bin/systemd-cat";
		this.lsofPath = options.lsofPath ?? "/usr/bin/lsof";
		this.psPath = options.psPath ?? "/bin/ps";
		this.backoffDelaysMs =
			options.backoffDelaysMs?.length
				? options.backoffDelaysMs
				: defaultBackoffDelaysMs;
		this.backoffJitter = options.backoffJitter ?? defaultBackoffJitter;
		this.normalRuntimeMs = options.normalRuntimeMs ?? defaultNormalRuntimeMs;
		this.terminationGraceMs =
			options.terminationGraceMs ?? defaultTerminationGraceMs;
		this.onStateChange = options.onStateChange;
	}

	private notifyStateChange(): void {
		try {
			this.onStateChange?.();
		} catch {
			// Observability must never affect process supervision.
		}
	}

	async clearState(): Promise<void> {
		await clearStateDir();
	}

	private portProcessIds(port: string): number[] {
		const result = runText(
			[this.lsofPath, "-ti", `:${port}`],
			controlRunOptions,
		);
		requireControlSuccess("lsof", result, true);
		return parsePidOutput(result.stdout, "lsof");
	}

	private async portHasForeignOccupant(
		instance: NormalizedInstance,
	): Promise<string | null> {
		const port = extractPort(instance.cmd);
		if (!port) return null;

		try {
			const pids = this.portProcessIds(port);
			if (pids.length === 0) return null;

			const previousPid = await readInstancePid(instance.name);
			if (
				previousPid &&
				(await storedProcessMatches(instance.name, previousPid, instance.cmd))
			) {
				const ownedPids = new Set(
					collectDescendantPids(previousPid, this.psPath),
				);
				if (pids.every((pid) => ownedPids.has(pid))) {
					await terminateProcessTree(
						previousPid,
						this.terminationGraceMs,
						this.psPath,
					);
					await removeInstanceState(instance.name);
					return null;
				}
			}

			return `port ${port} is already in use by an external process`;
		} catch (error) {
			return `port ${port} inspection failed: ${shortError(error)}`;
		}
	}

	private async preflight(instance: NormalizedInstance): Promise<string | null> {
		if (!isDirectory(instance.dir)) {
			return "working directory is unavailable";
		}
		if (!executableExists("/bin/sh")) {
			return "shell executable /bin/sh is unavailable";
		}

		return await this.portHasForeignOccupant(instance);
	}

	private loggerUsable(tag: string): boolean {
		if (!executableExists(this.systemdCatPath)) return false;

		const result = runText(
			[this.systemdCatPath, "-t", tag, "/bin/true"],
			{ ...controlRunOptions, stdin: "ignore" },
		);
		return !controlHelperFailure("systemd-cat", result);
	}

	private commandFor(instance: NormalizedInstance, tag: string): {
		args: string[];
		journaled: boolean;
	} {
		const base = ["/bin/sh", "-lc", instance.cmd];
		const withSession = executableExists("/usr/bin/setsid")
			? ["/usr/bin/setsid", ...base]
			: base;
		const buffered = executableExists("/usr/bin/stdbuf")
			? ["/usr/bin/stdbuf", "-oL", "-eL", ...withSession]
			: withSession;
		const journaled = this.loggerUsable(tag);

		return {
			args: journaled
				? [this.systemdCatPath, "-t", tag, ...buffered]
				: buffered,
			journaled,
		};
	}

	private spawnInstance(
		instance: NormalizedInstance,
		tag: string,
	): Bun.Subprocess {
		const command = this.commandFor(instance, tag);
		const env = {
			...this.env,
			...instance.env,
			DIR: instance.dir,
			CMD: instance.cmd,
			EXECUTOR_NAME: instance.name,
			EXECUTOR_TAG: tag,
		};
		const stdio = command.journaled ? "ignore" : "inherit";

		try {
			return Bun.spawn(command.args, {
				cwd: instance.dir,
				env,
				stdin: "ignore",
				stdout: stdio,
				stderr: stdio,
			});
		} catch (error) {
			// A systemd-cat race (removed after the preflight) must not turn into
			// a supervisor failure. Retry the actual command without the logger.
			if (command.journaled) {
				const fallback = this.commandForWithoutJournal(instance);
				return Bun.spawn(fallback, {
					cwd: instance.dir,
					env,
					stdin: "ignore",
					stdout: "inherit",
					stderr: "inherit",
				});
			}
			throw error;
		}
	}

	private commandForWithoutJournal(instance: NormalizedInstance): string[] {
		const base = ["/bin/sh", "-lc", instance.cmd];
		const withSession = executableExists("/usr/bin/setsid")
			? ["/usr/bin/setsid", ...base]
			: base;
		return executableExists("/usr/bin/stdbuf")
			? ["/usr/bin/stdbuf", "-oL", "-eL", ...withSession]
			: withSession;
	}

	private retryDelay(attempt: number): number {
		const base =
			this.backoffDelaysMs[
				Math.min(attempt - 1, this.backoffDelaysMs.length - 1)
			] ?? defaultBackoffDelaysMs[defaultBackoffDelaysMs.length - 1];
		const jitter = 1 + (Math.random() * 2 - 1) * this.backoffJitter;
		return Math.max(1, Math.round(base * jitter));
	}

	start(instance: NormalizedInstance): ManagedProcess {
		const tag = `executor/${instance.name}`;
		const stopController = new AbortController();
		let currentProc: Bun.Subprocess | null = null;
		let restartPromise: Promise<void> | null = null;
		let operationTail: Promise<void> = Promise.resolve();
		let retryWake: (() => void) | null = null;
		let restartRequested = false;
		let restartWaiter: (() => void) | null = null;
		let stopRequested = false;
		let terminationPromise: Promise<void> | null = null;
		let failureAttempts = 0;
		let snapshot: ManagedProcessSnapshot = {
			name: instance.name,
			state: "starting",
			pid: 0,
			startedAt: null,
			restartAttempts: 0,
			nextRetryAt: null,
			lastExit: null,
			lastError: null,
		};

		const settleRestartWaiter = (): void => {
			const resolve = restartWaiter;
			restartWaiter = null;
			resolve?.();
		};
		const isTerminal = (): boolean =>
			snapshot.state === "blocked" || snapshot.state === "stopped";
		const setState = (state: ManagedProcessState): void => {
			if (snapshot.state === state) return;
			snapshot.state = state;
			this.notifyStateChange();
		};
		const setError = (error: unknown): void => {
			snapshot.lastError = shortError(error);
			this.notifyStateChange();
		};
		const recordExit = (exit: ManagedProcessExit): void => {
			snapshot.lastExit = exit;
			snapshot.pid = 0;
			snapshot.startedAt = null;
			this.notifyStateChange();
		};
		const waitForRetry = (delayMs: number): Promise<void> =>
			new Promise((resolve) => {
				let finished = false;
				let timer: ReturnType<typeof setTimeout>;
				const onAbort = () => finish();
				const finish = () => {
					if (finished) return;
					finished = true;
					clearTimeout(timer);
					retryWake = null;
					stopController.signal.removeEventListener("abort", onAbort);
					resolve();
				};
				timer = setTimeout(finish, delayMs);
				retryWake = finish;
				stopController.signal.addEventListener("abort", onAbort, {
					once: true,
				});
			});
		const enqueueOperation = (operation: () => Promise<void>): Promise<void> => {
			const next = operationTail.then(operation, operation);
			operationTail = next.catch(() => undefined);
			return next;
		};

		const registerFailure = async (
			error: unknown,
			permanent = false,
		): Promise<boolean> => {
			if (stopController.signal.aborted) return false;
			setError(error);
			if (permanent) {
				setState("blocked");
				return false;
			}

			failureAttempts = Math.min(failureAttempts + 1, Number.MAX_SAFE_INTEGER);
			snapshot.restartAttempts = failureAttempts;
			const delay = this.retryDelay(failureAttempts);
			snapshot.nextRetryAt = Date.now() + delay;
			setState("backoff");
			await waitForRetry(delay);
			snapshot.nextRetryAt = null;
			this.notifyStateChange();
			return !stopController.signal.aborted;
		};

		const terminateCurrentProcess = (proc: Bun.Subprocess): Promise<void> => {
			if (terminationPromise) return terminationPromise;
			terminationPromise = terminateProcessTree(
				proc.pid,
				this.terminationGraceMs,
				this.psPath,
			).finally(() => {
				terminationPromise = null;
			});
			return terminationPromise;
		};

		const loop = (async () => {
			try {
				while (!stopController.signal.aborted) {
					if (restartRequested) {
						restartRequested = false;
						failureAttempts = 0;
						snapshot.restartAttempts = 0;
						snapshot.nextRetryAt = null;
						this.notifyStateChange();
					}

					setState("starting");
					snapshot.pid = 0;
					snapshot.startedAt = null;
					snapshot.nextRetryAt = null;
					await journalLog(
						tag,
						`[executor] starting ${instance.cmd}\n`,
						this.systemdCatPath,
					);
					if (stopController.signal.aborted) break;
					if (restartRequested) continue;

					const preflightIssue = await this.preflight(instance);
					if (preflightIssue) {
						setError(preflightIssue);
						setState("blocked");
						break;
					}
					if (stopController.signal.aborted) break;
					if (restartRequested) continue;

					let proc: Bun.Subprocess;
					try {
						proc = this.spawnInstance(instance, tag);
					} catch (error) {
						if (
							!(await registerFailure(
								error,
								isSpawnConfigurationError(error),
							))
						) {
							break;
						}
						continue;
					}

					currentProc = proc;
					snapshot.pid = proc.pid;
					snapshot.startedAt = Date.now();
					snapshot.lastError = null;
					setState("running");
					if (restartWaiter && !restartRequested) settleRestartWaiter();
					try {
						await writeInstancePidFile(instance.name, proc.pid);
						await writeInstanceIdentity(instance.name, proc.pid, instance.cmd);
					} catch (error) {
						// A state-file failure must not abandon a live child. The in-memory
						// handle remains authoritative until the next clean spawn.
						setError(`runtime state write failed: ${shortError(error)}`);
					}

					let exitCode: number | null = null;
					let waitError: unknown = null;
					try {
						exitCode = await proc.exited;
					} catch (error) {
						waitError = error;
					}
					const startedAt = snapshot.startedAt ?? Date.now();
					const runtimeMs = Date.now() - startedAt;
					const signalCode = proc.signalCode ?? null;
					currentProc = null;
					await removeInstanceState(instance.name);
					recordExit({
						exitCode,
						signalCode,
						at: Date.now(),
					});

					if (stopController.signal.aborted) break;
					if (waitError) {
						if (!(await registerFailure(waitError))) break;
						continue;
					}
					if (exitCode === 127) {
						setError("managed command could not be found (exit code 127)");
						setState("blocked");
						break;
					}

					if (runtimeMs >= this.normalRuntimeMs) {
						failureAttempts = 0;
						snapshot.restartAttempts = 0;
					} else {
						failureAttempts = Math.min(
							failureAttempts + 1,
							Number.MAX_SAFE_INTEGER,
						);
						snapshot.restartAttempts = failureAttempts;
					}
					const delay = this.retryDelay(Math.max(1, failureAttempts));
					if (restartRequested) continue;
					await journalLog(
						tag,
						`[executor] process exited; restarting in ${delay}ms\n`,
						this.systemdCatPath,
					);
					if (stopController.signal.aborted) break;
					if (restartRequested) continue;
					snapshot.nextRetryAt = Date.now() + delay;
					setState("backoff");
					await waitForRetry(delay);
					snapshot.nextRetryAt = null;
					this.notifyStateChange();
				}
			} catch (error) {
				if (!stopController.signal.aborted) {
					setError(error);
					setState("blocked");
				}
			} finally {
				const proc = currentProc;
				if (proc) {
					try {
						await terminateCurrentProcess(proc);
					} catch (error) {
						setError(`process termination failed: ${shortError(error)}`);
					}
					try {
						await proc.exited;
					} catch {
						// The process is already being reaped or terminated.
					}
					currentProc = null;
					snapshot.pid = 0;
					snapshot.startedAt = null;
					this.notifyStateChange();
				}
				await removeInstanceState(instance.name);
				if (stopRequested || stopController.signal.aborted) {
					setState("stopped");
					snapshot.pid = 0;
					snapshot.startedAt = null;
					snapshot.nextRetryAt = null;
					this.notifyStateChange();
				}
				settleRestartWaiter();
			}
		})();
		const loopPromise = loop.catch((error) => {
			// Keep the background promise observed even if a future edit adds an
			// error outside the loop's own guard.
			setError(error);
			setState("blocked");
			settleRestartWaiter();
		});

		const restart = (): Promise<void> => {
			if (restartPromise) return restartPromise;
			restartPromise = enqueueOperation(async () => {
				if (
					stopController.signal.aborted ||
					snapshot.state === "blocked" ||
					snapshot.state === "stopped"
				) {
					return;
				}

				const completion = new Promise<void>((resolve) => {
					restartWaiter = resolve;
				});
				restartRequested = true;
				failureAttempts = 0;
				snapshot.restartAttempts = 0;
				retryWake?.();
				const proc = currentProc;
				if (proc) {
					await journalLog(
						tag,
						"[executor] restarting unresponsive managed instance\n",
						this.systemdCatPath,
					);
					try {
						await terminateCurrentProcess(proc);
					} catch (error) {
						setError(`process termination failed: ${shortError(error)}`);
					}
					try {
						await proc.exited;
					} catch {
						// The loop records an exit wait failure if Bun reports one.
					}
				}
				if (stopController.signal.aborted || isTerminal()) {
					settleRestartWaiter();
					return;
				}
				await completion;
			}).catch((error) => {
				settleRestartWaiter();
				setError(error);
			});
			restartPromise = restartPromise.finally(() => {
				restartPromise = null;
			});
			return restartPromise;
		};

		const stop = (): Promise<void> =>
			enqueueOperation(async () => {
				if (stopRequested) {
					await loopPromise;
					return;
				}
				stopRequested = true;
				setState("stopping");
				stopController.abort();
				retryWake?.();
				settleRestartWaiter();
				const proc = currentProc;
				if (proc) {
					await journalLog(
						tag,
						"[executor] stopping managed instance\n",
						this.systemdCatPath,
					);
					try {
						await terminateCurrentProcess(proc);
					} catch (error) {
						setError(`process termination failed: ${shortError(error)}`);
					}
					try {
						await proc.exited;
					} catch {
						// The process is already being terminated.
					}
				}
				await loopPromise;
				await removeInstanceState(instance.name);
				setState("stopped");
				snapshot.pid = 0;
				snapshot.startedAt = null;
				snapshot.nextRetryAt = null;
				this.notifyStateChange();
			});

		return {
			name: instance.name,
			get pid() {
				return currentProc?.pid ?? 0;
			},
			get running() {
				return snapshot.state === "running";
			},
			get state() {
				return snapshot.state;
			},
			get snapshot() {
				return copySnapshot(snapshot);
			},
			restart,
			stop,
		};
	}

	async isActive(name: string, cmd: string): Promise<boolean> {
		const pid = await readInstancePid(name);
		if (
			pid &&
			(await storedProcessMatches(name, pid, cmd))
		) {
			return true;
		}

		if (pid) await removeInstanceState(name);
		if (!cmd) return false;
		return userProcesses(this.psPath).some((entry) => entry.args.includes(cmd));
	}

	async instanceRuntimePids(name: string, cmd: string): Promise<number[]> {
		const pid = await readInstancePid(name);
		if (
			pid &&
			(await storedProcessMatches(name, pid, cmd))
		) {
			return collectDescendantPids(pid, this.psPath);
		}

		if (pid) await removeInstanceState(name);
		if (!cmd) return [];
		const match = userProcesses(this.psPath).find((entry) => entry.args.includes(cmd));
		return match ? collectDescendantPids(match.pid, this.psPath) : [];
	}

	async listeningAddresses(name: string, cmd: string): Promise<string[]> {
		const pids = await this.instanceRuntimePids(name, cmd);
		if (pids.length === 0) return [];

		const result = runText(
			[
				this.lsofPath,
				"-Pan",
				"-p",
				pids.join(","),
				"-iTCP",
				"-sTCP:LISTEN",
				"-Fn",
			],
			controlRunOptions,
		);
		requireControlSuccess("lsof", result, true);

		return result.stdout
			.split(/\r?\n/)
			.filter((line) => line.startsWith("n"))
			.map((line) => line.slice(1));
	}

	async runtimePort(name: string, cmd: string): Promise<string> {
		const addresses = await this.listeningAddresses(name, cmd);
		for (const address of addresses) {
			const match = address.match(/:(\d+)$/);
			if (match) return match[1];
		}
		return "";
	}

	/**
	 * Retained for CLI compatibility. External port occupants are intentionally
	 * never killed; the supervisor reports the conflict and blocks the instance.
	 */
	killProcessOnPort(port: string): void {
		try {
			const pids = this.portProcessIds(port);
			if (pids.length > 0) {
				console.error(
					`[executor] refusing to kill external port occupant on ${port}`,
				);
			}
		} catch (error) {
			console.error(
				`[executor] unable to inspect port ${port}: ${shortError(error)}`,
			);
		}
	}

	loggedPort(name: string): string {
		const result = runText(
			[
				"/usr/bin/journalctl",
				"--user",
				"-t",
				`executor/${name}`,
				"-n",
				"20",
				"--output=cat",
				"--no-pager",
			],
			controlRunOptions,
		);

		for (const line of result.stdout.split(/\r?\n/)) {
			const match = line.match(/localhost:(\d+)/);
			if (match) return match[1];
		}
		return "";
	}
}
