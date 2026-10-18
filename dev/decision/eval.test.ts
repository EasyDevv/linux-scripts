import { describe, expect, test } from "bun:test";
import type { Decision } from "./engine.ts";
import {
	type CaseOutcome,
	casePrompt,
	type EvalCase,
	isMiss,
	judgePromotion,
	parseCases,
	percentile,
	renderTable,
	reportBasename,
	runCases,
	summarize,
	type EvalReport,
} from "./eval.ts";
import type { FeatureDef, FeatureResult } from "./features/types.ts";

function outcome(partial: Partial<CaseOutcome>): CaseOutcome {
	return { index: 0, prompt: "p", expected: "x", status: "routed", metrics: {}, got: "", costUsd: 0, ...partial };
}

describe("parseCases", () => {
	test("reads JSONL, defaults source to seed, and reports the bad line", () => {
		const cases = parseCases(
			'{"input":{"prompt":"a"},"expected":"quick"}\n\n{"input":{"prompt":"b"},"expected":"high","source":"s1","note":"n"}\n',
		);
		expect(cases).toEqual([
			{ input: { prompt: "a" }, expected: "quick", source: "seed", note: undefined },
			{ input: { prompt: "b" }, expected: "high", source: "s1", note: "n" },
		]);
		expect(() => parseCases('{"input":{"prompt":"a"}}', "f")).toThrow("f:1");
		expect(() => parseCases("nope")).toThrow("not JSON");
	});

	test("the seed file loads and covers all four tiers", async () => {
		const text = await Bun.file(new URL("./evals/model_route.jsonl", import.meta.url)).text();
		const cases = parseCases(text);
		expect(cases.length).toBeGreaterThanOrEqual(30);
		expect(new Set(cases.map((c) => c.expected))).toEqual(new Set(["quick", "standard", "high", "premium"]));
		expect(cases.every((c) => c.source === "seed")).toBe(true);
		expect(cases.some((c) => /[가-힣]/.test(String(c.input.prompt)))).toBe(true);
	});
});

describe("aggregation", () => {
	test("percentile uses nearest rank", () => {
		expect(percentile([], 95)).toBeUndefined();
		expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
		expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
		expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
	});

	test("averages metrics over answered cases and counts the rest apart", () => {
		const s = summarize("v1", [
			outcome({ metrics: { exact: 1, within1: 1 }, latencyMs: 400, costUsd: 0, backend: "jev", calibrated: true }),
			outcome({
				metrics: { exact: 0, within1: 1 },
				latencyMs: 600,
				costUsd: 0.001,
				backend: "opencode/jev-1.13",
				calibrated: false,
			}),
			outcome({ status: "unavailable", latencyMs: 4000 }),
			outcome({ status: "invalid", error: "bad" }),
		]);
		expect(s.cases).toBe(4);
		expect(s.answered).toBe(2);
		expect(s.unavailable).toBe(1);
		expect(s.invalid).toBe(1);
		expect(s.metrics.exact).toBe(0.5);
		expect(s.metrics.within1).toBe(1);
		expect(s.metrics.coverage).toBeCloseTo(2 / 3);
		expect(s.costUsd).toBeCloseTo(0.001);
		expect(s.calibratedShare).toBe(0.5);
		expect(s.backends).toEqual({ jev: 1, "opencode/jev-1.13": 1 });
		expect(s.latency).toEqual({ p50: 600, p95: 4000, n: 3 });
	});

	test("a metric present on only some cases averages over those", () => {
		const s = summarize("v1", [outcome({ metrics: { recall: 1 } }), outcome({ metrics: { recall: 0, extra: 2 } })]);
		expect(s.metrics.recall).toBe(0.5);
		expect(s.metrics.extra).toBe(2);
	});

	test("isMiss treats noise-like metrics as lower-is-better", () => {
		expect(isMiss({ exact: 1, within1: 1 })).toBe(false);
		expect(isMiss({ exact: 0, within1: 1 })).toBe(true);
		expect(isMiss({ recall: 1, extra: 0 })).toBe(false);
		expect(isMiss({ recall: 1, extra: 2 })).toBe(true);
	});
});

function summary(metrics: Record<string, number>, over: Partial<ReturnType<typeof summarize>> = {}) {
	return { ...summarize("v", []), metrics, latency: { p50: 500, p95: 700, n: 10 }, calibratedShare: 1, ...over };
}

describe("judgePromotion", () => {
	test("floor only: model_route needs within1 >= 0.9", () => {
		expect(judgePromotion("model_route", summary({ within1: 0.9 })).holds).toBe(true);
		const low = judgePromotion("model_route", summary({ within1: 0.85 }));
		expect(low.holds).toBe(false);
		expect(low.reasons[0]).toContain("floor");
		expect(judgePromotion("model_route", summary({})).holds).toBe(false);
		expect(judgePromotion("orchestrator", summary({ accuracy: 0.1 })).holds).toBe(true);
	});

	test("unavailable cases block the rule, since the averages cover only part of the set", () => {
		const v = judgePromotion("model_route", summary({ within1: 1 }, { unavailable: 2 }));
		expect(v.holds).toBe(false);
		expect(v.reasons.join(" ")).toContain("unavailable");
		expect(
			judgePromotion("model_route", summary({ within1: 1, exact: 1 }), summary({ exact: 0 }, { unavailable: 1 })).holds,
		).toBe(false);
	});

	test("find_skill and find_tool have their own floors", () => {
		expect(judgePromotion("find_skill", summary({ recall: 0.9 })).holds).toBe(true);
		expect(judgePromotion("find_tool", summary({ recall: 0.9 })).holds).toBe(false);
		expect(judgePromotion("find_tool", summary({ recall: 0.95 })).holds).toBe(true);
	});

	test("against: better on one metric and worse on none holds", () => {
		const base = summary({ exact: 0.6, within1: 0.92 });
		const v = judgePromotion("model_route", summary({ exact: 0.7, within1: 0.92 }), base);
		expect(v.holds).toBe(true);
		expect(v.better).toEqual(["exact"]);
		expect(v.worse).toEqual([]);
	});

	test("against: identical, or worse on any metric, does not hold", () => {
		const base = summary({ exact: 0.6, within1: 0.92 });
		expect(judgePromotion("model_route", summary({ exact: 0.6, within1: 0.92 }), base).reasons).toContain(
			"not better on any metric",
		);
		const trade = judgePromotion("model_route", summary({ exact: 0.8, within1: 0.91 }), base);
		expect(trade.holds).toBe(false);
		expect(trade.worse).toEqual(["within1"]);
	});

	test("against: lower-is-better metrics invert, and the floor still applies", () => {
		const base = summary({ recall: 0.95, extra: 3 });
		expect(judgePromotion("find_tool", summary({ recall: 0.95, extra: 1 }), base).holds).toBe(true);
		expect(judgePromotion("find_tool", summary({ recall: 0.95, extra: 5 }), base).holds).toBe(false);
		expect(
			judgePromotion("find_tool", summary({ recall: 0.9, extra: 0 }), summary({ recall: 0.8, extra: 3 })).holds,
		).toBe(false);
	});

	test("against: latency and cost guards", () => {
		const base = summary({ exact: 0.6, within1: 0.95 }, { costUsd: 0.001 });
		const slow = judgePromotion(
			"model_route",
			summary({ exact: 0.9, within1: 0.95 }, { latency: { p50: 900, p95: 1500, n: 10 }, costUsd: 0.001 }),
			base,
		);
		expect(slow.holds).toBe(false);
		expect(slow.guards.find((g) => g.name === "p95 latency ms")?.ok).toBe(false);
		const dear = judgePromotion("model_route", summary({ exact: 0.9, within1: 0.95 }, { costUsd: 0.01 }), base);
		expect(dear.holds).toBe(false);
		const free = judgePromotion("model_route", summary({ exact: 0.9, within1: 0.95 }, { costUsd: 0.0011 }), base);
		expect(free.holds).toBe(true);
	});
});

// --- running --------------------------------------------------------------------------------

const fakeDef: FeatureDef = {
	name: "fake",
	path: "/v1/fake",
	load: (version) => ({
		version,
		parse: (body) =>
			typeof body.prompt === "string"
				? { prompt: body.prompt, harness: body.harness, sessionId: body.sessionId }
				: "prompt is required",
		run: async (input, decide): Promise<FeatureResult> => {
			const { prompt, harness, sessionId } = input as { prompt: string; harness: string; sessionId: string };
			if (prompt === "boom") throw new Error("kaput");
			const d = await decide({ feature: "fake", version, state: {}, questions: {}, harness, sessionId });
			if (d.status !== "ok") return { status: "unavailable", reason: "none", notes: [], decisionId: d.decisionId };
			return {
				status: "routed",
				reason: "ok",
				notes: [],
				decisionId: d.decisionId,
				tier: prompt,
				backend: d.backend,
				calibrated: d.calibrated,
			};
		},
	}),
	score: (expected, result) => ({ exact: Number(expected === result.tier) }),
};

function decision(partial: Partial<Decision> = {}): Decision {
	return {
		status: "ok",
		decisionId: "d",
		backend: "jev",
		calibrated: true,
		answers: {},
		latencyMs: 100,
		costUsd: 0.002,
		cached: false,
		skipped: [],
		...partial,
	};
}

describe("runCases", () => {
	test("tags requests as eval, sums cost and latency, scores, and logs results", async () => {
		const seen: Record<string, unknown>[] = [];
		const logged: Record<string, unknown>[] = [];
		const cases: EvalCase[] = [
			{ input: { prompt: "a" }, expected: "a", source: "seed" },
			{ input: { prompt: "b" }, expected: "zzz", source: "seed" },
			{ input: { nothing: 1 }, expected: "a", source: "seed" },
			{ input: { prompt: "boom" }, expected: "a", source: "seed" },
		];
		const outcomes = await runCases({
			def: fakeDef,
			version: "v2",
			cases,
			runId: "r1",
			log: { write: (r) => logged.push(r) },
			decide: async (request) => {
				seen.push({ harness: request.harness, sessionId: request.sessionId });
				return decision();
			},
		});
		expect(seen).toEqual([
			{ harness: "eval", sessionId: "eval-r1" },
			{ harness: "eval", sessionId: "eval-r1" },
		]);
		expect(outcomes.map((o) => o.status)).toEqual(["routed", "routed", "invalid", "error"]);
		expect(outcomes[0].metrics).toEqual({ exact: 1 });
		expect(outcomes[1].metrics).toEqual({ exact: 0 });
		expect(outcomes[0].costUsd).toBeCloseTo(0.002);
		expect(outcomes[0].latencyMs).toBe(100);
		expect(logged).toHaveLength(2);
		expect(logged[0]).toMatchObject({
			type: "result",
			feature: "fake",
			version: "v2",
			harness: "eval",
			sessionId: "eval-r1",
			evalRun: "r1",
		});
		const s = summarize("v2", outcomes);
		expect(s.metrics.exact).toBe(0.5);
		expect(s.invalid).toBe(2);
	});

	test("an unavailable decision is excluded from metrics but counted", async () => {
		const outcomes = await runCases({
			def: fakeDef,
			version: "v1",
			cases: [{ input: { prompt: "a" }, expected: "a", source: "seed" }],
			runId: "r",
			decide: async () => decision({ status: "unavailable" }),
		});
		expect(outcomes[0].status).toBe("unavailable");
		expect(outcomes[0].metrics).toEqual({});
		const s = summarize("v1", outcomes);
		expect(s.unavailable).toBe(1);
		expect(s.metrics.coverage).toBe(0);
	});

	test("preserves case order under concurrency", async () => {
		const cases: EvalCase[] = ["a", "b", "c", "d", "e"].map((p) => ({
			input: { prompt: p },
			expected: p,
			source: "seed",
		}));
		const outcomes = await runCases({
			def: fakeDef,
			version: "v1",
			cases,
			runId: "r",
			concurrency: 3,
			decide: async () => {
				await Bun.sleep(Math.random() * 5);
				return decision();
			},
		});
		expect(outcomes.map((o) => o.prompt)).toEqual(["a", "b", "c", "d", "e"]);
		expect(outcomes.every((o) => o.metrics.exact === 1)).toBe(true);
	});
});

describe("report helpers", () => {
	test("casePrompt masks secrets and clips", () => {
		const p = casePrompt({ prompt: `use key sk-abcdefghijklmnopqrstuvwxyz0123 ${"x".repeat(400)}` });
		expect(p).not.toContain("sk-abcdef");
		expect(p.length).toBeLessThanOrEqual(300);
	});

	test("file names follow YYMMDD-feature-vN with optional backend and baseline", () => {
		const d = new Date(2026, 9, 18);
		expect(reportBasename({ feature: "model_route", version: "v2", backend: "default" }, false, d)).toBe(
			"261018-model_route-v2",
		);
		expect(
			reportBasename(
				{ feature: "model_route", version: "v2", against: "v1", backend: "opencode/jev-1.13-free" },
				true,
				d,
			),
		).toBe("261018-model_route-v2-opencode_jev-1.13-free-vs-v1");
	});

	test("the table shows deltas against a baseline", () => {
		const report = {
			candidate: { summary: summary({ exact: 0.7 }), outcomes: [] },
			baseline: { summary: summary({ exact: 0.6 }), outcomes: [] },
		} as unknown as EvalReport;
		expect(renderTable(report)).toContain("+0.100");
	});
});
