import { describe, expect, test } from "bun:test";
import type { ClassifierAnswer } from "@earendil-works/pi-ai";
import type { Decision } from "../engine.ts";
import {
	buildRequest,
	compose,
	loadOrchestratorPrompt,
	orchestrate,
	type OrchestrateInput,
	orchestrator,
} from "./orchestrator.ts";

const prompt = loadOrchestratorPrompt("v1");

const input: OrchestrateInput = {
	task: "survey how auth, billing and notifications handle retries, then fix the flaky one",
	roles: [
		{ name: "shared-sub-explore", description: "Read-only codebase exploration" },
		{ name: "shared-sub-general", description: "Worker that can read, edit, run commands" },
		{ name: "shared-sub-debug", description: "Isolated debug worker" },
	],
};

function answers(plan: string, worth: number, roles: Record<string, number>): Record<string, ClassifierAnswer> {
	const out: Record<string, ClassifierAnswer> = {
		plan: { type: "choice", choice: plan, probabilities: { [plan]: 0.8 }, confidence: 0.8 },
		worth_parallel: { type: "bool", probability: worth },
	};
	for (const [name, p] of Object.entries(roles)) out[`role:${name}`] = { type: "bool", probability: p };
	return out;
}

function ok(a: Record<string, ClassifierAnswer>): Decision {
	return {
		status: "ok",
		decisionId: "d",
		calibrated: true,
		answers: a,
		latencyMs: 5,
		costUsd: 0,
		cached: false,
		skipped: [],
	};
}

describe("orchestrator request", () => {
	test("plan, worth_parallel and one bool per role with the role named in the instructions", () => {
		const r = buildRequest(input, prompt);
		expect(Object.keys(r.questions)).toEqual([
			"plan",
			"worth_parallel",
			"role:shared-sub-explore",
			"role:shared-sub-general",
			"role:shared-sub-debug",
		]);
		expect(r.questions["role:shared-sub-debug"]?.instructions).toContain("`shared-sub-debug`");
		expect(r.questions["role:shared-sub-debug"]?.instructions).toContain("Isolated debug worker");
		expect(r.state).toEqual({ task: input.task, cwd: null });
	});
});

describe("orchestrator compose", () => {
	test("fanout keeps roles above the pass mark, ordered by p", () => {
		const r = compose(
			answers("fanout", 0.8, { "shared-sub-explore": 0.9, "shared-sub-general": 0.6, "shared-sub-debug": 0.1 }),
			input,
			prompt,
		);
		expect(r.plan).toBe("fanout");
		expect(r.steps).toEqual([
			{ role: "shared-sub-explore", p: 0.9 },
			{ role: "shared-sub-general", p: 0.6 },
		]);
	});

	test("staged uses the same threshold; single yields exactly one step", () => {
		expect(
			compose(
				answers("staged", 0.2, { "shared-sub-explore": 0.7, "shared-sub-debug": 0.6, "shared-sub-general": 0.2 }),
				input,
				prompt,
			).plan,
		).toBe("staged");
		const single = compose(
			answers("single", 0.1, { "shared-sub-explore": 0.7, "shared-sub-debug": 0.6, "shared-sub-general": 0.2 }),
			input,
			prompt,
		);
		expect(single.steps).toEqual([{ role: "shared-sub-explore", p: 0.7 }]);
	});

	test("fanout with low worth_parallel or fewer than two roles falls back to single", () => {
		const lowWorth = compose(
			answers("fanout", 0.1, { "shared-sub-explore": 0.9, "shared-sub-general": 0.8 }),
			input,
			prompt,
		);
		expect(lowWorth.plan).toBe("single");
		expect(lowWorth.steps).toHaveLength(1);
		const oneRole = compose(
			answers("staged", 0.9, { "shared-sub-explore": 0.9, "shared-sub-general": 0.1 }),
			input,
			prompt,
		);
		expect(oneRole.plan).toBe("single");
		expect(oneRole.notes[0]).toContain("→ single");
	});

	test("no role fits yields no steps; steps never exceed maxSteps or invent roles", () => {
		expect(compose(answers("single", 0.1, { "shared-sub-explore": 0.05 }), input, prompt).steps).toEqual([]);
		const many: OrchestrateInput = {
			task: "t",
			roles: Array.from({ length: 8 }, (_, i) => ({ name: `r${i}`, description: "" })),
		};
		const a = answers("fanout", 0.9, Object.fromEntries(many.roles.map((r) => [r.name, 0.9])));
		a["role:ghost"] = { type: "bool", probability: 1 };
		const r = compose(a, many, prompt);
		expect(r.steps).toHaveLength(prompt.compose.maxSteps);
		expect(r.steps.map((s) => s.role)).not.toContain("ghost");
	});
});

describe("orchestrator run", () => {
	test("routed, skipped and unavailable paths", async () => {
		const a = answers("fanout", 0.8, { "shared-sub-explore": 0.9, "shared-sub-general": 0.7, "shared-sub-debug": 0.1 });
		expect((await orchestrate(input, async () => ok(a), prompt)).status).toBe("routed");
		const never = async (): Promise<Decision> => {
			throw new Error("engine must not run");
		};
		expect((await orchestrate({ ...input, task: "/model" }, never, prompt)).reason).toBe("slash command");
		expect((await orchestrate({ ...input, roles: [] }, never, prompt)).reason).toBe("no roles offered");
		const down: Decision = {
			status: "unavailable",
			decisionId: "d",
			calibrated: false,
			answers: {},
			latencyMs: 1,
			costUsd: 0,
			cached: false,
			skipped: [],
		};
		expect(await orchestrate(input, async () => down, prompt)).toMatchObject({ status: "unavailable", steps: [] });
	});
});

describe("orchestrator parse and score", () => {
	const runtime = orchestrator.load("v1");
	test("parse validates task and roles", () => {
		expect(runtime.parse({ roles: [] })).toBe("task is required");
		expect(runtime.parse({ task: "x" })).toContain("roles");
		expect(runtime.parse({ task: "x", roles: [{ description: "d" }] })).toContain("name");
		expect(runtime.parse({ task: "x", roles: [{ name: "a" }], cwd: "/p" })).toMatchObject({
			roles: [{ name: "a", description: "" }],
			cwd: "/p",
		});
	});

	test("score compares plan and role coverage", () => {
		const routed = {
			status: "routed" as const,
			reason: "",
			notes: [],
			plan: "fanout",
			steps: [
				{ role: "a", p: 0.9 },
				{ role: "c", p: 0.8 },
			],
		};
		expect(orchestrator.score({ plan: "fanout", roles: ["a", "b"] }, routed)).toMatchObject({
			plan: 1,
			roleRecall: 0.5,
			rolePrecision: 0.5,
		});
		expect(orchestrator.score({ plan: "single" }, routed)).toEqual({ answered: 1, plan: 0 });
		expect(orchestrator.score({ plan: "single" }, { status: "unavailable", reason: "", notes: [] })).toMatchObject({
			answered: 0,
		});
	});
});
