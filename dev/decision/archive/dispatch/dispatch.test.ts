import { describe, expect, test } from "bun:test";
import type { ClassifierAnswer } from "@earendil-works/pi-ai";
import type { DecideRequest, Decision } from "../engine.ts";
import { compose, dispatch, type DispatchInput, loadDispatchPrompt, projectsIn, splitClauses } from "./dispatch.ts";

const prompt = loadDispatchPrompt("v1");

function input(text: string, extra: Partial<DispatchInput> = {}): DispatchInput {
	return {
		prompt: text,
		scope: { projects: [] },
		fixed: {},
		state: { plainRunning: false, plainPaths: [], tasks: 0, projects: ["dev-selector", "scroll-detox", "blog"], paths: ["apps/server", "apps/client"] },
		...extra,
	};
}

function pick(choice: string, confidence = 0.9): ClassifierAnswer {
	return { type: "choice", choice, probabilities: { [choice]: confidence }, confidence };
}

function decided(answers: Record<string, ClassifierAnswer>): (request: DecideRequest) => Promise<Decision> {
	return async () => ({ status: "ok", decisionId: "d", calibrated: true, answers, latencyMs: 5, costUsd: 0, cached: false, skipped: [] });
}

describe("dispatch split", () => {
	test("a connector ending a verb keeps the verb", () => {
		const clauses = splitClauses("지금 서버 에러 메시지 고치고, 앞으로 에러 메시지 규칙은 매주 점검", prompt.connectors);
		expect(clauses.map((c) => c.text)).toEqual(["지금 서버 에러 메시지 고치고", "앞으로 에러 메시지 규칙은 매주 점검"]);
		expect(clauses[1].after).toBe(false);
	});

	test("끝나면 makes the next item wait", () => {
		const clauses = splitClauses("릴리스 노트 쓰고 끝나면 blog 프로젝트에 초안 올려", prompt.connectors);
		expect(clauses).toEqual([
			{ text: "릴리스 노트 쓰고", after: false },
			{ text: "blog 프로젝트에 초안 올려", after: true },
		]);
	});

	test("a lone merge stays with its item, and commas between projects never split", () => {
		const clauses = splitClauses("dev-selector, scroll-detox 의존성 매달 올리고 테스트 통과하면 머지", prompt.connectors);
		expect(clauses).toHaveLength(1);
		expect(splitClauses("dev-selector, scroll-detox 에 보안점검 실시", prompt.connectors)).toHaveLength(1);
	});

	test("projects are read by whole name in order", () => {
		expect(projectsIn("scroll-detox 랑 dev-selector", ["dev-selector", "scroll-detox", "dev"])).toEqual(["scroll-detox", "dev-selector"]);
	});
});

describe("dispatch compose", () => {
	test("p is the weakest asked axis; fixed axes count as sure", () => {
		const item = compose({ text: "x", after: false }, 0, { kind: pick("task", 0.9), mode: pick("plain", 0.6) }, input("x"));
		expect(item.p).toBe(0.6);
		// The unsure axis is the mode: offer both modes, not kinds.
		expect(item.choices).toEqual(["plain", "worktree"]);
		const fixed = compose({ text: "x", after: false }, 0, { kind: pick("task", 0.9) }, input("x", { fixed: { mode: "worktree" } }));
		expect(fixed).toMatchObject({ mode: "worktree", p: 0.9 });
	});

	test("an area answer becomes ownedPaths, unknown none", () => {
		const a = compose({ text: "x", after: false }, 0, { kind: pick("task"), mode: pick("worktree"), area: pick("apps/server") }, input("x"));
		expect(a.ownedPaths).toEqual(["apps/server"]);
		const b = compose({ text: "x", after: false }, 0, { kind: pick("task"), mode: pick("worktree"), area: pick("unknown") }, input("x"));
		expect(b.ownedPaths).toEqual([]);
	});

	test("a fixed kind is never asked", async () => {
		let asked: string[] = [];
		const run = await dispatch(input("매주 보안 점검", { fixed: { kind: "routine", scope: ["blog"] } }), async (request) => {
			asked = Object.keys(request.questions);
			return (await decided({ trigger: pick("schedule"), end: pick("none") })(request));
		}, prompt);
		expect(asked).not.toContain("kind");
		expect(asked).not.toContain("mode");
		expect(run.items?.[0]).toMatchObject({ kind: "routine", projects: ["blog"], when: "schedule", p: 1 });
	});

	test("no backend → unavailable, an acknowledgement skips", async () => {
		const down = await dispatch(input("서버 에러 고쳐"), async () => ({ status: "unavailable", decisionId: "d", calibrated: false, answers: {}, latencyMs: 1, costUsd: 0, cached: false, skipped: ["x"] }), prompt);
		expect(down.status).toBe("unavailable");
		const ack = await dispatch(input("ㅇㅋ"), decided({}), prompt);
		expect(ack.status).toBe("skipped");
	});
});

describe("dispatch vague target", () => {
	test("improvement with no target asks goal or routine", () => {
		const item = compose({ text: "매주 개선해줘", after: false }, 0, { kind: pick("routine", 0.95), vague_target: { type: "bool", probability: 0.8 } }, input("매주 개선해줘"));
		expect(item.choices).toEqual(["goal", "routine"]);
		expect(item.p).toBeLessThan(0.7);
	});
});
