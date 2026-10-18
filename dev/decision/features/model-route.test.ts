import { describe, expect, test } from "bun:test";
import type { ClassifierAnswer } from "@earendil-works/pi-ai";
import type { Decision } from "../engine.ts";
import { buildRequest, compose, loadRoutePrompt, routeModel, skipReason } from "./model-route.ts";

const prompt = loadRoutePrompt("v1");

function answers(
	kind: string,
	complexity: number,
	capability: number,
	reasoning: number,
	confidence = 0.9,
): Record<string, ClassifierAnswer> {
	return {
		task_kind: { type: "choice", choice: kind, probabilities: { [kind]: confidence }, confidence },
		complexity: { type: "score", score: complexity, confidence: 0.9 },
		capability_deserved: { type: "score", score: capability, confidence: 0.9 },
		needs_deep_reasoning: { type: "bool", probability: reasoning },
	};
}

describe("model_route compose", () => {
	test("trivial chat stays quick", () => {
		expect(compose(answers("chat", 0, 0, 0.05), prompt).tier).toBe("quick");
	});

	test("plan floors at high even when judged easy", () => {
		const r = compose(answers("plan", 0.2, 0.2, 0.1), prompt);
		expect(r.tier).toBe("high");
		expect(r.notes[0]).toContain("floors at high");
	});

	test("deep reasoning on hard work reaches premium", () => {
		expect(compose(answers("debug", 2.6, 2.6, 0.9), prompt).tier).toBe("premium");
	});

	test("an unsure kind does not buy high or premium", () => {
		const r = compose(answers("debug", 2.6, 2.6, 0.9, 0.2), prompt);
		expect(r.tier).toBe("standard");
	});
});

describe("model_route skip", () => {
	test("slash commands, acks and short follow-ups skip", () => {
		expect(skipReason({ prompt: "/model" })).toBe("slash command");
		expect(skipReason({ prompt: "/skill:learn now" })).toBe("slash command");
		expect(skipReason({ prompt: "/design/draft iframe flickers on switch" })).toBeUndefined();
		expect(skipReason({ prompt: "ㅇㅇ" })).toBe("acknowledgement");
		expect(skipReason({ prompt: "진행" })).toBe("acknowledgement");
		expect(skipReason({ prompt: "그거 고쳐", history: "earlier" })).toBe("short continuation");
		expect(skipReason({ prompt: "그거 고쳐" })).toBeUndefined();
	});
});

describe("model_route request", () => {
	test("task_kind criteria come from taskKinds; every question is sent", () => {
		const r = buildRequest({ prompt: "fix the login test" }, prompt);
		expect(Object.keys(r.questions).sort()).toEqual([
			"capability_deserved",
			"complexity",
			"needs_deep_reasoning",
			"task_kind",
		]);
		expect(r.questions.task_kind).toMatchObject({ type: "choice", criteria: prompt.taskKinds });
		expect(r.version).toBe("v1");
	});

	test("unavailable engine yields unavailable, never a tier", async () => {
		const decision: Decision = {
			status: "unavailable",
			decisionId: "d",
			calibrated: false,
			answers: {},
			latencyMs: 1,
			costUsd: 0,
			cached: false,
			skipped: ["x: error"],
		};
		const r = await routeModel({ prompt: "refactor the auth module" }, async () => decision, prompt);
		expect(r.status).toBe("unavailable");
		expect(r.tier).toBeUndefined();
	});
});
