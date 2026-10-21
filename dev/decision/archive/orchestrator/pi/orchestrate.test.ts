import { describe, expect, test } from "bun:test";
import type { OrchestrateResult } from "./client.ts";
import { availableRoles, orchestrationMessage, planInstruction, subagentRoles, usableSteps } from "./orchestrate.ts";

const discovered = [
	{ name: "shared-sub-debug", description: "debug" },
	{ name: "shared-sub-explore", description: "explore" },
	{ name: "shared-sub-general", description: "general" },
	{ name: "codex-sub-explorer", description: "codex explore" },
	{ name: "my-private-agent", description: "mine" },
];

describe("availableRoles", () => {
	test("offers the shared roles and never a user-defined agent", () => {
		const roles = availableRoles(discovered, (name) => name);
		expect(roles.map((r) => r.name)).toEqual(["shared-sub-explore", "shared-sub-general", "shared-sub-debug"]);
	});

	test("a shared role the family maps elsewhere is offered under the family's name", () => {
		const map = (name: string) => (name === "shared-sub-explore" ? "codex-sub-explorer" : name);
		expect(availableRoles(discovered, map).map((r) => r.name)).toEqual([
			"codex-sub-explorer",
			"shared-sub-general",
			"shared-sub-debug",
		]);
	});

	test("a missing role is left out rather than invented", () => {
		expect(availableRoles(discovered.slice(1, 2), (n) => n).map((r) => r.name)).toEqual(["shared-sub-explore"]);
		expect(availableRoles([], (n) => n)).toEqual([]);
	});
});

const result = (plan: OrchestrateResult["plan"], roles: string[]): OrchestrateResult => ({
	status: "routed",
	reason: "ok",
	notes: [],
	plan,
	steps: roles.map((role) => ({ role, p: 0.8 })),
});

describe("planInstruction / orchestrationMessage", () => {
	const offered = [
		{ name: "shared-sub-explore", description: "" },
		{ name: "shared-sub-general", description: "" },
	];

	test("fanout names parallel mode, staged names chain mode, single one call", () => {
		const steps = result("fanout", ["shared-sub-explore", "shared-sub-general"]).steps;
		expect(planInstruction("fanout", steps)).toContain("parallel mode");
		expect(planInstruction("staged", steps)).toContain("chain mode");
		expect(planInstruction("staged", steps)).toContain("{previous}");
		const single = planInstruction("single", steps);
		expect(single).toContain("single mode");
		expect(single).toContain("shared-sub-explore");
		expect(single).not.toContain("shared-sub-general");
	});

	test("no usable steps → do it directly", () => {
		expect(planInstruction("fanout", [])).toContain("Do the task yourself");
	});

	test("roles outside the offered set are dropped from the plan", () => {
		const r = result("fanout", ["shared-sub-explore", "made-up-role"]);
		expect(usableSteps(r, offered).map((s) => s.role)).toEqual(["shared-sub-explore"]);
		const message = orchestrationMessage("map the repo", r, offered);
		expect(message.startsWith("map the repo")).toBe(true);
		expect(message).not.toContain("made-up-role");
	});
});

describe("subagentRoles", () => {
	test("collects agents from single, parallel and chain calls", () => {
		expect(subagentRoles({ agent: "a", task: "t" })).toEqual(["a"]);
		expect(subagentRoles({ tasks: [{ agent: "a" }, { agent: "b" }] })).toEqual(["a", "b"]);
		expect(subagentRoles({ chain: [{ agent: "a" }, { agent: "a" }] })).toEqual(["a"]);
		expect(subagentRoles(null)).toEqual([]);
		expect(subagentRoles({ tasks: [null, 3] })).toEqual([]);
	});
});
