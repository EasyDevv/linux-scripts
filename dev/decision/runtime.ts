/**
 * Daemon configuration and the engine wiring shared by `decision serve` and `decision eval`,
 * so an eval run asks the same backends with the same budget and log as the live daemon.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PiAuthStore } from "./auth.ts";
import { BackendLadder, PiModels } from "./backends.ts";
import { type Backend, Engine } from "./engine.ts";
import { FileBudget, FileLog } from "./state.ts";

export const DEFAULT_PORT = 45130;
export const CONFIG_PATH = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "decision", "config.json");

export interface DaemonConfig {
	port: number;
	dailyBudgetUsd: number;
	cacheTtlSec: number;
	timeoutMs: number;
	/** Explicit ladder, tried in order; omitted → the newest OpenRouter Jev. */
	backends?: Backend[];
	/** Prompt version per feature (the `current` pointer `decision promote` moves); missing → v1. */
	prompts: Record<string, string>;
}

export function readConfig(path = CONFIG_PATH): DaemonConfig {
	let raw: Partial<DaemonConfig> = {};
	try {
		raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DaemonConfig>;
	} catch {
		// Defaults below.
	}
	return {
		port: raw.port ?? DEFAULT_PORT,
		dailyBudgetUsd: raw.dailyBudgetUsd ?? 0.5,
		cacheTtlSec: raw.cacheTtlSec ?? 600,
		timeoutMs: raw.timeoutMs ?? 4_000,
		backends: raw.backends,
		prompts: { ...raw.prompts },
	};
}

export function promptVersion(config: DaemonConfig, feature: string): string {
	return config.prompts[feature] ?? "v1";
}

export function createRuntime(config: DaemonConfig, log = new FileLog()) {
	const auth = new PiAuthStore();
	const ladder = new BackendLadder(config.backends);
	const budget = new FileBudget(config.dailyBudgetUsd);
	const engine = new Engine({
		models: new PiModels(auth),
		backends: () => ladder.list(),
		budget,
		log,
		cacheTtlMs: config.cacheTtlSec * 1000,
		timeoutMs: config.timeoutMs,
	});
	return { auth, ladder, budget, engine, log };
}
