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
	stdin?: ArrayBufferView | Blob | string;
}

function decode(buffer: Uint8Array | undefined): string {
	return buffer ? new TextDecoder().decode(buffer) : "";
}

export function runText(args: string[], options: RunOptions = {}) {
	const proc = Bun.spawnSync(args, {
		cwd: options.cwd,
		env: options.env,
		stdin: options.stdin,
		stdout: "pipe",
		stderr: "pipe",
	});

	return {
		success: proc.exitCode === 0,
		exitCode: proc.exitCode,
		stdout: decode(proc.stdout),
		stderr: decode(proc.stderr),
	};
}

export async function runInherit(
	args: string[],
	options: RunOptions = {},
): Promise<number> {
	const proc = Bun.spawn(args, {
		cwd: options.cwd,
		env: options.env,
		stdin: options.stdin,
		stdout: "inherit",
		stderr: "inherit",
	});

	return await proc.exited;
}

export async function journalLog(tag: string, message: string): Promise<void> {
	const proc = Bun.spawn(["/usr/bin/systemd-cat", "-t", tag], {
		stdin: Buffer.from(message),
		stdout: "ignore",
		stderr: "ignore",
	});

	await proc.exited;
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
