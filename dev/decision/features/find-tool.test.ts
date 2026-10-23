import { describe, expect, test } from "bun:test";
import type { ClassifierAnswer } from "@earendil-works/pi-ai";
import type { Decision } from "../engine.ts";
import { companions, buildRequest, compose, findTool, loadToolPrompt, recommendTools, type ToolInput } from "./find-tool.ts";

const prompt = loadToolPrompt("v1");

const input: ToolInput = {
	userRequest: "look up the latest Svelte 5 migration notes and update the docs",
	actionsTaken: [],
	assistantSaid: [],
	inactive: [
		{ name: "web_search", description: "Search the web" },
		{ name: "fetch_content", description: "Fetch a URL as text" },
		{ name: "interactive_shell", description: "Interactive terminal overlay" },
		{ name: "lsp_references", description: "Find references with the language server" },
	],
};

function answers(probabilities: Record<string, number>, needs = 0.9, done = 0.05): Record<string, ClassifierAnswer> {
	const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
	return {
		next_tool: { type: "choice", choice, probabilities, confidence: probabilities[choice] ?? 0 },
		needs_extra_tool: { type: "bool", probability: needs },
		done: { type: "bool", probability: done },
	};
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

describe("find_tool request", () => {
	test("one choice over inactive tools plus none, gate and done; state is clipped", () => {
		const long = "x".repeat(2000);
		const r = buildRequest({ ...input, actionsTaken: Array(20).fill(long), assistantSaid: [long] }, prompt);
		expect(Object.keys(r.questions).sort()).toEqual(["done", "needs_extra_tool", "next_tool"]);
		const next = r.questions.next_tool;
		expect(next.type === "choice" && Object.keys(next.criteria)).toEqual([
			"none",
			"web_search",
			"fetch_content",
			"interactive_shell",
			"lsp_references",
		]);
		const state = r.state as { actions_taken: string[]; assistant_said: string[]; user_request: string };
		expect(state.actions_taken).toHaveLength(prompt.compose.maxActions);
		expect(state.actions_taken[0]?.length).toBe(prompt.compose.resultChars + 1);
		expect(state.assistant_said[0]?.length).toBe(prompt.compose.saidChars + 1);
		expect(state.user_request).toBe(input.userRequest);
	});

	test("duplicates and the none label are dropped from the criteria", () => {
		const r = buildRequest(
			{
				...input,
				inactive: [...input.inactive, { name: "web_search", description: "dup" }, { name: "none", description: "x" }],
			},
			prompt,
		);
		const next = r.questions.next_tool;
		expect(next.type === "choice" && Object.keys(next.criteria)).toHaveLength(5);
	});
});

describe("find_tool compose", () => {
	test("activates tools at or above the threshold, ordered, capped at topK", () => {
		const a = answers({
			none: 0.05,
			web_search: 0.45,
			fetch_content: 0.3,
			interactive_shell: 0.1,
			lsp_references: 0.1,
		});
		expect(compose(a, input, prompt).activate).toEqual([
			{ name: "web_search", p: 0.45 },
			{ name: "fetch_content", p: 0.3 },
		]);
		const wide = answers({ none: 0, web_search: 0.3, fetch_content: 0.3, interactive_shell: 0.2, lsp_references: 0.2 });
		expect(compose(wide, input, prompt).activate).toHaveLength(3);
		expect(compose(wide, { ...input, topK: 1 }, prompt).activate).toHaveLength(1);
	});

	test("the gate suppresses activation when no extra tool is needed", () => {
		const r = compose(
			answers({ none: 0.2, web_search: 0.5, fetch_content: 0.1, interactive_shell: 0.1, lsp_references: 0.1 }, 0.1),
			input,
			prompt,
		);
		expect(r.activate).toEqual([]);
		expect(r.notes[0]).toContain("needs_extra_tool");
	});

	test("v6 lets a confident choice override the gate; v1 is unchanged", () => {
		const a = answers({ none: 0.2, web_search: 0.5, fetch_content: 0.1, interactive_shell: 0.1, lsp_references: 0.1 }, 0.1);
		const v6 = loadToolPrompt("v6");
		expect(compose(a, input, prompt).activate).toEqual([]);
		expect(compose(a, input, v6).activate).toEqual([{ name: "web_search", p: 0.5 }]);
		expect(compose(a, input, v6).notes[0]).toContain("overridden by web_search");
		const shy = answers({ none: 0.2, web_search: 0.3, fetch_content: 0.1, interactive_shell: 0.1, lsp_references: 0.1 }, 0.1);
		expect(compose(shy, input, v6).activate).toEqual([]);
	});

	test("labels outside the offered set are never activated; done is passed through", () => {
		const r = compose(answers({ none: 0.1, ghost_tool: 0.9 }, 0.9, 0.82), input, prompt);
		expect(r.activate).toEqual([]);
		expect(r.done).toBe(0.82);
	});
});

describe("find_tool run", () => {
	test("routed result carries activate and done", async () => {
		const a = answers({
			none: 0.1,
			web_search: 0.7,
			fetch_content: 0.1,
			interactive_shell: 0.05,
			lsp_references: 0.05,
		});
		const r = await recommendTools(input, async () => ok(a), prompt);
		expect(r.status).toBe("routed");
		expect(r.activate[0]?.name).toBe("web_search");
	});

	test("skips acknowledgements and empty inactive lists without calling the engine", async () => {
		const never = async (): Promise<Decision> => {
			throw new Error("engine must not run");
		};
		expect((await recommendTools({ ...input, userRequest: "ok" }, never, prompt)).reason).toBe("acknowledgement");
		expect((await recommendTools({ ...input, inactive: [] }, never, prompt)).reason).toBe("no inactive tools");
	});

	test("unavailable engine yields an empty list", async () => {
		const down: Decision = {
			status: "unavailable",
			decisionId: "d",
			calibrated: false,
			answers: {},
			latencyMs: 1,
			costUsd: 0,
			cached: false,
			skipped: ["x: error"],
		};
		const r = await recommendTools(input, async () => down, prompt);
		expect(r).toMatchObject({ status: "unavailable", activate: [] });
	});
});

describe("find_tool parse and score", () => {
	const runtime = findTool.load("v1");
	test("parse validates required fields", () => {
		expect(runtime.parse({ inactive: [] })).toBe("userRequest is required");
		expect(runtime.parse({ userRequest: "x" })).toContain("inactive");
		expect(runtime.parse({ userRequest: "x", inactive: [{ description: "no name" }] })).toContain("name");
		expect(runtime.parse({ userRequest: "x", inactive: [{ name: "a" }], actionsTaken: [1] })).toContain("actionsTaken");
		expect(runtime.parse({ userRequest: "x", inactive: [{ name: "a" }] })).toMatchObject({
			actionsTaken: [],
			inactive: [{ name: "a", description: "" }],
		});
	});

	test("score measures recall, precision and false activation", () => {
		const routed = (names: string[]) => ({
			status: "routed" as const,
			reason: "",
			notes: [],
			activate: names.map((name) => ({ name, p: 0.5 })),
		});
		expect(findTool.score(["a", "b"], routed(["a", "c"]))).toMatchObject({ recall: 0.5, precision: 0.5, exact: 0 });
		expect(findTool.score([], routed([]))).toMatchObject({ exact: 1, falseActivation: 0 });
		expect(findTool.score([], routed(["a"]))).toMatchObject({ exact: 0, falseActivation: 1 });
		expect(findTool.score(["a"], { status: "unavailable", reason: "", notes: [] })).toMatchObject({ answered: 0 });
	});
});

describe("find_tool v2 families and none ceiling", () => {
	test("a family member brings the offered siblings along", () => {
		const known = new Set(["browser_navigate", "browser_screenshot", "web_search"]);
		expect(companions([{ name: "browser_navigate" }], known, [["browser_*"]])).toEqual(["browser_screenshot"]);
		expect(companions([{ name: "web_search" }], known, [["browser_*"]])).toEqual([]);
	});
});
