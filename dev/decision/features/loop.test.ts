import { describe, expect, test } from "bun:test";
import type { ClassifierAnswer } from "@earendil-works/pi-ai";
import type { Decision, DecideRequest } from "../engine.ts";
import { canonicalArgs, type LoopEvent, LoopStore, loadLoopPrompt, observe, promiseShaped } from "./loop.ts";

const prompt = loadLoopPrompt("v1");

function decision(answers: Record<string, ClassifierAnswer>, status: Decision["status"] = "ok"): Decision {
	return { status, decisionId: "d1", calibrated: true, answers, latencyMs: 1, costUsd: 0, cached: false, skipped: [] };
}

/** A decide that must not be called: the rules alone answer. */
const never = async (_: DecideRequest): Promise<Decision> => {
	throw new Error("Jev asked");
};

function run(events: LoopEvent[], store = new LoopStore(), decide = never, sessionId = "s") {
	return observe({ sessionId, harness: "pi", events }, store, prompt, decide);
}

const call = (tool: string, args: unknown = {}): LoopEvent => ({ kind: "call", tool, args });
const result = (tool: string, args: unknown, output: string, isError = false): LoopEvent => ({
	kind: "result",
	tool,
	args,
	output,
	isError,
});

describe("loop rules (pydantic LoopDetection tiers)", () => {
	test("five identical calls in the window nudge, with the harness marker", async () => {
		const r = await run(Array.from({ length: 5 }, () => call("read", { path: "a.ts" })));
		expect(r.detections.map((d) => d.tier)).toEqual(["exact_repetition"]);
		expect(r.detections[0].action).toBe("nudge");
		expect(r.detections[0].message.startsWith("[harness:loop-detection]")).toBe(true);
	});

	test("below the threshold is silent", async () => {
		const r = await run(Array.from({ length: 4 }, () => call("read", { path: "a.ts" })));
		expect(r.detections).toEqual([]);
		expect(r.reason).toBe("clear");
	});

	test("interleaved repeats inside the window still count", async () => {
		const a = call("bash", { command: "bun test" });
		const r = await run([a, call("read", { path: "x" }), a, a, call("grep", { q: 1 }), a, a]);
		expect(r.detections.map((d) => d.tier)).toEqual(["exact_repetition"]);
	});

	test("the same result three times in a row is an error cycle", async () => {
		const args = { command: "bun test" };
		const r = await run([1, 2, 3].map(() => result("bash", args, "FAIL x.test.ts", true)));
		expect(r.detections.map((d) => d.tier)).toEqual(["error_cycle"]);
	});

	test("A-B for three cycles is alternation; a broken pattern is not", async () => {
		const a = call("edit", { path: "a" });
		const b = call("read", { path: "a" });
		expect((await run([a, b, a, b, a, b])).detections.map((d) => d.tier)).toEqual(["alternation"]);
		expect((await run([a, b, a, call("grep"), a, b])).detections).toEqual([]);
	});

	test("three near-identical answers are a monologue; empty text never is", async () => {
		const store = new LoopStore();
		const say: LoopEvent = { kind: "answer", text: "  I am  still looking into the issue. " };
		await run([say], store);
		await run([{ kind: "answer", text: "" }], store);
		await run([say], store);
		const r = await run([{ kind: "answer", text: "i am still looking into the issue." }], store);
		expect(r.detections.map((d) => d.tier)).toEqual(["monologue"]);
	});

	test("argument fingerprints ignore key order", () => {
		expect(canonicalArgs({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalArgs('{"a":{"c":3,"d":2},"b":1}'));
	});

	test("sessions and subagent loops keep their own counters", async () => {
		const store = new LoopStore();
		const four = Array.from({ length: 4 }, () => call("read", { path: "a" }));
		await run(four, store, never, "one");
		expect((await run([call("read", { path: "a" })], store, never, "two")).detections).toEqual([]);
		const sub = await observe(
			{ sessionId: "one", harness: "pi", agentId: "child", events: [call("read", { path: "a" })] },
			store,
			prompt,
			never,
		);
		expect(sub.detections).toEqual([]);
		expect((await run([call("read", { path: "a" })], store, never, "one")).detections).toHaveLength(1);
	});
});

describe("runaway (rule first, Jev when a promise-shaped ending is read)", () => {
	test("promise-shaped endings in English and Korean; questions and reports are not", () => {
		expect(promiseShaped("Found it. Now I'll run the tests.", prompt)).toBe(true);
		expect(promiseShaped("원인을 찾았습니다. 테스트를 실행하겠습니다.", prompt)).toBe(true);
		expect(promiseShaped("Should I run the tests?", prompt)).toBe(false);
		expect(promiseShaped("All 12 tests pass.", prompt)).toBe(false);
	});

	test("Jev confirms → continue, at most once per prompt", async () => {
		const store = new LoopStore();
		let asked = 0;
		const decide = async (r: DecideRequest) => {
			asked += 1;
			expect(Object.keys(r.questions)).toEqual(["runaway"]);
			return decision({ runaway: { type: "bool", probability: 0.92 } });
		};
		const say: LoopEvent = { kind: "answer", text: "The bug is in auth.ts. Let me fix it now." };
		const first = await run([{ kind: "prompt", text: "fix login" }, say], store, decide);
		expect(first.detections.map((d) => [d.tier, d.action])).toEqual([["runaway", "continue"]]);
		const again = await run([{ kind: "answer", text: "Okay. Let me check the config next." }], store, decide);
		expect(again.detections).toEqual([]);
		expect(asked).toBe(1);
		await run([{ kind: "prompt", text: "next" }], store, decide);
		expect((await run([{ kind: "answer", text: "Let me check the config next." }], store, decide)).detections).toHaveLength(1);
	});

	test("Jev says it was fine, or is unavailable → nothing", async () => {
		const low = async () => decision({ runaway: { type: "bool", probability: 0.2 } });
		expect((await run([{ kind: "answer", text: "Let me run it." }], new LoopStore(), low)).detections).toEqual([]);
		const down = async () => decision({}, "unavailable");
		const r = await run([{ kind: "answer", text: "Let me run it." }], new LoopStore(), down);
		expect(r.detections).toEqual([]);
		expect(r.status).toBe("unavailable");
	});
});

describe("Maker checks (shadow only)", () => {
	const task = { agent: "shared-sub-general", task: "Fix  the login TEST" };

	test("the same task dispatched twice is a shadow duplicate", async () => {
		const store = new LoopStore();
		await run([call("subagent", task)], store);
		const r = await run([call("subagent", { agent: "shared-sub-general", task: "fix the login test" })], store);
		expect(r.detections.map((d) => [d.tier, d.action])).toEqual([["maker_duplicate", "shadow"]]);
	});

	test("a redispatch after a failure asks Jev for the failure class", async () => {
		const store = new LoopStore();
		const decide = async (r: DecideRequest) => {
			expect(Object.keys(r.questions)).toEqual(["failure"]);
			return decision({
				failure: { type: "choice", choice: "environment", probabilities: { environment: 0.9 }, confidence: 0.9 },
			});
		};
		await run([call("Agent", { prompt: "run e2e" }), result("Agent", { prompt: "run e2e" }, "ECONNREFUSED :5432", true)], store);
		const r = await run([call("Agent", { prompt: "run e2e" })], store, decide);
		expect(r.detections[0]).toMatchObject({ tier: "maker_retry", action: "shadow", failureClass: "environment" });
		expect(r.detections[0].message).toContain("fix the environment first");
	});
});
