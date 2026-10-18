import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierAnswer } from "@earendil-works/pi-ai";
import { compose, loadRoutePrompt } from "./features/model-route.ts";
import { DEFAULT_TIERS, loadTiers, parseTiers, tierFor } from "./tiers.ts";

const prompt = loadRoutePrompt("v1");

function answers(kind: string, complexity: number, capability: number, reasoning: number): Record<string, ClassifierAnswer> {
	return {
		task_kind: { type: "choice", choice: kind, probabilities: { [kind]: 0.9 }, confidence: 0.9 },
		complexity: { type: "score", score: complexity, confidence: 0.9 },
		capability_deserved: { type: "score", score: capability, confidence: 0.9 },
		needs_deep_reasoning: { type: "bool", probability: reasoning },
	};
}

const five = parseTiers({
	...DEFAULT_TIERS,
	pi: [...DEFAULT_TIERS.pi, { name: "xpremium", minDemand: 2.85, models: [{ model: "opencode-go/grok-4.6", thinkingLevel: "xhigh" }] }],
	claude: [{ name: "light", minDemand: 0, model: "sonnet" }, { name: "deep", minDemand: 2, model: "fable" }],
});

describe("tiers", () => {
	test("defaults reproduce round(demand)", () => {
		for (const [demand, name] of [
			[0.49, "quick"],
			[0.5, "standard"],
			[1.49, "standard"],
			[1.5, "high"],
			[2.5, "premium"],
			[3, "premium"],
		] as const)
			expect(tierFor(demand, DEFAULT_TIERS.pi).name).toBe(name);
	});

	test("a fifth tier is a file edit: top demand reaches it, the rest is unchanged", () => {
		if (typeof five === "string") throw new Error(five);
		expect(compose(answers("debug", 3, 3, 0.9), prompt, five).tier).toBe("xpremium");
		expect(compose(answers("debug", 2, 2, 0.9), prompt, five).tier).toBe("premium");
		expect(compose(answers("plan", 0.2, 0.2, 0.1), prompt, five).tier).toBe("high");
	});

	test("each harness takes its own list: claude's names and bands are its own", () => {
		if (typeof five === "string") throw new Error(five);
		const hard = compose(answers("debug", 3, 3, 0.9), prompt, five, "claude");
		expect(hard.tier).toBe("deep");
		expect(hard.tiers).toEqual({ pi: "xpremium", claude: "deep" });
		expect(hard.effort).toBe("xhigh");
		expect(compose(answers("chat", 0, 0, 0.05), prompt, five, "claude")).toMatchObject({ tier: "light", effort: "low" });
	});

	test("a tier switched off hands its band to the nearest one on", () => {
		const off = (names: string[]) => DEFAULT_TIERS.pi.map((t) => (names.includes(t.name) ? { ...t, enabled: false } : t));
		expect(tierFor(2, off(["high"])).name).toBe("standard");
		expect(tierFor(0.1, off(["quick"])).name).toBe("standard");
		expect(tierFor(2.9, off(["high", "premium"])).name).toBe("standard");
		expect(parseTiers({ ...DEFAULT_TIERS, pi: off(["quick", "standard", "high", "premium"]) })).toBe(
			"pi: keep at least one tier on",
		);
		const parsed = parseTiers({ ...DEFAULT_TIERS, claude: DEFAULT_TIERS.claude.map((t) => ({ ...t, enabled: t.name !== "premium" })) });
		if (typeof parsed === "string") throw new Error(parsed);
		expect(parsed.claude.map((t) => t.enabled)).toEqual([undefined, undefined, undefined, false]);
	});

	test("the legacy single list splits into both", () => {
		const legacy = parseTiers({
			tiers: [
				{ name: "quick", minDemand: 0, pi: [{ model: "p/a" }], claude: "haiku" },
				{ name: "high", minDemand: 1.5, pi: [], claude: null },
			],
		});
		if (typeof legacy === "string") throw new Error(legacy);
		expect(legacy.pi.map((t) => [t.name, t.models.length])).toEqual([["quick", 1], ["high", 0]]);
		expect(legacy.claude).toEqual([{ name: "quick", minDemand: 0, model: "haiku" }]);
	});

	test("invalid documents are refused with a reason", () => {
		const claude = DEFAULT_TIERS.claude;
		expect(parseTiers({ pi: [], claude })).toBe("pi needs at least one tier");
		expect(parseTiers({ pi: [{ name: "a", minDemand: 1 }], claude })).toBe("pi: the lowest tier must start at minDemand 0");
		expect(parseTiers({ pi: [{ name: "a", minDemand: 0 }, { name: "a", minDemand: 1 }], claude })).toBe("pi: duplicate tier a");
		expect(parseTiers({ pi: [{ name: "a", minDemand: 0, models: [{ model: "nope" }] }], claude })).toBeTypeOf("string");
		expect(parseTiers({ pi: DEFAULT_TIERS.pi, claude: [{ name: "a", minDemand: 0, model: "gpt" }] })).toBeTypeOf("string");
	});

	test("loadTiers falls back to defaults on a missing or bad file and re-reads on change", () => {
		const dir = mkdtempSync(join(tmpdir(), "tiers-"));
		const path = join(dir, "tiers.json");
		expect(loadTiers(path)).toBe(DEFAULT_TIERS);
		writeFileSync(path, "{ not json");
		expect(loadTiers(path)).toBe(DEFAULT_TIERS);
		writeFileSync(
			path,
			JSON.stringify({ pi: [{ name: "only", minDemand: 0 }], claude: DEFAULT_TIERS.claude, route: { holdAboveTokens: 5 } }),
		);
		const loaded = loadTiers(path);
		expect(loaded.pi.map((t) => t.name)).toEqual(["only"]);
		expect(loaded.route.holdAboveTokens).toBe(5);
	});
});
