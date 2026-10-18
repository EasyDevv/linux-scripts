/**
 * Capability tiers: two ordered lists the person edits in `~/.config/decision/tiers.json`, one per
 * harness. model_route judges a demand on a fixed 0–3 scale; each harness takes the tier of its own
 * list whose band (from its `minDemand` to the next tier's) holds it, so pi and Claude Code keep
 * their own names and bands. Each list has the four default tiers; one switched off (`enabled:
 * false`) is skipped, its band going to the nearest tier still on (below it, else above). The
 * prompt and the evals never change with the file. `route.holdAboveTokens` is the cache policy every harness shares.
 */

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const TIERS_PATH = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "decision", "tiers.json");

/** model_route's demand scale: complexity and capability are judged 0–3. */
export const DEMAND_MAX = 3;

export const CLAUDE_ALIASES = ["haiku", "sonnet", "opus", "fable"] as const;

export interface PiRung {
	model: string;
	thinkingLevel?: string;
}

/** A band of demand: owns `minDemand` up to the next tier's; the first always starts at 0. */
export interface Band {
	name: string;
	minDemand: number;
	/** Off: routing skips the tier. Absent means on. */
	enabled?: boolean;
}

/** pi: a model ladder, the first rung first and the rest as fallbacks. */
export interface PiTier extends Band {
	models: PiRung[];
}

/** Claude Code: an Agent alias. Effort is model_route's (`effort`), not the tier's. */
export interface ClaudeTier extends Band {
	model: string;
}

export interface TiersFile {
	pi: PiTier[];
	claude: ClaudeTier[];
	route: { holdAboveTokens: number };
}

/** The four tiers model_route always had; `round(demand)` picked the same tier. */
export const DEFAULT_TIERS: TiersFile = {
	pi: [
		{ name: "quick", minDemand: 0, models: [] },
		{ name: "standard", minDemand: 0.5, models: [] },
		{ name: "high", minDemand: 1.5, models: [] },
		{ name: "premium", minDemand: 2.5, models: [] },
	],
	claude: [
		{ name: "quick", minDemand: 0, model: "haiku" },
		{ name: "standard", minDemand: 0.5, model: "sonnet" },
		{ name: "high", minDemand: 1.5, model: "opus" },
		{ name: "premium", minDemand: 2.5, model: "opus" },
	],
	route: { holdAboveTokens: 30_000 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const NAME = /^[a-z][a-z0-9-]{0,31}$/;

function parseRung(raw: unknown): PiRung | undefined {
	if (!isRecord(raw) || typeof raw.model !== "string" || !raw.model.includes("/")) return undefined;
	return typeof raw.thinkingLevel === "string"
		? { model: raw.model, thinkingLevel: raw.thinkingLevel }
		: { model: raw.model };
}

/** One harness's list: names unique, demand 0–3, sorted, the first at 0. */
function parseList<T extends Band>(
	label: string,
	raw: unknown,
	item: (entry: Record<string, unknown>, band: Band) => T | string,
): T[] | string {
	if (!Array.isArray(raw) || raw.length === 0) return `${label} needs at least one tier`;
	const list: T[] = [];
	for (const entry of raw) {
		if (!isRecord(entry) || typeof entry.name !== "string" || !NAME.test(entry.name))
			return `${label}: each tier needs a lowercase name`;
		if (list.some((t) => t.name === entry.name)) return `${label}: duplicate tier ${entry.name}`;
		const minDemand = entry.minDemand;
		if (typeof minDemand !== "number" || !Number.isFinite(minDemand) || minDemand < 0 || minDemand > DEMAND_MAX)
			return `${label} ${entry.name}: minDemand must be 0–${DEMAND_MAX}`;
		if (entry.enabled !== undefined && typeof entry.enabled !== "boolean")
			return `${label} ${entry.name}: enabled must be true or false`;
		const band: Band = entry.enabled === false ? { name: entry.name, minDemand, enabled: false } : { name: entry.name, minDemand };
		const parsed = item(entry, band);
		if (typeof parsed === "string") return `${label} ${entry.name}: ${parsed}`;
		list.push(parsed);
	}
	list.sort((a, b) => a.minDemand - b.minDemand);
	if (list[0].minDemand !== 0) return `${label}: the lowest tier must start at minDemand 0`;
	if (!list.some(isOn)) return `${label}: keep at least one tier on`;
	return list;
}

function piTier(entry: Record<string, unknown>, band: Band): PiTier | string {
	const models = Array.isArray(entry.models) ? entry.models.map(parseRung) : [];
	if (models.some((r) => r === undefined)) return "models need a provider/model";
	return { ...band, models: models as PiRung[] };
}

function claudeTier(entry: Record<string, unknown>, band: Band): ClaudeTier | string {
	const model = entry.model;
	if (typeof model !== "string" || !(CLAUDE_ALIASES as readonly string[]).includes(model))
		return `model must be ${CLAUDE_ALIASES.join(", ")}`;
	return { ...band, model };
}

/** Before the split one list held both: `{name, minDemand, pi: [rung], claude: alias|null}`. */
function splitLegacy(raw: Record<string, unknown>): Record<string, unknown> {
	if (!Array.isArray(raw.tiers)) return raw;
	const tiers = raw.tiers.filter(isRecord);
	return {
		...raw,
		pi: tiers.map((t) => ({ name: t.name, minDemand: t.minDemand, models: t.pi })),
		claude: tiers.filter((t) => typeof t.claude === "string").map((t) => ({ name: t.name, minDemand: t.minDemand, model: t.claude })),
	};
}

/**
 * Validate a tiers document (the split one, or the legacy single list). A string is the reason it
 * was refused; the caller keeps the defaults (daemon) or answers 400 (dashboard).
 */
export function parseTiers(input: unknown): TiersFile | string {
	if (!isRecord(input)) return "tiers must be an object";
	const raw = splitLegacy(input);
	const pi = parseList("pi", raw.pi, piTier);
	if (typeof pi === "string") return pi;
	const claude = parseList("claude", raw.claude, claudeTier);
	if (typeof claude === "string") return claude;
	const route = isRecord(raw.route) ? raw.route : {};
	const hold = route.holdAboveTokens;
	return {
		pi,
		claude,
		route: {
			holdAboveTokens:
				typeof hold === "number" && Number.isFinite(hold) && hold >= 0 ? hold : DEFAULT_TIERS.route.holdAboveTokens,
		},
	};
}

let cached: { mtimeMs: number; path: string; value: TiersFile } | undefined;

/** The file as of its last change; a missing or invalid file gives the defaults. */
export function loadTiers(path = TIERS_PATH): TiersFile {
	let mtimeMs: number;
	try {
		mtimeMs = statSync(path).mtimeMs;
	} catch {
		return DEFAULT_TIERS;
	}
	if (cached && cached.path === path && cached.mtimeMs === mtimeMs) return cached.value;
	let value = DEFAULT_TIERS;
	try {
		const parsed = parseTiers(JSON.parse(readFileSync(path, "utf8")));
		if (typeof parsed !== "string") value = parsed;
	} catch {
		// Defaults.
	}
	cached = { mtimeMs, path, value };
	return value;
}

export function isOn(tier: Band): boolean {
	return tier.enabled !== false;
}

/** The tier of `list` (sorted, the first at 0) whose band holds `demand`; a tier switched off hands
 *  its band to the nearest one on below it, else the lowest one on. */
export function tierFor<T extends Band>(demand: number, list: readonly T[]): T {
	const on = list.filter(isOn);
	let pick = on[0] ?? list[0];
	for (const tier of on) if (demand >= tier.minDemand) pick = tier;
	return pick;
}
