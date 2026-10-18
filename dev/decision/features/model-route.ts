/**
 * model_route: which capability tier a prompt deserves.
 *
 * Jev judges the task (kind, complexity, capability deserved, need for deep reasoning); code
 * composes those into `quick | standard | high | premium`. The tier names are the harness's own
 * ladders (`config.jsonc` `models.profiles`), so the daemon never names a model. Skips run here,
 * not in each harness, so pi and Claude Code skip the same prompts.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClassifierAnswer, ClassifierQuestion, JsonObject } from "@earendil-works/pi-ai";
import type { DecideRequest, Decision } from "../engine.ts";
import { type FeatureDef, type FeatureResult, num, str } from "./types.ts";

export const TIERS = ["quick", "standard", "high", "premium"] as const;
export type Tier = (typeof TIERS)[number];

export interface RoutePrompt {
	version: string;
	taskKinds: Record<string, string>;
	kindMinimumTier: Record<string, Tier>;
	questions: Record<string, { type: ClassifierQuestion["type"]; instructions: string; criteria?: unknown }>;
	compose: {
		complexityWeight: number;
		capabilityWeight: number;
		reasoningHigh: number;
		reasoningHighBoost: number;
		reasoningLow: number;
		reasoningLowPenalty: number;
		kindConfidenceFloor: number;
	};
}

export function loadRoutePrompt(
	version = "v1",
	dir = join(import.meta.dir, "..", "prompts", "model_route"),
): RoutePrompt {
	return JSON.parse(readFileSync(join(dir, `${version}.json`), "utf8")) as RoutePrompt;
}

export interface RouteInput {
	prompt: string;
	history?: string;
	cwd?: string;
	currentModel?: string;
	contextTokens?: number;
	harness?: string;
	sessionId?: string;
}

export interface RouteResult extends FeatureResult {
	decisionId?: string;
	status: "routed" | "skipped" | "unavailable";
	tier?: Tier;
	kind?: string;
	demand?: number;
}

const ACK =
	/^(y|yes|yeah|yep|ok|okay|sure|continue|go on|go ahead|do it|proceed|nice|thanks|thank you|ty|ㅇㅇ|ㅇㅋ|응|네|예|좋아|계속|진행|고마워|감사)[.!~]*$/i;
const MIN_CONTINUATION_CHARS = 12;

export function skipReason(input: RouteInput): string | undefined {
	const text = input.prompt.trim();
	if (!text) return "empty";
	// `/name args` is a command; `/design/draft …` or `/home/…` is a path.
	if (/^\/[^\s/]+(?:\s|$)/.test(text)) return "slash command";
	if (ACK.test(text)) return "acknowledgement";
	if (text.length < MIN_CONTINUATION_CHARS && input.history) return "short continuation";
	return undefined;
}

export function buildRequest(input: RouteInput, prompt: RoutePrompt): DecideRequest {
	const questions: Record<string, ClassifierQuestion> = {};
	for (const [id, q] of Object.entries(prompt.questions)) {
		questions[id] = (id === "task_kind" ? { ...q, criteria: prompt.taskKinds } : q) as ClassifierQuestion;
	}
	const state: JsonObject = {
		request: input.prompt,
		conversation_excerpt: input.history ? input.history.slice(-4000) : null,
		environment: {
			cwd: input.cwd ?? null,
			active_model: input.currentModel ?? null,
			context_tokens_used: input.contextTokens ?? null,
		},
	};
	return {
		feature: "model_route",
		version: prompt.version,
		state,
		questions,
		harness: input.harness,
		sessionId: input.sessionId,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function tierIndex(tier: Tier | undefined): number {
	const index = TIERS.indexOf(tier ?? "standard");
	return index < 0 ? 1 : index;
}

export function compose(
	answers: Record<string, ClassifierAnswer>,
	prompt: RoutePrompt,
): Pick<RouteResult, "tier" | "kind" | "demand" | "reason" | "notes"> {
	const c = prompt.compose;
	const kindAnswer = answers.task_kind;
	const kind = kindAnswer?.type === "choice" ? kindAnswer.choice : "chat";
	const kindConfidence = kindAnswer?.type === "choice" ? kindAnswer.confidence : 0;
	const complexity = answers.complexity?.type === "score" ? answers.complexity.score : 1;
	const capability = answers.capability_deserved?.type === "score" ? answers.capability_deserved.score : 1;
	const reasoning = answers.needs_deep_reasoning?.type === "bool" ? answers.needs_deep_reasoning.probability : 0;
	const notes: string[] = [];

	let demand = c.complexityWeight * complexity + c.capabilityWeight * capability;
	if (reasoning >= c.reasoningHigh) demand += c.reasoningHighBoost;
	else if (reasoning <= c.reasoningLow) demand -= c.reasoningLowPenalty;
	demand = clamp(demand, 0, TIERS.length - 1);

	const floor = tierIndex(prompt.kindMinimumTier[kind] ?? "quick");
	if (demand < floor) {
		notes.push(`${kind} floors at ${TIERS[floor]}`);
		demand = floor;
	}
	let index = clamp(Math.round(demand), 0, TIERS.length - 1);
	// An unsure classification does not buy the expensive tiers.
	if (kindConfidence > 0 && kindConfidence < c.kindConfidenceFloor && index > 1) {
		notes.push(`low kind confidence ${kindConfidence.toFixed(2)} → standard`);
		index = 1;
	}
	const reason = `${kind} · complexity ${complexity.toFixed(2)}/3 · capability ${capability.toFixed(2)}/3 · reasoning ${reasoning.toFixed(2)} → ${TIERS[index]}`;
	return { tier: TIERS[index], kind, demand: Math.round(demand * 100) / 100, reason, notes };
}

export async function routeModel(
	input: RouteInput,
	decide: (request: DecideRequest) => Promise<Decision>,
	prompt: RoutePrompt,
): Promise<RouteResult> {
	const skip = skipReason(input);
	if (skip) return { status: "skipped", reason: skip, notes: [] };
	const decision = await decide(buildRequest(input, prompt));
	if (decision.status !== "ok") {
		return {
			decisionId: decision.decisionId,
			status: "unavailable",
			reason: "no backend answered",
			notes: decision.skipped,
		};
	}
	return {
		decisionId: decision.decisionId,
		status: "routed",
		...compose(decision.answers, prompt),
		backend: decision.backend,
		calibrated: decision.calibrated,
		latencyMs: decision.latencyMs,
	};
}

function parseRouteInput(b: Record<string, unknown>): RouteInput | string {
	const prompt = str(b.prompt);
	if (prompt === undefined) return "prompt is required";
	return {
		prompt,
		history: str(b.history),
		cwd: str(b.cwd),
		currentModel: str(b.currentModel),
		contextTokens: num(b.contextTokens),
		harness: str(b.harness),
		sessionId: str(b.sessionId),
	};
}

export const modelRoute: FeatureDef = {
	name: "model_route",
	path: "/v1/model_route",
	load(version) {
		const prompt = loadRoutePrompt(version);
		return {
			version: prompt.version,
			parse: parseRouteInput,
			run: (input, decide) => routeModel(input as RouteInput, decide, prompt),
		};
	},
	/** `expected` is the tier a person assigned. */
	score(expected, result): Record<string, number> {
		const want = TIERS.indexOf(expected as Tier);
		const got = TIERS.indexOf(result.tier as Tier);
		if (want < 0) return {};
		if (got < 0) return { exact: 0, within1: 0, answered: 0 };
		return { exact: Number(want === got), within1: Number(Math.abs(want - got) <= 1), answered: 1 };
	},
};
