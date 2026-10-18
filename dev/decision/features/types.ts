/**
 * The shape every decision feature exposes, so the server, `decision eval`, and `decision audit`
 * treat model_route, find_skill, find_tool, and orchestrator the same way.
 *
 * A feature owns its HTTP body parsing, its versioned question file
 * (`prompts/<name>/vN.json`), its composition from answers to a recommendation, and its eval
 * metric. It never applies anything: the harness does.
 */

import type { DecideRequest, Decision } from "../engine.ts";

export type Decide = (request: DecideRequest) => Promise<Decision>;

/** Every feature result carries these; the rest is feature-specific. */
export interface FeatureResult {
	decisionId?: string;
	status: "routed" | "skipped" | "unavailable";
	reason: string;
	notes: string[];
	backend?: string;
	calibrated?: boolean;
	latencyMs?: number;
	[key: string]: unknown;
}

export interface FeatureRuntime {
	/** Prompt version this runtime loaded (`v1`). */
	version: string;
	/** Validate an HTTP/eval body; a string is the 400 message. */
	parse(body: Record<string, unknown>): unknown;
	run(input: unknown, decide: Decide): Promise<FeatureResult>;
}

export interface FeatureDef {
	/** Log and prompt-folder name: `model_route`, `find_skill`, `find_tool`, `orchestrator`. */
	name: string;
	/** HTTP route, `/v1/<name>`. */
	path: string;
	load(version: string): FeatureRuntime;
	/**
	 * One eval case: numbers in 0..1 (or counts) averaged across cases by `decision eval`.
	 * `expected` is the case's label as written in `evals/<name>.jsonl`.
	 */
	score(expected: unknown, result: FeatureResult): Record<string, number>;
	/** Whether the server logs this result; omitted logs every one. A per-tool-call feature skips the clear ones. */
	logs?(result: FeatureResult): boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function strings(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : undefined;
}
