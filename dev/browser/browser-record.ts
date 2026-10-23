import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { stateRootDir } from "./browser-state.ts";
import { processExists } from "./chrome-instance.ts";

type RecordStatus =
	| "starting"
	| "recording"
	| "completed"
	| "stopped"
	| "failed";

export type RecordState = {
	version: 1;
	port: number;
	tabIndex: number;
	framesRequested: number | null;
	framesCaptured: number;
	format: "png" | "jpeg";
	outputDir: string;
	pid?: number;
	status: RecordStatus;
	startedAt: string;
	updatedAt: string;
	stoppedAt?: string;
	lastFramePath?: string;
	error?: string;
};

export type RecordStartOptions = {
	port: number;
	tabIndex: number;
	frames: number | null;
	format: "png" | "jpeg";
	outputDir?: string;
};

function recordsDir(): string {
	return join(stateRootDir(), "records");
}

function capturesDir(): string {
	return join(stateRootDir(), "captures");
}

export function recordStatePath(port: number): string {
	return join(recordsDir(), `port-${port}.json`);
}

export function recordStopPath(port: number): string {
	return join(recordsDir(), `port-${port}.stop`);
}

async function readJsonFile<T>(path: string): Promise<T | null> {
	const file = Bun.file(path);
	if (!(await file.exists())) return null;
	return JSON.parse(await file.text()) as T;
}

export async function readRecordState(
	port: number,
): Promise<RecordState | null> {
	return await readJsonFile<RecordState>(recordStatePath(port));
}

export async function writeRecordState(state: RecordState): Promise<void> {
	await mkdir(recordsDir(), { recursive: true });
	await Bun.write(
		recordStatePath(state.port),
		`${JSON.stringify(state, null, 2)}\n`,
	);
}

export async function clearRecordState(port: number): Promise<void> {
	await unlink(recordStatePath(port)).catch((error) => {
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
	});
	await clearRecordStop(port);
}

export async function clearRecordStop(port: number): Promise<void> {
	await unlink(recordStopPath(port)).catch((error) => {
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
	});
}

export async function shouldStopRecording(port: number): Promise<boolean> {
	return await Bun.file(recordStopPath(port)).exists();
}

function isActive(state: RecordState | null): state is RecordState {
	return (
		!!state && (state.status === "starting" || state.status === "recording")
	);
}

export async function resolveRecordState(
	port: number,
): Promise<RecordState | null> {
	const state = await readRecordState(port);
	if (!isActive(state) || !state.pid) return state;
	if (processExists(state.pid)) return state;

	const failed: RecordState = {
		...state,
		status: "failed",
		updatedAt: new Date().toISOString(),
		stoppedAt: new Date().toISOString(),
		error: state.error ?? "Recorder process exited unexpectedly",
	};
	await writeRecordState(failed);
	await clearRecordStop(port);
	return failed;
}

function defaultOutputDir(port: number): string {
	return join(capturesDir(), `chrome-${port}-${Date.now()}`);
}

export async function startRecording(
	options: RecordStartOptions,
): Promise<RecordState> {
	const existing = await resolveRecordState(options.port);
	if (isActive(existing)) {
		throw new Error(
			`Recording is already active on port ${options.port}. Stop it first with: browser close --port ${options.port}`,
		);
	}

	if (
		options.frames !== null &&
		(!Number.isInteger(options.frames) || options.frames <= 0)
	) {
		throw new Error("--frames must be a positive integer");
	}

	const outputDir = options.outputDir ?? defaultOutputDir(options.port);
	await mkdir(outputDir, { recursive: true });
	await mkdir(recordsDir(), { recursive: true });
	await clearRecordStop(options.port);

	const now = new Date().toISOString();
	const initialState: RecordState = {
		version: 1,
		port: options.port,
		tabIndex: options.tabIndex,
		framesRequested: options.frames,
		framesCaptured: 0,
		format: options.format,
		outputDir,
		status: "starting",
		startedAt: now,
		updatedAt: now,
	};
	await writeRecordState(initialState);

	const scriptPath = new URL("./record-worker.ts", import.meta.url).pathname;
	const proc = Bun.spawn({
		cmd: [
			"bun",
			scriptPath,
			"--port",
			String(options.port),
			"--tab",
			String(options.tabIndex),
			...(options.frames === null
				? ["--until-stop"]
				: ["--frames", String(options.frames)]),
			"--format",
			options.format,
			"--output-dir",
			outputDir,
		],
		detached: true,
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	});
	proc.unref();

	const state = {
		...initialState,
		pid: proc.pid,
		updatedAt: new Date().toISOString(),
	};
	await writeRecordState(state);
	return state;
}

export async function stopRecording(
	port: number,
	timeoutMs = 4000,
): Promise<RecordState | null> {
	const current = await resolveRecordState(port);
	if (!isActive(current)) return current;

	await mkdir(recordsDir(), { recursive: true });
	await Bun.write(recordStopPath(port), "stop\n");

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const state = await resolveRecordState(port);
		if (!isActive(state)) return state;
		await Bun.sleep(100);
	}

	return await resolveRecordState(port);
}
