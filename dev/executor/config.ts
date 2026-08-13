import { basename } from "node:path";
import { mkdirSync, realpathSync, renameSync } from "node:fs";
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

	if (!(await Bun.file(configFile).exists())) {
		await Bun.write(configFile, "{}\n");
	}
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
	const raw = await readRuntimeControl();
	const restart = isObject(raw.restart)
		? { ...(raw.restart as JsonObject) }
		: {};
	restart[name] = token;
	raw.restart = restart;
	const tmpFile = `${controlFile}.${process.pid}.${Date.now()}`;
	await Bun.write(tmpFile, `${JSON.stringify(raw, null, 2)}\n`);
	renameSync(tmpFile, controlFile);
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
	const raw = (await readRawConfig()) as JsonObject;
	mutator(new ConfigMutator(raw));
	const tmpFile = `${configFile}.${process.pid}.${Date.now()}`;
	await Bun.write(tmpFile, `${JSON.stringify(raw, null, 2)}\n`);
	renameSync(tmpFile, configFile);
}
