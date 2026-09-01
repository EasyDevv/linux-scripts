import { basename } from "node:path";
import {
	closeSync,
	fsyncSync,
	linkSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	statSync,
	renameSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import {
	configDir,
	configFile,
	controlFile,
	controlKey,
	expandHome,
	stateDir,
} from "./paths";
import type { NormalizedConfig, NormalizedInstance } from "./types";
import { fail, extractPort } from "./utils";

type JsonObject = Record<string, unknown>;
type RawInstance = JsonObject;

const lockTimeoutMs = 2_000;
const lockStaleMs = 30_000;
const lockRetryMs = 25;

type LockRecord = {
	pid: number;
	createdAt: number;
	token: string | null;
};

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process exists but is not signalable by this user;
		// treating it as dead could let a writer steal a live lock.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function lockFileFor(path: string): string {
	return `${path}.lock`;
}

function readLockRecord(path: string): LockRecord | null {
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as {
			pid?: unknown;
			createdAt?: unknown;
			token?: unknown;
		};
		if (
			typeof raw.pid !== "number" ||
			!Number.isInteger(raw.pid) ||
			raw.pid <= 0 ||
			typeof raw.createdAt !== "number" ||
			!Number.isFinite(raw.createdAt)
		) {
			return null;
		}
		return {
			pid: raw.pid,
			createdAt: raw.createdAt,
			token:
				typeof raw.token === "string" && raw.token.length > 0
					? raw.token
					: null,
		};
	} catch {
		return null;
	}
}

function lockAgeMs(path: string): number {
	try {
		return Math.max(0, Date.now() - statSync(path).mtimeMs);
	} catch {
		return 0;
	}
}

function staleLock(path: string): boolean {
	const record = readLockRecord(path);
	if (record) {
		// A live owner may legitimately hold the lock longer than the stale
		// threshold while it is writing a large or slow-to-read file.
		return !isProcessAlive(record.pid);
	}

	// The lock is created with a fully-written temporary record and a hard
	// link, so malformed content is only considered stale after it has had
	// time to be an abandoned file rather than a writer in the creation step.
	return lockAgeMs(path) > lockStaleMs;
}

function releaseLock(lockPath: string, token: string): void {
	const record = readLockRecord(lockPath);
	if (
		!record ||
		record.pid !== process.pid ||
		record.token !== token
	) {
		return;
	}

	try {
		unlinkSync(lockPath);
	} catch {
		// The stale-lock cleanup may have removed it already.
	}
}

async function acquireLock(path: string): Promise<() => void> {
	const lockPath = lockFileFor(path);
	const deadline = Date.now() + lockTimeoutMs;

	while (Date.now() < deadline) {
		const token = Bun.randomUUIDv7();
		const tmpPath = `${lockPath}.${process.pid}.${token}.tmp`;
		let fd: number | null = null;
		try {
			fd = openSync(tmpPath, "wx", 0o600);
			writeSync(
				fd,
				Buffer.from(
					JSON.stringify({ pid: process.pid, createdAt: Date.now(), token }),
				),
			);
			fsyncSync(fd);
			closeSync(fd);
			fd = null;

			try {
				// Linking a complete temporary file makes the lock record visible
				// atomically; contenders never see a half-written owner record.
				linkSync(tmpPath, lockPath);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
					throw error;
				}
				if (staleLock(lockPath)) {
					try {
						unlinkSync(lockPath);
					} catch {
						// Another writer may have won the stale-lock race.
					}
					continue;
				}
				await Bun.sleep(lockRetryMs);
				continue;
			}

			return () => releaseLock(lockPath, token);
		} finally {
			if (fd !== null) {
				closeSync(fd);
			}
			try {
				unlinkSync(tmpPath);
			} catch {
				// The hard link remains the owned lock name.
			}
		}
	}

	fail(`Timed out waiting for config lock: ${path}`);
}

async function withFileLock<T>(
	path: string,
	operation: () => Promise<T>,
): Promise<T> {
	const release = await acquireLock(path);
	try {
		return await operation();
	} finally {
		release();
	}
}

async function atomicWrite(path: string, content: string): Promise<void> {
	const tmpPath = `${path}.${process.pid}.${Date.now()}.${Math.random()
		.toString(36)
		.slice(2)}.tmp`;
	try {
		await Bun.write(tmpPath, content);
		const fd = openSync(tmpPath, "r");
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		renameSync(tmpPath, path);
	} finally {
		try {
			unlinkSync(tmpPath);
		} catch {
			// The rename already removed the temporary name.
		}
	}
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string, path: string): JsonObject {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		fail(`Invalid config file: ${path}`);
	}

	if (!isObject(parsed)) {
		fail(`Top-level config must be an object (${path})`);
	}

	return parsed;
}

function parseConfig(text: string): JsonObject {
	return parseJsonObject(text, configFile);
}

function controlObject(raw: JsonObject): JsonObject {
	const control = raw[controlKey];
	if (control === undefined) {
		return {};
	}

	if (!isObject(control)) {
		fail(`${controlKey} must be an object`);
	}

	return control;
}

function instanceEnabled(name: string, value: RawInstance): boolean {
	if (value.enabled === undefined) {
		return true;
	}

	if (typeof value.enabled !== "boolean") {
		fail(`enabled must be a boolean when present (${name})`);
	}

	return value.enabled;
}

function normalizeInstance(
	name: string,
	value: RawInstance,
): NormalizedInstance {
	const dir = value.dir ?? value.DIR;
	const cmd = value.cmd ?? value.CMD;

	if (typeof dir !== "string" || dir.length === 0) {
		fail(`Missing string dir for ${name}`);
	}

	if (typeof cmd !== "string" || cmd.length === 0) {
		fail(`Missing string cmd for ${name}`);
	}

	const env: Record<string, string> = {};
	for (const [key, rawValue] of Object.entries(value)) {
		if (
			key === "dir" ||
			key === "DIR" ||
			key === "cmd" ||
			key === "CMD" ||
			key === "enabled"
		) {
			continue;
		}

		env[key] = String(rawValue);
	}

	return {
		name,
		dir: expandHome(dir),
		cmd,
		enabled: instanceEnabled(name, value),
		env,
	};
}

export async function ensureConfigFile(): Promise<void> {
	mkdirSync(configDir, { recursive: true });

	if (await Bun.file(configFile).exists()) {
		return;
	}

	await withFileLock(configFile, async () => {
		if (!(await Bun.file(configFile).exists())) {
			await atomicWrite(configFile, "{}\n");
		}
	});
}

async function readRawConfig(required = true): Promise<JsonObject | null> {
	await ensureConfigFile();

	const file = Bun.file(configFile);
	if (!(await file.exists())) {
		if (required) {
			fail(`Missing config file: ${configFile}`);
		}
		return null;
	}

	return parseConfig(await file.text());
}

async function readRuntimeControl(): Promise<JsonObject> {
	mkdirSync(stateDir, { recursive: true });
	const file = Bun.file(controlFile);
	if (!(await file.exists())) {
		return {};
	}
	return parseJsonObject(await file.text(), controlFile);
}

export async function readConfig(
	required = true,
): Promise<NormalizedConfig | null> {
	const raw = await readRawConfig(required);
	if (!raw) return null;
	return normalizeConfig(raw, await readRuntimeControl());
}

function safeRealpath(value: string): string {
	try {
		return realpathSync(value);
	} catch {
		return value;
	}
}

function normalizeConfig(
	raw: JsonObject,
	runtimeControl: JsonObject = {},
): NormalizedConfig {
	const control = controlObject(raw);
	const disabledValue = control.disabled ?? [];
	if (control.restart !== undefined && !isObject(control.restart)) {
		fail(`${controlKey}.restart must be an object`);
	}
	if (
		runtimeControl.restart !== undefined &&
		!isObject(runtimeControl.restart)
	) {
		fail(`${controlFile}.restart must be an object`);
	}
	const restartValue = {
		...(isObject(control.restart) ? control.restart : {}),
		...(isObject(runtimeControl.restart) ? runtimeControl.restart : {}),
	};

	if (
		!Array.isArray(disabledValue) ||
		!disabledValue.every((item) => typeof item === "string")
	) {
		fail(`${controlKey}.disabled must contain only strings`);
	}

	const instances = new Map<string, NormalizedInstance>();
	const disabled = new Set<string>(disabledValue);

	for (const [name, value] of Object.entries(raw)) {
		if (name === controlKey) {
			continue;
		}

		if (!isObject(value)) {
			fail(`Invalid config entry for ${name}`);
		}

		const instance = normalizeInstance(name, value as RawInstance);
		if (!instance.enabled) {
			disabled.add(name);
		}
		instances.set(name, instance);
	}

	const restartTokens = new Map<string, string>();
	for (const [name, value] of Object.entries(restartValue)) {
		restartTokens.set(name, String(value));
	}

	return {
		instances,
		disabled,
		restartTokens,

		getInstance(name: string): NormalizedInstance {
			const instance = instances.get(name);
			if (!instance) fail(`Unknown executor item: ${name}`);
			return instance;
		},

		hasInstance(name: string): boolean {
			return instances.has(name);
		},

		isEnabled(name: string): boolean {
			return !disabled.has(name);
		},

		getPort(name: string): string {
			const instance = instances.get(name);
			if (!instance) return "";
			return extractPort(instance.cmd);
		},

		instanceMatchingCwd(): string | null {
			const pwd = safeRealpath(process.cwd());
			const cwdBase = basename(pwd);

			if (instances.has(cwdBase)) return cwdBase;

			for (const [name, instance] of instances) {
				if (safeRealpath(instance.dir) === pwd) return name;
			}

			for (const [name, instance] of instances) {
				if (basename(instance.dir) === cwdBase) return name;
			}

			return null;
		},
	};
}

export class ConfigMutator {
	constructor(private raw: JsonObject) {}

	setEnabled(name: string, enabled: boolean): void {
		const instance = getRawInstanceInternal(this.raw, name);
		if (!instance) {
			fail(`Unknown executor item: ${name}`);
		}
		instance.enabled = enabled;

		if (!enabled) return;

		const control = controlObject(this.raw);
		if (control.disabled === undefined) return;
		if (
			!Array.isArray(control.disabled) ||
			!control.disabled.every((item) => typeof item === "string")
		) {
			fail(`${controlKey}.disabled must contain only strings`);
		}

		this.raw[controlKey] = {
			...control,
			disabled: (control.disabled as string[]).filter(
				(item) => item !== name,
			),
		};
	}

	setRestartToken(name: string, token: string): void {
		getRawInstanceInternal(this.raw, name);
		const control = controlObject(this.raw);
		const restart = isObject(control.restart)
			? { ...(control.restart as JsonObject) }
			: {};
		restart[name] = token;
		this.raw[controlKey] = { ...control, restart };
		delete (this.raw[controlKey] as JsonObject).disabled;
	}
}

export async function writeRestartToken(
	name: string,
	token: string,
): Promise<void> {
	mkdirSync(stateDir, { recursive: true });
	await withFileLock(controlFile, async () => {
		const raw = await readRuntimeControl();
		const restart = isObject(raw.restart)
			? { ...(raw.restart as JsonObject) }
			: {};
		restart[name] = token;
		raw.restart = restart;
		await atomicWrite(controlFile, `${JSON.stringify(raw, null, 2)}\n`);
	});
}

function getRawInstanceInternal(
	raw: JsonObject,
	name: string,
): RawInstance | null {
	if (name === controlKey) {
		fail(`Reserved name: ${name}`);
	}

	const value = raw[name];
	return isObject(value) ? (value as RawInstance) : null;
}

export async function writeConfig(
	mutator: (m: ConfigMutator) => void,
): Promise<void> {
	await ensureConfigFile();
	await withFileLock(configFile, async () => {
		const raw = (await readRawConfig()) as JsonObject;
		mutator(new ConfigMutator(raw));
		await atomicWrite(configFile, `${JSON.stringify(raw, null, 2)}\n`);
	});
}
