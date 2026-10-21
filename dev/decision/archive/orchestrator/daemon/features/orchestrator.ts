/**
 * orchestrator: how a task should be split across subagents.
 *
 * One batched Jev call: the plan shape (single | fanout | staged), whether parallel agents pay
 * off, and one bool per role the harness offers. Code composes `steps` from the role
 * probabilities. It returns roles only, never task text (the harness writes each step's
 * assignment), and only names it was given, so a role can never be invented.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClassifierAnswer, ClassifierQuestion, JsonObject } from "@earendil-works/pi-ai";
import type { DecideRequest, Decision } from "../engine.ts";
import { skipReason } from "./model-route.ts";
import { type FeatureDef, type FeatureResult, isRecord, str } from "./types.ts";

export const PLANS = ["single", "fanout", "staged"] as const;
export type Plan = (typeof PLANS)[number];

export interface OrchestratorPrompt {
	version: string;
	maxRoles: number;
	questions: {
		plan: { type: "choice"; instructions: string; criteria: Record<string, string> };
		worth_parallel: { type: "bool"; instructions: string; criteria: { true: string; false: string } };
		role: { type: "bool"; instructions: string; criteria: { true: string; false: string } };
	};
	compose: {
		rolePass: number;
		singleFloor: number;
		worthParallelFloor: number;
		maxSteps: number;
		descriptionChars: number;
	};
}

export function loadOrchestratorPrompt(
	version = "v1",
	dir = join(import.meta.dir, "..", "prompts", "orchestrator"),
): OrchestratorPrompt {
	return JSON.parse(readFileSync(join(dir, `${version}.json`), "utf8")) as OrchestratorPrompt;
}

export interface RoleSpec {
	name: string;
	description: string;
}

export interface OrchestrateInput {
	task: string;
	roles: RoleSpec[];
	cwd?: string;
	harness?: string;
	sessionId?: string;
}

export interface OrchestrateResult extends FeatureResult {
	plan?: Plan;
	worthParallel?: number;
	steps: { role: string; p: number }[];
}

const roleId = (name: string): string => `role:${name}`;

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Offered roles: unique names, capped. */
function offered(input: OrchestrateInput, prompt: OrchestratorPrompt): RoleSpec[] {
	const seen = new Set<string>();
	const out: RoleSpec[] = [];
	for (const role of input.roles) {
		if (seen.has(role.name)) continue;
		seen.add(role.name);
		out.push(role);
		if (out.length >= prompt.maxRoles) break;
	}
	return out;
}

export function buildRequest(input: OrchestrateInput, prompt: OrchestratorPrompt): DecideRequest {
	const q = prompt.questions;
	const questions: Record<string, ClassifierQuestion> = {
		plan: q.plan,
		worth_parallel: q.worth_parallel,
	};
	for (const role of offered(input, prompt)) {
		const description = clip(role.description || role.name, prompt.compose.descriptionChars);
		questions[roleId(role.name)] = {
			...q.role,
			instructions: q.role.instructions.replace("{role}", role.name).replace("{description}", description),
		};
	}
	const state: JsonObject = { task: input.task, cwd: input.cwd ?? null };
	return {
		feature: "orchestrator",
		version: prompt.version,
		state,
		questions,
		harness: input.harness,
		sessionId: input.sessionId,
	};
}

export function compose(
	answers: Record<string, ClassifierAnswer>,
	input: OrchestrateInput,
	prompt: OrchestratorPrompt,
): Pick<OrchestrateResult, "plan" | "worthParallel" | "steps" | "reason" | "notes"> {
	const c = prompt.compose;
	const notes: string[] = [];
	const planAnswer = answers.plan;
	let plan: Plan =
		planAnswer?.type === "choice" && PLANS.includes(planAnswer.choice as Plan) ? (planAnswer.choice as Plan) : "single";
	const worth = answers.worth_parallel?.type === "bool" ? answers.worth_parallel.probability : 0;
	const ranked = offered(input, prompt)
		.map((role) => {
			const a = answers[roleId(role.name)];
			return { role: role.name, p: a?.type === "bool" ? a.probability : 0 };
		})
		.sort((a, b) => b.p - a.p);

	if (plan === "fanout" && worth < c.worthParallelFloor) {
		notes.push(`fanout but worth_parallel ${worth.toFixed(2)} < ${c.worthParallelFloor} → single`);
		plan = "single";
	}
	let picked =
		plan === "single"
			? ranked.slice(0, 1).filter((r) => r.p >= c.singleFloor)
			: ranked.filter((r) => r.p >= c.rolePass).slice(0, c.maxSteps);
	if (plan !== "single" && picked.length < 2) {
		notes.push(`${plan} but ${picked.length} role(s) pass ${c.rolePass} → single`);
		plan = "single";
		picked = ranked.slice(0, 1).filter((r) => r.p >= c.singleFloor);
	}
	const steps = picked.map((r) => ({ role: r.role, p: Math.round(r.p * 1000) / 1000 }));
	const reason = `${plan} · parallel ${worth.toFixed(2)} · ${steps.length ? steps.map((s) => `${s.role} ${s.p.toFixed(2)}`).join(" → ") : "no role fits"}`;
	return { plan, worthParallel: Math.round(worth * 1000) / 1000, steps, reason, notes };
}

export async function orchestrate(
	input: OrchestrateInput,
	decide: (request: DecideRequest) => Promise<Decision>,
	prompt: OrchestratorPrompt,
): Promise<OrchestrateResult> {
	const skip = skipReason({ prompt: input.task });
	if (skip) return { status: "skipped", reason: skip, notes: [], steps: [] };
	if (offered(input, prompt).length === 0)
		return { status: "skipped", reason: "no roles offered", notes: [], steps: [] };
	const decision = await decide(buildRequest(input, prompt));
	if (decision.status !== "ok") {
		return {
			decisionId: decision.decisionId,
			status: "unavailable",
			reason: "no backend answered",
			notes: decision.skipped,
			steps: [],
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

function parseOrchestrateInput(b: Record<string, unknown>): OrchestrateInput | string {
	const task = str(b.task);
	if (task === undefined) return "task is required";
	if (!Array.isArray(b.roles)) return "roles must be an array of {name, description}";
	const roles: RoleSpec[] = [];
	for (const item of b.roles) {
		if (!isRecord(item) || !str(item.name)) return "roles entries need a name";
		roles.push({ name: item.name as string, description: str(item.description) ?? "" });
	}
	return { task, roles, cwd: str(b.cwd), harness: str(b.harness), sessionId: str(b.sessionId) };
}

export const orchestrator: FeatureDef = {
	name: "orchestrator",
	path: "/v1/orchestrate",
	load(version) {
		const prompt = loadOrchestratorPrompt(version);
		return {
			version: prompt.version,
			parse: parseOrchestrateInput,
			run: (input, decide) => orchestrate(input as OrchestrateInput, decide, prompt),
		};
	},
	/** `expected` is `{plan, roles?}`: the plan shape and the roles the steps should cover. */
	score(expected, result): Record<string, number> {
		if (!isRecord(expected)) return {};
		const plan = str(expected.plan);
		const want = new Set(
			Array.isArray(expected.roles) ? expected.roles.filter((v): v is string => typeof v === "string") : [],
		);
		if (result.status !== "routed") return { answered: 0, plan: 0, roleRecall: 0, rolePrecision: 0 };
		const got = ((result.steps as { role: string }[] | undefined) ?? []).map((s) => s.role);
		const hit = got.filter((r) => want.has(r)).length;
		const scores: Record<string, number> = { answered: 1, plan: Number(plan === result.plan) };
		if (Array.isArray(expected.roles)) {
			scores.roleRecall = want.size ? hit / want.size : 1;
			scores.rolePrecision = got.length ? hit / got.length : want.size ? 0 : 1;
		}
		return scores;
	},
};
