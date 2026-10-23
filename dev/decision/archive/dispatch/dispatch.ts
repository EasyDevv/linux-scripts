/**
 * dispatch: where one sentence typed into the dashboard goes (CONTRACTS.md › dispatch).
 *
 * Code splits the sentence at its connectors and reads the axes the person fixed; Jev judges each
 * item's kind, mode, trigger, end and area. Code composes those into items with a confidence `p`
 * the dashboard compares against its own threshold. It never runs anything: the dashboard does.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClassifierAnswer, ClassifierQuestion, JsonObject } from "@earendil-works/pi-ai";
import type { DecideRequest } from "../engine.ts";
import { skipReason } from "./model-route.ts";
import { type Decide, type FeatureDef, type FeatureResult, isRecord, num, str, strings } from "./types.ts";

export type DispatchKind = "task" | "goal" | "routine" | "org-edit" | "answer";
export type DispatchMode = "worktree" | "plain";
export type DispatchWhen = "now" | "schedule" | "watch-once" | "watch-each";
export type DispatchEnd = "none" | "milestones" | "until" | "deadline";

const KINDS: readonly DispatchKind[] = ["task", "goal", "routine", "org-edit", "answer"];
const MODES: readonly DispatchMode[] = ["worktree", "plain"];
const UNKNOWN_AREA = "unknown";

export interface DispatchPrompt {
	version: string;
	connectors: { split: string[]; after: string[]; joinIfOnly: string[] };
	/** `vagueThreshold`: a goal or routine without a target this sure is asked back as both. */
	limits: { maxItems: number; pathsMax: number; vagueThreshold: number };
	questions: Record<string, { type: ClassifierQuestion["type"]; instructions: string; criteria?: unknown }>;
}

export function loadDispatchPrompt(
	version = "v1",
	dir = join(import.meta.dir, "..", "prompts", "dispatch"),
): DispatchPrompt {
	return JSON.parse(readFileSync(join(dir, `${version}.json`), "utf8")) as DispatchPrompt;
}

export interface DispatchInput {
	prompt: string;
	harness?: string;
	sessionId?: string;
	scope: { page?: string; project?: string; projects: string[] };
	fixed: { kind?: DispatchKind; mode?: DispatchMode; scope?: string[] };
	state: { plainRunning: boolean; plainPaths: string[]; tasks: number; projects: string[]; paths: string[] };
}

export interface DispatchItem {
	text: string;
	kind: DispatchKind;
	projects: string[];
	mode?: DispatchMode;
	ownedPaths: string[];
	when: DispatchWhen;
	end: DispatchEnd;
	after?: number;
	p: number;
	/** What to offer when `p` is low: the two likeliest kinds, or both modes when the mode is the unsure axis. */
	choices: string[];
	reason: string;
}

export interface DispatchResult extends FeatureResult {
	items?: DispatchItem[];
}

/** One clause of the sentence, and whether it waits for the one before it. */
export interface Clause {
	text: string;
	after: boolean;
}

function escape(text: string) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Cuts the sentence at its connectors. A split connector that ends a verb (`고,`) keeps the verb
 * in the clause before it; an after-connector (`끝나면`) starts a clause that waits. A trailing
 * clause that only says "merge" belongs to the clause before it (a Gate condition, not an item).
 */
export function splitClauses(prompt: string, connectors: DispatchPrompt["connectors"], max = 6): Clause[] {
	const marks = [
		...connectors.split.map((word) => ({ word, after: false })),
		...connectors.after.map((word) => ({ word, after: true })),
	].sort((a, b) => b.word.length - a.word.length);
	const pattern = new RegExp(marks.map((mark) => escape(mark.word)).join("|"), "gi");
	const clauses: Clause[] = [];
	let start = 0;
	let waits = false;
	for (const match of prompt.matchAll(pattern)) {
		const mark = marks.find((entry) => entry.word.toLowerCase() === match[0].toLowerCase());
		if (!mark) continue;
		// `고,` keeps `고` with its verb; `하고 ` keeps `하고` as well. An after-connector belongs to neither.
		const keep = mark.after ? 0 : match[0].replace(/[,，;\s]+$/, "").length;
		const end = match.index + keep;
		const text = prompt.slice(start, end).trim();
		if (text) clauses.push({ text, after: waits });
		start = match.index + match[0].length;
		waits = mark.after;
	}
	const rest = prompt.slice(start).trim();
	if (rest) clauses.push({ text: rest, after: waits });
	const only = new Set(connectors.joinIfOnly.map((word) => word.toLowerCase()));
	const joined: Clause[] = [];
	for (const clause of clauses) {
		const previous = joined.at(-1);
		if (previous && only.has(clause.text.toLowerCase().replace(/[.!~]+$/, ""))) {
			previous.text = `${previous.text} ${clause.text}`;
			continue;
		}
		joined.push({ ...clause });
	}
	if (joined.length <= max) return joined;
	return [...joined.slice(0, max - 1), { text: joined.slice(max - 1).map((c) => c.text).join(" "), after: false }];
}

/** The registered projects a clause names, by whole word, in the order they appear. */
export function projectsIn(text: string, projects: string[]): string[] {
	const lower = text.toLowerCase();
	return projects
		.map((name) => ({ name, at: lower.search(new RegExp(`(^|[^a-z0-9_-])${escape(name.toLowerCase())}(?![a-z0-9_-])`)) }))
		.filter((hit) => hit.at >= 0)
		.sort((a, b) => a.at - b.at)
		.map((hit) => hit.name);
}

function questionsFor(prompt: DispatchPrompt, input: DispatchInput): Record<string, ClassifierQuestion> {
	const out: Record<string, ClassifierQuestion> = {};
	for (const [id, q] of Object.entries(prompt.questions)) {
		if ((id === "kind" || id === "vague_target") && input.fixed.kind) continue;
		// A fixed mode, or a fixed kind that is not a task, leaves nothing for mode to decide.
		if (id === "mode" && (input.fixed.mode || (input.fixed.kind && input.fixed.kind !== "task"))) continue;
		if (id === "area") {
			const paths = input.state.paths.slice(0, prompt.limits.pathsMax);
			if (paths.length === 0) continue;
			const criteria: Record<string, string> = { [UNKNOWN_AREA]: "No folder in particular, or many" };
			for (const path of paths) criteria[path] = `Changes under ${path}`;
			out[id] = { ...q, criteria } as ClassifierQuestion;
			continue;
		}
		out[id] = q as ClassifierQuestion;
	}
	return out;
}

export function buildRequest(clause: string, input: DispatchInput, prompt: DispatchPrompt): DecideRequest {
	const state: JsonObject = {
		item: clause,
		whole: input.prompt,
		page: input.scope.page ?? null,
		project: input.scope.project ?? null,
		projects: input.state.projects,
		paths: input.state.paths.slice(0, prompt.limits.pathsMax),
		state: { plainRunning: input.state.plainRunning, runningTasks: input.state.tasks },
	};
	return {
		feature: "dispatch",
		version: prompt.version,
		state,
		questions: questionsFor(prompt, input),
		harness: input.harness,
		sessionId: input.sessionId,
	};
}

function choice(answer: ClassifierAnswer | undefined): { value?: string; confidence: number } {
	return answer?.type === "choice" ? { value: answer.choice, confidence: answer.confidence } : { confidence: 0 };
}

/** One item from Jev's answers about one clause, with the fixed axes laid over them. */
/** The two likeliest kinds by Jev's probabilities; a fixed kind stands alone. */
function choicesOf(kind: DispatchKind, answer: ClassifierAnswer | undefined, fixed: boolean): string[] {
	if (fixed || answer?.type !== "choice") return [kind];
	const ranked = Object.entries(answer.probabilities)
		.filter(([name]) => KINDS.includes(name as DispatchKind))
		.sort((a, b) => b[1] - a[1])
		.map(([name]) => name as DispatchKind);
	return [kind, ...ranked.filter((name) => name !== kind)].slice(0, 2);
}

export function compose(
	clause: Clause,
	index: number,
	answers: Record<string, ClassifierAnswer>,
	input: DispatchInput,
	vagueThreshold = 0.5,
): DispatchItem {
	const kindAnswer = choice(answers.kind);
	const kind = input.fixed.kind ?? (KINDS.includes(kindAnswer.value as DispatchKind) ? (kindAnswer.value as DispatchKind) : "task");
	const kindP = input.fixed.kind ? 1 : kindAnswer.confidence;
	const modeAnswer = choice(answers.mode);
	const mode =
		kind === "task"
			? (input.fixed.mode ?? (MODES.includes(modeAnswer.value as DispatchMode) ? (modeAnswer.value as DispatchMode) : "worktree"))
			: undefined;
	const modeP = kind !== "task" || input.fixed.mode ? 1 : modeAnswer.confidence;
	const when = (choice(answers.trigger).value as DispatchWhen | undefined) ?? "now";
	const end = (choice(answers.end).value as DispatchEnd | undefined) ?? "none";
	const area = choice(answers.area).value;
	const projects = input.fixed.scope?.length
		? input.fixed.scope
		: (() => {
				const named = projectsIn(clause.text, input.state.projects);
				return named.length ? named : input.scope.project ? [input.scope.project] : [];
			})();
	// The weaker axis is the one asked back: two kinds, or worktree · plain.
	let choices =
		mode && modeP < kindP
			? [mode, mode === "worktree" ? "plain" : "worktree"]
			: choicesOf(kind, answers.kind, Boolean(input.fixed.kind));
	let sure = Math.min(kindP, modeP);
	const vague = answers.vague_target?.type === "bool" ? answers.vague_target.probability : 0;
	const parts = [`${kind}${input.fixed.kind ? " (fixed)" : ` ${kindP.toFixed(2)}`}`];
	// "Improve it every week" ends where a target is named: goal or routine is the person's call.
	if (!input.fixed.kind && (kind === "goal" || kind === "routine") && vague >= vagueThreshold) {
		choices = ["goal", "routine"];
		sure = Math.min(sure, 1 - vague);
		parts.push(`no target ${vague.toFixed(2)}`);
	}
	const p = Math.round(sure * 100) / 100;
	if (mode) parts.push(`${mode}${input.fixed.mode ? " (fixed)" : ` ${modeP.toFixed(2)}`}`);
	if (when !== "now") parts.push(when);
	if (end !== "none") parts.push(`end ${end}`);
	return {
		text: clause.text,
		kind,
		projects,
		...(mode ? { mode } : {}),
		ownedPaths: area && area !== UNKNOWN_AREA ? [area] : [],
		when,
		end,
		...(clause.after && index > 0 ? { after: index - 1 } : {}),
		p,
		choices,
		reason: parts.join(" · "),
	};
}

export async function dispatch(input: DispatchInput, decide: Decide, prompt: DispatchPrompt): Promise<DispatchResult> {
	const skip = skipReason({ prompt: input.prompt });
	if (skip && skip !== "slash command") return { status: "skipped", reason: skip, notes: [] };
	const clauses = splitClauses(input.prompt.trim(), prompt.connectors, prompt.limits.maxItems);
	const decisions = await Promise.all(clauses.map((clause) => decide(buildRequest(clause.text, input, prompt))));
	const failed = decisions.find((decision) => decision.status !== "ok");
	if (failed) {
		return { decisionId: failed.decisionId, status: "unavailable", reason: "no backend answered", notes: failed.skipped };
	}
	const items = clauses.map((clause, index) =>
		compose(clause, index, decisions[index].answers, input, prompt.limits.vagueThreshold),
	);
	return {
		decisionId: decisions[0]?.decisionId,
		status: "routed",
		items,
		reason: items.map((item) => item.reason).join(" | "),
		notes: clauses.length > 1 ? [`split into ${clauses.length}`] : [],
		backend: decisions[0]?.backend,
		calibrated: decisions.every((decision) => decision.calibrated),
		latencyMs: Math.max(0, ...decisions.map((decision) => decision.latencyMs)),
	};
}

function parseInput(b: Record<string, unknown>): DispatchInput | string {
	const prompt = str(b.prompt);
	if (prompt === undefined) return "prompt is required";
	const scope = isRecord(b.scope) ? b.scope : {};
	const fixed = isRecord(b.fixed) ? b.fixed : {};
	const state = isRecord(b.state) ? b.state : {};
	const kind = str(fixed.kind);
	const mode = str(fixed.mode);
	return {
		prompt,
		harness: str(b.harness),
		sessionId: str(b.sessionId),
		scope: { page: str(scope.page), project: str(scope.project), projects: strings(scope.projects) ?? [] },
		fixed: {
			kind: KINDS.includes(kind as DispatchKind) ? (kind as DispatchKind) : undefined,
			mode: MODES.includes(mode as DispatchMode) ? (mode as DispatchMode) : undefined,
			scope: strings(fixed.scope),
		},
		state: {
			plainRunning: state.plainRunning === true,
			plainPaths: strings(state.plainPaths) ?? [],
			tasks: num(state.tasks) ?? 0,
			projects: strings(state.projects) ?? [],
			paths: strings(state.paths) ?? [],
		},
	};
}

export const dispatchFeature: FeatureDef = {
	name: "dispatch",
	path: "/v1/dispatch",
	load(version) {
		const prompt = loadDispatchPrompt(version);
		return {
			version: prompt.version,
			parse: parseInput,
			run: (input, decide) => dispatch(input as DispatchInput, decide, prompt),
		};
	},
	/** `expected`: `{kind, mode?, items?, asks?}` for the first item, the item count, and whether to ask back. */
	score(expected, result): Record<string, number> {
		if (!isRecord(expected)) return {};
		const items = (result as DispatchResult).items;
		if (!items?.length) return { kind: 0, answered: 0 };
		const first = items[0];
		const out: Record<string, number> = { kind: Number(first.kind === expected.kind), answered: 1 };
		if (typeof expected.mode === "string") out.mode = Number(first.mode === expected.mode);
		if (typeof expected.items === "number") out.items = Number(items.length === expected.items);
		// `asks`: whether the dashboard should ask back (some item under its 0.7 threshold).
		if (typeof expected.asks === "boolean") out.asks = Number(items.some((item) => item.p < 0.7) === expected.asks);
		return out;
	},
};
