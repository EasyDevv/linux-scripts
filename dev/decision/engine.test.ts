import { describe, expect, test } from "bun:test";
import type { ClassifierResult } from "@earendil-works/pi-ai";
import { type Backend, Engine, type ModelsPort } from "./engine.ts";
import type { Budget, DecisionLog } from "./state.ts";

const QUESTIONS = { ok: { type: "bool" as const, instructions: "ok?", criteria: { true: "yes", false: "no" } } };

function classifierResult(stopReason: ClassifierResult["stopReason"], probability = 0.9): ClassifierResult {
	return {
		api: "typesafe-system-one",
		provider: "opencode",
		model: "jev",
		answers: stopReason === "stop" ? { ok: { type: "bool", probability } } : {},
		stopReason,
		timestamp: 0,
	} as ClassifierResult;
}

function harness(port: Partial<ModelsPort>, backends: Backend[], budgetExhausted = false) {
	const records: Record<string, unknown>[] = [];
	const spent: number[] = [];
	const log: DecisionLog = { write: (r) => records.push(r) };
	const budget: Budget = {
		exhausted: () => budgetExhausted,
		spend: (usd) => spent.push(usd),
		snapshot: () => ({ day: "", spentUsd: 0, dailyUsd: 1 }),
	};
	const models: ModelsPort = {
		classify: port.classify ?? (async () => classifierResult("stop")),
		inputPrice: port.inputPrice ?? ((m) => (m.endsWith("-free") ? 0 : 0.1)),
	};
	return { engine: new Engine({ models, backends: () => backends, budget, log }), records, spent };
}

const req = { feature: "t", version: "v1", state: { x: 1 }, questions: QUESTIONS };

describe("Engine", () => {
	test("first classifier answer wins and is calibrated", async () => {
		const { engine, records } = harness({}, [{ kind: "classifier", model: "opencode/jev-1.13-free" }]);
		const d = await engine.decide(req);
		expect(d.status).toBe("ok");
		expect(d.calibrated).toBe(true);
		expect(d.answers.ok).toEqual({ type: "bool", probability: 0.9 });
		expect(records[0]?.type).toBe("decide");
	});

	test("a failing free SKU walks to the paid one", async () => {
		const { engine } = harness(
			{ classify: async (model) => classifierResult(model.endsWith("-free") ? "error" : "stop") },
			[
				{ kind: "classifier", model: "opencode/jev-1.13-free" },
				{ kind: "classifier", model: "opencode/jev-1.13" },
			],
		);
		const d = await engine.decide(req);
		expect(d.backend).toBe("opencode/jev-1.13");
		expect(d.calibrated).toBe(true);
		expect(d.skipped[0]).toContain("jev-1.13-free");
	});

	test("a failed backend cools down and is skipped on the next call", async () => {
		let calls = 0;
		const { engine } = harness(
			{
				classify: async () => {
					calls += 1;
					return classifierResult("error");
				},
			},
			[{ kind: "classifier", model: "opencode/jev-1.13-free" }],
		);
		expect((await engine.decide(req)).status).toBe("unavailable");
		expect((await engine.decide({ ...req, state: { x: 2 } })).skipped[0]).toContain("cooling");
		expect(calls).toBe(1);
	});

	test("budget blocks paid backends but not free ones", async () => {
		const { engine } = harness(
			{},
			[
				{ kind: "classifier", model: "opencode/jev-1.13" },
				{ kind: "classifier", model: "opencode/jev-1.13-free" },
			],
			true,
		);
		const d = await engine.decide(req);
		expect(d.backend).toBe("opencode/jev-1.13-free");
		expect(d.skipped[0]).toContain("budget");
	});

	test("identical requests share one call and then hit the cache", async () => {
		let calls = 0;
		const { engine } = harness(
			{
				classify: async () => {
					calls += 1;
					await Bun.sleep(5);
					return classifierResult("stop");
				},
			},
			[{ kind: "classifier", model: "opencode/jev-1.13-free" }],
		);
		const [a, b] = await Promise.all([engine.decide(req), engine.decide(req)]);
		expect(a.decisionId).toBe(b.decisionId);
		const c = await engine.decide(req);
		expect(c.cached).toBe(true);
		expect(calls).toBe(1);
	});

	test("unknown catalog model is skipped without a call", async () => {
		const { engine } = harness({ inputPrice: () => undefined }, [{ kind: "classifier", model: "x/y" }]);
		const d = await engine.decide(req);
		expect(d.status).toBe("unavailable");
		expect(d.skipped[0]).toContain("not in catalog");
	});
});
