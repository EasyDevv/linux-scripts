/**
 * loop: is a session stuck, and did a delegated run fail the same way it is being retried?
 *
 * Ported from pydantic-ai-harness LoopDetection (PR #336): exact repetition in a sliding window,
 * the same result over and over (error cycle), A-B alternation, and near-identical monologues.
 * Added here: the runaway turn (an announced action, then the turn ends with no tool call) and
 * the Maker checks (the same task dispatched twice; a dispatch after a failure). Counters are code;
 * Jev is asked only where a sentence must be read: whether a promise-shaped ending really stopped
 * short, and what kind of failure a retried run hit.
 *
 * The daemon keeps each session's counters in memory (a restart forgets them, which only delays a
 * nudge). The harness applies: `nudge` goes into the model's next read, `continue` forces one more
 * turn, `shadow` is recorded and shown, never sent to the model.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClassifierQuestion, JsonObject } from "@earendil-works/pi-ai";
import type { Decide, FeatureDef, FeatureResult } from "./types.ts";
import { isRecord, str } from "./types.ts";

export interface LoopPrompt {
	version: string;
	limits: {
		repeatThreshold: number;
		window: number;
		errorCycleThreshold: number;
		alternationCycles: number;
		monologueThreshold: number;
		monologuePrefixChars: number;
		runawayTailChars: number;
		runawayThreshold: number;
		runawayPerPrompt: number;
		failureConfidence: number;
		outputChars: number;
	};
	makerTools: string[];
	promise: Record<string, string>;
	runaway: ClassifierQuestion;
	failure: ClassifierQuestion;
	advice: Record<string, string>;
}

export function loadLoopPrompt(version = "v1", dir = join(import.meta.dir, "..", "prompts", "loop")): LoopPrompt {
	return JSON.parse(readFileSync(join(dir, `${version}.json`), "utf8")) as LoopPrompt;
}

export type LoopEvent =
	| { kind: "prompt"; text?: string }
	| { kind: "call"; tool: string; args?: unknown }
	| { kind: "result"; tool: string; args?: unknown; output?: string; isError?: boolean }
	| { kind: "answer"; text: string };

export interface LoopInput {
	sessionId: string;
	harness?: string;
	/** A subagent's own loop inside the session; counted apart from the main loop. */
	agentId?: string;
	events: LoopEvent[];
}

export type LoopTier =
	| "exact_repetition"
	| "error_cycle"
	| "alternation"
	| "monologue"
	| "runaway"
	| "maker_duplicate"
	| "maker_retry";

export interface LoopDetection {
	tier: LoopTier;
	/** nudge: the model reads `message` next; continue: one more turn with it; shadow: record only. */
	action: "nudge" | "continue" | "shadow";
	tool?: string;
	count: number;
	message: string;
	failureClass?: string;
}

export interface LoopResult extends FeatureResult {
	detections: LoopDetection[];
}

const MARKER = "[harness:loop-detection]";
const CHANGE_APPROACH = "Change approach, or state plainly what is blocking you.";

interface SessionLoop {
	seenAt: number;
	calls: string[];
	alternation: string[];
	lastOutcome?: string;
	outcomeRepeats: number;
	lastMonologue?: string;
	monologueRepeats: number;
	request?: string;
	runawayThisPrompt: number;
	makerTasks: Set<string>;
	/** The last delegated run that failed, until the next dispatch. */
	makerFailure?: { task: string; output: string };
}

const MAX_SESSIONS = 500;
const SESSION_TTL_MS = 6 * 60 * 60_000;

export class LoopStore {
	private readonly sessions = new Map<string, SessionLoop>();
	constructor(private readonly now: () => number = Date.now) {}

	get(key: string): SessionLoop {
		const at = this.now();
		let state = this.sessions.get(key);
		if (!state || at - state.seenAt > SESSION_TTL_MS) {
			state = {
				seenAt: at,
				calls: [],
				alternation: [],
				outcomeRepeats: 0,
				monologueRepeats: 0,
				runawayThisPrompt: 0,
				makerTasks: new Set(),
			};
		}
		state.seenAt = at;
		// Re-insert so the map's order is least recently seen first.
		this.sessions.delete(key);
		this.sessions.set(key, state);
		while (this.sessions.size > MAX_SESSIONS) {
			const oldest = this.sessions.keys().next().value;
			if (oldest === undefined) break;
			this.sessions.delete(oldest);
		}
		return state;
	}
}

/** Stable, key-order-independent text for a call's arguments; long values are hashed. */
export function canonicalArgs(args: unknown): string {
	if (args === undefined || args === null) return "";
	let value: unknown = args;
	if (typeof args === "string") {
		try {
			value = JSON.parse(args);
		} catch {
			return args.length > 400 ? `#${Bun.hash(args).toString(36)}` : args;
		}
	}
	const sorted = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(sorted);
		if (isRecord(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]));
		if (typeof v === "string" && v.length > 400) return `#${Bun.hash(v).toString(36)}`;
		return v;
	};
	return JSON.stringify(sorted(value));
}

export function fingerprint(tool: string, args: unknown): string {
	return `${tool}(${canonicalArgs(args)})`;
}

function toolOf(fp: string): string {
	return fp.split("(", 1)[0] ?? fp;
}

/** The task text a delegation carries, whatever the harness calls it. */
export function makerTask(args: unknown): string | undefined {
	if (!isRecord(args)) return undefined;
	const parts: string[] = [];
	for (const key of ["agent", "subagent_type", "task", "prompt"]) {
		const v = args[key];
		if (typeof v === "string" && v.trim()) parts.push(v.trim());
	}
	if (Array.isArray(args.tasks)) parts.push(canonicalArgs(args.tasks));
	if (Array.isArray(args.chain)) parts.push(canonicalArgs(args.chain));
	return parts.length > 0 ? parts.join("\n").replace(/\s+/g, " ").toLowerCase() : undefined;
}

function alternating(tail: string[], cycles: number): [string, string] | undefined {
	const needed = cycles * 2;
	if (tail.length < needed) return undefined;
	const last = tail.slice(-needed);
	const [a, b] = last;
	if (a === undefined || b === undefined || a === b) return undefined;
	return last.every((fp, i) => fp === (i % 2 === 0 ? a : b)) ? [a, b] : undefined;
}

function normalize(text: string, chars: number): string {
	return text.split(/\s+/).join(" ").trim().toLowerCase().slice(0, chars);
}

/** A promise-shaped ending: the rule that decides whether Jev is asked at all. */
export function promiseShaped(text: string, prompt: LoopPrompt): boolean {
	const tail = text.trim().slice(-prompt.limits.runawayTailChars);
	if (!tail || /[?？]\s*$/.test(tail)) return false;
	const lastSentence = tail.split(/(?<=[.!。])\s+|\n+/).filter(Boolean).pop() ?? tail;
	return Object.values(prompt.promise).some((source) => new RegExp(source, "iu").test(lastSentence));
}

function observeCall(state: SessionLoop, fp: string, prompt: LoopPrompt): LoopDetection | undefined {
	const l = prompt.limits;
	state.calls.push(fp);
	if (state.calls.length > l.window) state.calls.shift();
	state.alternation.push(fp);
	if (state.alternation.length > l.alternationCycles * 2) state.alternation.shift();
	state.lastMonologue = undefined;
	state.monologueRepeats = 0;

	const count = state.calls.filter((c) => c === fp).length;
	if (count >= l.repeatThreshold) {
		state.calls = [];
		state.alternation = [];
		return {
			tier: "exact_repetition",
			action: "nudge",
			tool: toolOf(fp),
			count,
			message: `${MARKER} You appear to be repeating the same action (\`${toolOf(fp)}\` called ${count} times with identical arguments). ${CHANGE_APPROACH}`,
		};
	}
	const pair = alternating(state.alternation, l.alternationCycles);
	if (pair) {
		state.alternation = [];
		const [a, b] = pair.map(toolOf);
		return {
			tier: "alternation",
			action: "nudge",
			tool: a,
			count: l.alternationCycles,
			message: `${MARKER} You appear to be alternating between \`${a}\` and \`${b}\` without making progress (${l.alternationCycles} cycles). ${CHANGE_APPROACH}`,
		};
	}
	return undefined;
}

function observeResult(state: SessionLoop, fp: string, output: string, prompt: LoopPrompt): LoopDetection | undefined {
	const outcome = `${fp}=>${Bun.hash(output).toString(36)}`;
	if (outcome === state.lastOutcome) state.outcomeRepeats += 1;
	else {
		state.lastOutcome = outcome;
		state.outcomeRepeats = 1;
	}
	if (state.outcomeRepeats < prompt.limits.errorCycleThreshold) return undefined;
	const count = state.outcomeRepeats;
	state.lastOutcome = undefined;
	state.outcomeRepeats = 0;
	return {
		tier: "error_cycle",
		action: "nudge",
		tool: toolOf(fp),
		count,
		message: `${MARKER} The tool \`${toolOf(fp)}\` returned the same result ${count} times in a row; repeating it is not making progress. ${CHANGE_APPROACH}`,
	};
}

function observeMonologue(state: SessionLoop, text: string, prompt: LoopPrompt): LoopDetection | undefined {
	const normalized = normalize(text, prompt.limits.monologuePrefixChars);
	if (!normalized) return undefined;
	if (state.lastMonologue === normalized) state.monologueRepeats += 1;
	else state.monologueRepeats = 1;
	state.lastMonologue = normalized;
	if (state.monologueRepeats < prompt.limits.monologueThreshold) return undefined;
	const count = state.monologueRepeats;
	state.lastMonologue = undefined;
	state.monologueRepeats = 0;
	return {
		tier: "monologue",
		action: "nudge",
		count,
		message: `${MARKER} You have produced ${count} near-identical responses without taking any action. Take a concrete next step, or state plainly what is blocking you.`,
	};
}

interface Asked {
	decisionId?: string;
	backend?: string;
	unavailable?: boolean;
}

async function askRunaway(
	text: string,
	state: SessionLoop,
	input: LoopInput,
	prompt: LoopPrompt,
	decide: Decide,
	asked: Asked,
): Promise<LoopDetection | undefined> {
	const state_: JsonObject = {
		final_text: text.trim().slice(-prompt.limits.runawayTailChars),
		request: state.request ? state.request.slice(0, 1200) : null,
	};
	const decision = await decide({
		feature: "loop",
		version: prompt.version,
		state: state_,
		questions: { runaway: prompt.runaway },
		harness: input.harness,
		sessionId: input.sessionId,
	});
	asked.decisionId = decision.decisionId;
	asked.backend = decision.backend;
	if (decision.status !== "ok") {
		asked.unavailable = true;
		return undefined;
	}
	const answer = decision.answers.runaway;
	const p = answer?.type === "bool" ? answer.probability : 0;
	if (p < prompt.limits.runawayThreshold) return undefined;
	state.runawayThisPrompt += 1;
	return {
		tier: "runaway",
		action: "continue",
		count: 1,
		message: `${MARKER} Your last message said you would act next, but the turn ended without a tool call (p=${p.toFixed(2)}). Do that step now, or say plainly why you stopped.`,
	};
}

async function askFailure(
	failure: { task: string; output: string },
	input: LoopInput,
	prompt: LoopPrompt,
	decide: Decide,
	asked: Asked,
): Promise<{ failureClass?: string; advice?: string }> {
	const decision = await decide({
		feature: "loop",
		version: prompt.version,
		state: { output: failure.output.slice(-prompt.limits.outputChars), task: failure.task.slice(0, 600) },
		questions: { failure: prompt.failure },
		harness: input.harness,
		sessionId: input.sessionId,
	});
	asked.decisionId = decision.decisionId;
	asked.backend = decision.backend;
	if (decision.status !== "ok") {
		asked.unavailable = true;
		return {};
	}
	const answer = decision.answers.failure;
	if (answer?.type !== "choice" || answer.confidence < prompt.limits.failureConfidence) return {};
	return { failureClass: answer.choice, advice: prompt.advice[answer.choice] };
}

export async function observe(input: LoopInput, store: LoopStore, prompt: LoopPrompt, decide: Decide): Promise<LoopResult> {
	const state = store.get(`${input.harness ?? ""}:${input.sessionId}:${input.agentId ?? ""}`);
	const detections: LoopDetection[] = [];
	const asked: Asked = {};
	const maker = new Set(prompt.makerTools);

	for (const event of input.events) {
		if (event.kind === "prompt") {
			state.runawayThisPrompt = 0;
			if (event.text) state.request = event.text;
			continue;
		}
		if (event.kind === "call") {
			const fp = fingerprint(event.tool, event.args);
			const hit = observeCall(state, fp, prompt);
			if (hit) detections.push(hit);
			if (maker.has(event.tool)) {
				const task = makerTask(event.args);
				if (task !== undefined) {
					if (state.makerFailure && state.makerFailure.task === task) {
						const judged = await askFailure(state.makerFailure, input, prompt, decide, asked);
						detections.push({
							tier: "maker_retry",
							action: "shadow",
							tool: event.tool,
							count: 1,
							failureClass: judged.failureClass,
							message: `${event.tool} redispatched after a failure${judged.failureClass ? ` (${judged.failureClass}: ${judged.advice})` : ""}`,
						});
					} else if (state.makerTasks.has(task)) {
						detections.push({
							tier: "maker_duplicate",
							action: "shadow",
							tool: event.tool,
							count: 2,
							message: `${event.tool} dispatched the same task again this session`,
						});
					}
					state.makerTasks.add(task);
					state.makerFailure = undefined;
				}
			}
			continue;
		}
		if (event.kind === "result") {
			const fp = fingerprint(event.tool, event.args);
			const output = event.output ?? "";
			const hit = observeResult(state, fp, output, prompt);
			if (hit) detections.push(hit);
			if (maker.has(event.tool) && event.isError) {
				const task = makerTask(event.args);
				if (task !== undefined) state.makerFailure = { task, output };
			}
			continue;
		}
		// answer: the run ended on text alone.
		const mono = observeMonologue(state, event.text, prompt);
		if (mono) {
			detections.push(mono);
			continue;
		}
		if (state.runawayThisPrompt < prompt.limits.runawayPerPrompt && promiseShaped(event.text, prompt)) {
			const hit = await askRunaway(event.text, state, input, prompt, decide, asked);
			if (hit) detections.push(hit);
		}
	}

	return {
		decisionId: asked.decisionId,
		status: asked.unavailable && detections.length === 0 ? "unavailable" : "routed",
		reason: detections.length > 0 ? detections.map((d) => d.tier).join(", ") : "clear",
		notes: [],
		backend: asked.backend,
		detections,
	};
}

function parseEvent(raw: unknown): LoopEvent | undefined {
	if (!isRecord(raw)) return undefined;
	switch (raw.kind) {
		case "prompt":
			return { kind: "prompt", text: str(raw.text) };
		case "call":
			return typeof raw.tool === "string" ? { kind: "call", tool: raw.tool, args: raw.args } : undefined;
		case "result":
			return typeof raw.tool === "string"
				? { kind: "result", tool: raw.tool, args: raw.args, output: str(raw.output), isError: raw.isError === true }
				: undefined;
		case "answer":
			return typeof raw.text === "string" ? { kind: "answer", text: raw.text } : undefined;
		default:
			return undefined;
	}
}

function parseLoopInput(b: Record<string, unknown>): LoopInput | string {
	const sessionId = str(b.sessionId);
	if (!sessionId) return "sessionId is required";
	if (!Array.isArray(b.events)) return "events must be an array";
	const events = b.events.map(parseEvent);
	if (events.some((e) => e === undefined)) return "each event needs a known kind";
	return { sessionId, harness: str(b.harness), agentId: str(b.agentId), events: events as LoopEvent[] };
}

export function loopFeature(store = new LoopStore()): FeatureDef {
	return {
		name: "loop",
		path: "/v1/loop",
		load(version) {
			const prompt = loadLoopPrompt(version);
			return {
				version: prompt.version,
				parse: parseLoopInput,
				run: (input, decide) => observe(input as LoopInput, store, prompt, decide),
			};
		},
		/** `expected` is the tiers that should fire for the case's events, in order. */
		score(expected, result) {
			const want = Array.isArray(expected) ? (expected as string[]) : [];
			const got = ((result.detections as LoopDetection[] | undefined) ?? []).map((d) => d.tier);
			return { exact: Number(JSON.stringify(want) === JSON.stringify(got)) };
		},
		logs: (result) => result.reason !== "clear" || result.decisionId !== undefined,
	};
}

export const loop = loopFeature();
