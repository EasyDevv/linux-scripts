export class CliError extends Error {
	constructor(
		message: string,
		readonly exitCode = 1,
	) {
		super(message);
	}
}

export function fail(message: string, exitCode = 1): never {
	throw new CliError(message, exitCode);
}

export function shellQuote(value: string): string {
	if (value.length === 0) {
		return "''";
	}

	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
		return value;
	}

	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function extractPort(cmd: string): string {
	if (!cmd) return "";
	const webMatch = cmd.match(/--web-port[=\s]+(\d+)/);
	if (webMatch) return webMatch[1];
	const clientMatch = cmd.match(/--client-port[=\s]+(\d+)/);
	if (clientMatch) return clientMatch[1];
	const portMatch = cmd.match(/--port[=\s]+(\d+)/);
	if (portMatch) return portMatch[1];
	return "";
}

export function printCommand(args: string[]): void {
	console.log(`▶ ${args.map(shellQuote).join(" ")}`);
}

export interface RunOptions {
	cwd?: string;
	env?: Record<string, string>;
	stdin?: Bun.SpawnOptions.Writable;
	timeoutMs?: number;
	maxBuffer?: number;
}

export interface RunResult {
	ok: boolean;
	/** Kept as an alias for callers that used the original result shape. */
	success: boolean;
	exitCode: number | null;
	signalCode: string | null;
	stdout: string;
	stderr: string;
	spawnError: unknown | null;
	timedOut: boolean;
	outputOverflow: boolean;
}

const defaultRunTimeoutMs = 2_000;
const defaultRunMaxBuffer = 1 * 1024 * 1024;
const journalFailureReportedAt = new Map<string, number>();
const journalFailureRateLimitMs = 60_000;

function decode(buffer: Uint8Array | undefined): string {
	return buffer ? new TextDecoder().decode(buffer) : "";
}

function errorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function runText(
	args: string[],
	options: RunOptions = {},
): RunResult {
	try {
		const proc = Bun.spawnSync(args, {
			cwd: options.cwd,
			env: options.env,
			stdin: options.stdin,
			stdout: "pipe",
			stderr: "pipe",
			timeout: options.timeoutMs ?? defaultRunTimeoutMs,
			maxBuffer: options.maxBuffer ?? defaultRunMaxBuffer,
		});
		const exitCode = proc.exitCode ?? null;
		const signalCode = proc.signalCode ?? null;
		const success = proc.success && exitCode === 0;
		return {
			ok: success,
			success,
			exitCode,
			signalCode,
			stdout: decode(proc.stdout),
			stderr: decode(proc.stderr),
			spawnError: null,
			timedOut: proc.exitedDueToTimeout === true,
			outputOverflow: proc.exitedDueToMaxBuffer === true,
		};
	} catch (spawnError) {
		return {
			ok: false,
			success: false,
			exitCode: null,
			signalCode: null,
			stdout: "",
			stderr: "",
			spawnError,
			timedOut: false,
			outputOverflow: false,
		};
	}
}

export async function runInherit(
	args: string[],
	options: RunOptions = {},
): Promise<number> {
	try {
		const proc = Bun.spawn(args, {
			cwd: options.cwd,
			env: options.env,
			stdin: options.stdin,
			stdout: "inherit",
			stderr: "inherit",
			timeout: options.timeoutMs,
			maxBuffer: options.maxBuffer,
		});

		const exitCode = await proc.exited;
		return exitCode ?? 1;
	} catch (error) {
		console.error(`[executor] unable to run ${args[0] ?? "subprocess"}: ${errorText(error)}`);
		return 1;
	}
}

export async function journalLog(
	tag: string,
	message: string,
	commandPath = "/usr/bin/systemd-cat",
): Promise<void> {
	try {
		const proc = Bun.spawn([commandPath, "-t", tag], {
			stdin: Buffer.from(message),
			stdout: "ignore",
			stderr: "ignore",
			timeout: defaultRunTimeoutMs,
			maxBuffer: defaultRunMaxBuffer,
		});
		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			throw new Error(`exited with code ${exitCode}`);
		}
	} catch (error) {
		const now = Date.now();
		const lastReported = journalFailureReportedAt.get(commandPath) ?? 0;
		if (now - lastReported < journalFailureRateLimitMs) return;

		journalFailureReportedAt.set(commandPath, now);
		console.error(
			`[executor] journal logging unavailable; falling back to supervisor stderr (${errorText(error)})`,
		);
		const fallback = message.trimEnd();
		if (fallback) console.error(`[${tag}] ${fallback}`);
	}
}

export function formatSince(date = new Date(Date.now() - 1_000)): string {
	return date.toISOString();
}

export async function sleepMs(ms: number): Promise<void> {
	await Bun.sleep(ms);
}

export function splitLines(value: string): string[] {
	return value.replace(/\r/g, "").split("\n");
}

export function pad(value: string, width: number): string {
	return value.padEnd(width, " ");
}
