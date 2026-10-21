/**
 * Pure `/orchestrate` policy for pi: the roles this session may offer the daemon, and the user
 * message that turns the daemon's plan into `subagent` tool calls.
 *
 * Only roles that exist upstream are offered (subagent rule): the three shared roles, plus the
 * parent family's own role when `family-agent.ts` maps a shared role onto it. The daemon returns
 * roles only; this module writes the steps' task instructions for the model to fill in.
 */

import type { OrchestratePlan, OrchestrateResult, RoleSpec } from "./client.ts";

export const ORCHESTRATE_ENTRY_TYPE = "decision-orchestrate";
export const SHARED_ROLE_NAMES = ["shared-sub-explore", "shared-sub-general", "shared-sub-debug"] as const;

export interface AgentListing {
	name: string;
	description: string;
}

/**
 * Roles offered to the daemon. `mapShared` is `familyAgentForShared` for the parent family: a
 * shared role the family maps elsewhere is offered under the family's name, which is what the
 * subagent tool runs.
 */
export function availableRoles(discovered: readonly AgentListing[], mapShared: (name: string) => string): RoleSpec[] {
	const byName = new Map(discovered.map((agent) => [agent.name, agent]));
	const roles: RoleSpec[] = [];
	for (const shared of SHARED_ROLE_NAMES) {
		const name = mapShared(shared);
		const agent = byName.get(name) ?? byName.get(shared);
		if (!agent) continue;
		if (roles.some((role) => role.name === agent.name)) continue;
		roles.push({ name: agent.name, description: agent.description });
	}
	return roles;
}

function stepLines(steps: OrchestrateResult["steps"]): string {
	return steps.map((step, index) => `${index + 1}. agent: ${step.role}`).join("\n");
}

/** The roles of a plan that the session actually offered; the rest are dropped. */
export function usableSteps(result: OrchestrateResult, offered: readonly RoleSpec[]): OrchestrateResult["steps"] {
	const names = new Set(offered.map((role) => role.name));
	return result.steps.filter((step) => names.has(step.role));
}

/** How the plan reads in the message sent to the model. */
export function planInstruction(plan: OrchestratePlan, steps: OrchestrateResult["steps"]): string {
	if (steps.length === 0) {
		return "Plan: single. Do the task yourself with your own tools; no subagent is needed.";
	}
	if (plan === "fanout") {
		return [
			"Plan: fanout. Call the `subagent` tool once in parallel mode (`tasks` array), one task per step below.",
			"Write each task from the request so the steps do not overlap, give each the context it needs, then merge the results.",
			stepLines(steps),
		].join("\n");
	}
	if (plan === "staged") {
		return [
			"Plan: staged. Call the `subagent` tool once in chain mode (`chain` array), steps in this order.",
			"Write each step's task from the request; later steps use {previous} for the step before them.",
			stepLines(steps),
		].join("\n");
	}
	return [
		"Plan: single. Call the `subagent` tool once in single mode with the agent below and a task written from the request.",
		stepLines(steps.slice(0, 1)),
	].join("\n");
}

/** The user message that carries the task and the daemon's plan. */
export function orchestrationMessage(task: string, result: OrchestrateResult, offered: readonly RoleSpec[]): string {
	const plan = result.plan ?? "single";
	return [
		task,
		"",
		"---",
		"Orchestration plan from the decision daemon (advisory; adjust it if the code contradicts it). Use the agent names exactly as written.",
		planInstruction(plan, usableSteps(result, offered)),
	].join("\n");
}

/** Roles a `subagent` tool call names, across single, parallel, and chain modes. */
export function subagentRoles(input: unknown): string[] {
	if (typeof input !== "object" || input === null) return [];
	const record = input as { agent?: unknown; tasks?: unknown; chain?: unknown };
	const names: string[] = [];
	if (typeof record.agent === "string") names.push(record.agent);
	for (const list of [record.tasks, record.chain]) {
		if (!Array.isArray(list)) continue;
		for (const item of list) {
			const agent = (item as { agent?: unknown } | null)?.agent;
			if (typeof agent === "string") names.push(agent);
		}
	}
	return [...new Set(names)];
}
