/**
 * find_tool: which switched-off tools the next steps will need.
 *
 * One batched Jev call over the jev-eval-agent state (`user_request`, `actions_taken`,
 * `assistant_said`): a choice over the inactive tools (plus "none"), a gate bool, and the `done`
 * bool. Code turns that into an additive top-k list. It never switches anything off, never touches
 * the always-on core tools (the harness does not pass them), and `done` is advice only.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClassifierAnswer, ClassifierQuestion, JsonObject } from "@earendil-works/pi-ai";
import type { DecideRequest, Decision } from "../engine.ts";
import { skipReason } from "./model-route.ts";
import { type FeatureDef, type FeatureResult, isRecord, num, str, strings } from "./types.ts";

export interface ToolPrompt {
	version: string;
	noneLabel: string;
	noneDescription: string;
	questions: Record<
		"next_tool" | "needs_extra_tool" | "done",
		{ type: ClassifierQuestion["type"]; instructions: string; criteria?: unknown }
	>;
	compose: {
		threshold: number;
		gate: number;
		topK: number;
		maxInactive: number;
		descriptionChars: number;
		resultChars: number;
		saidChars: number;
		maxActions: number;
		maxSaid: number;
		/** v2+: `none` at or above this activates nothing, whatever the tools scored. */
		noneCeiling?: number;
		/**
		 * v6+: a best candidate at or above this overrides a failed `needs_extra_tool` gate: the
		 * gate answers "is a specialised capability required at all", the choice answers "which
		 * tool, and how sure"; a confident choice is the more specific signal, so it wins.
		 */
		gateOverride?: number;
		/**
		 * v2+: tools used together (`browser_*` is a name prefix). One member passing the threshold
		 * brings the other offered members along, within `topK`.
		 */
		families?: string[][];
	};
}

export function loadToolPrompt(version = "v1", dir = join(import.meta.dir, "..", "prompts", "find_tool")): ToolPrompt {
	return JSON.parse(readFileSync(join(dir, `${version}.json`), "utf8")) as ToolPrompt;
}

export interface InactiveTool {
	name: string;
	description: string;
}

export interface ToolInput {
	userRequest: string;
	actionsTaken: string[];
	assistantSaid: string[];
	inactive: InactiveTool[];
	topK?: number;
	harness?: string;
	sessionId?: string;
}

export interface ToolResult extends FeatureResult {
	activate: { name: string; p: number }[];
	done?: number;
}

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Inactive tools the question can name: unique, not the none label, capped. */
function candidates(input: ToolInput, prompt: ToolPrompt): InactiveTool[] {
	const seen = new Set<string>([prompt.noneLabel]);
	const out: InactiveTool[] = [];
	for (const tool of input.inactive) {
		if (seen.has(tool.name)) continue;
		seen.add(tool.name);
		out.push(tool);
		if (out.length >= prompt.compose.maxInactive) break;
	}
	return out;
}

export function buildRequest(input: ToolInput, prompt: ToolPrompt): DecideRequest {
	const c = prompt.compose;
	const criteria: Record<string, string> = {
		[prompt.noneLabel]: prompt.noneDescription,
	};
	for (const tool of candidates(input, prompt))
		criteria[tool.name] = clip(tool.description || tool.name, c.descriptionChars);
	const q = prompt.questions;
	const questions: Record<string, ClassifierQuestion> = {
		next_tool: { type: "choice", instructions: q.next_tool.instructions, criteria },
		needs_extra_tool: q.needs_extra_tool as ClassifierQuestion,
		done: q.done as ClassifierQuestion,
	};
	const state: JsonObject = {
		user_request: input.userRequest,
		actions_taken: input.actionsTaken.slice(-c.maxActions).map((a) => clip(a, c.resultChars)),
		assistant_said: input.assistantSaid.slice(-c.maxSaid).map((s) => clip(s, c.saidChars)),
	};
	return {
		feature: "find_tool",
		version: prompt.version,
		state,
		questions,
		harness: input.harness,
		sessionId: input.sessionId,
	};
}

function inFamily(name: string, family: readonly string[]): boolean {
	return family.some((member) => (member.endsWith("*") ? name.startsWith(member.slice(0, -1)) : name === member));
}

/** Offered tools sharing a family with an activated one, most-likely activation first. */
export function companions(
	activate: readonly { name: string }[],
	known: ReadonlySet<string>,
	families: readonly (readonly string[])[],
): string[] {
	const chosen = new Set(activate.map((a) => a.name));
	const out: string[] = [];
	for (const { name } of activate) {
		for (const family of families) {
			if (!inFamily(name, family)) continue;
			for (const other of known) {
				if (!chosen.has(other) && inFamily(other, family)) {
					chosen.add(other);
					out.push(other);
				}
			}
		}
	}
	return out;
}

export function compose(
	answers: Record<string, ClassifierAnswer>,
	input: ToolInput,
	prompt: ToolPrompt,
): Pick<ToolResult, "activate" | "done" | "reason" | "notes"> {
	const c = prompt.compose;
	const topK = Math.min(10, Math.max(1, Math.floor(input.topK ?? c.topK)));
	const choice = answers.next_tool;
	const probabilities = choice?.type === "choice" ? choice.probabilities : {};
	const needs = answers.needs_extra_tool?.type === "bool" ? answers.needs_extra_tool.probability : undefined;
	const doneAnswer = answers.done;
	const done = doneAnswer?.type === "bool" ? Math.round(doneAnswer.probability * 1000) / 1000 : undefined;
	const notes: string[] = [];
	const known = new Set(candidates(input, prompt).map((t) => t.name));

	const none = probabilities[prompt.noneLabel];
	const best = Object.entries(probabilities)
		.filter(([name]) => known.has(name))
		.sort((a, b) => b[1] - a[1])[0];
	const override = c.gateOverride !== undefined && best !== undefined && best[1] >= c.gateOverride;
	let activate: { name: string; p: number }[] = [];
	if (needs !== undefined && needs < c.gate && !override) {
		notes.push(`needs_extra_tool ${needs.toFixed(2)} < ${c.gate} → none`);
	} else if (c.noneCeiling !== undefined && none !== undefined && none >= c.noneCeiling) {
		notes.push(`none ${none.toFixed(2)} ≥ ${c.noneCeiling} → none`);
	} else {
		if (override && needs !== undefined && needs < c.gate)
			notes.push(`needs_extra_tool ${needs.toFixed(2)} < ${c.gate}, overridden by ${best?.[0]} ${best?.[1].toFixed(2)} ≥ ${c.gateOverride}`);
		activate = Object.entries(probabilities)
			.filter(([name, p]) => known.has(name) && p >= c.threshold)
			.sort((a, b) => b[1] - a[1])
			.slice(0, topK)
			.map(([name, p]) => ({ name, p: Math.round(p * 1000) / 1000 }));
		for (const companion of companions(activate, known, c.families ?? [])) {
			if (activate.length >= topK) break;
			activate.push({ name: companion, p: Math.round((probabilities[companion] ?? 0) * 1000) / 1000 });
			notes.push(`${companion} joins its family`);
		}
	}
	const reason = `${activate.length ? `activate ${activate.map((a) => a.name).join(", ")}` : "no extra tool"} · none ${(none ?? 0).toFixed(2)} · needs ${(needs ?? 0).toFixed(2)} · done ${(done ?? 0).toFixed(2)}`;
	return { activate, done, reason, notes };
}

export async function recommendTools(
	input: ToolInput,
	decide: (request: DecideRequest) => Promise<Decision>,
	prompt: ToolPrompt,
): Promise<ToolResult> {
	const skip = skipReason({ prompt: input.userRequest });
	if (skip) return { status: "skipped", reason: skip, notes: [], activate: [] };
	if (candidates(input, prompt).length === 0)
		return { status: "skipped", reason: "no inactive tools", notes: [], activate: [] };
	const decision = await decide(buildRequest(input, prompt));
	if (decision.status !== "ok") {
		return {
			decisionId: decision.decisionId,
			status: "unavailable",
			reason: "no backend answered",
			notes: decision.skipped,
			activate: [],
		};
	}
	return {
		decisionId: decision.decisionId,
		status: "routed",
		...compose(decision.answers, input, prompt),
		backend: decision.backend,
		calibrated: decision.calibrated,
		latencyMs: decision.latencyMs,
	};
}

function parseToolInput(b: Record<string, unknown>): ToolInput | string {
	const userRequest = str(b.userRequest);
	if (userRequest === undefined) return "userRequest is required";
	if (!Array.isArray(b.inactive)) return "inactive must be an array of {name, description}";
	const inactive: InactiveTool[] = [];
	for (const item of b.inactive) {
		if (!isRecord(item) || !str(item.name)) return "inactive entries need a name";
		inactive.push({ name: item.name as string, description: str(item.description) ?? "" });
	}
	if (b.actionsTaken !== undefined && !strings(b.actionsTaken)) return "actionsTaken must be an array of strings";
	if (b.assistantSaid !== undefined && !strings(b.assistantSaid)) return "assistantSaid must be an array of strings";
	return {
		userRequest,
		actionsTaken: strings(b.actionsTaken) ?? [],
		assistantSaid: strings(b.assistantSaid) ?? [],
		inactive,
		topK: num(b.topK),
		harness: str(b.harness),
		sessionId: str(b.sessionId),
	};
}

export const findTool: FeatureDef = {
	name: "find_tool",
	path: "/v1/find_tool",
	load(version) {
		const prompt = loadToolPrompt(version);
		return {
			version: prompt.version,
			parse: parseToolInput,
			run: (input, decide) => recommendTools(input as ToolInput, decide, prompt),
		};
	},
	/** `expected` is the list of tool names that should be activated (empty: none). */
	score(expected, result): Record<string, number> {
		if (!Array.isArray(expected)) return {};
		const want = new Set(expected.filter((v): v is string => typeof v === "string"));
		if (result.status !== "routed") return { answered: 0, recall: 0, precision: 0, exact: 0, falseActivation: 0 };
		const got = ((result.activate as { name: string }[] | undefined) ?? []).map((a) => a.name);
		const hit = got.filter((n) => want.has(n)).length;
		return {
			answered: 1,
			recall: want.size ? hit / want.size : 1,
			precision: got.length ? hit / got.length : 1,
			exact: Number(got.length === want.size && hit === want.size),
			falseActivation: Number(want.size === 0 && got.length > 0),
		};
	},
};
