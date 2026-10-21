/**
 * `decision audit`: did the daemon's decisions turn out right, and what did they cost?
 *
 * The decision log says what was decided and (via `outcome` lines) what the harness applied; the
 * session transcript says what happened next. They join on `sessionId`, then a decision joins
 * its turn by time (pi also records the `decisionId` in a `decision-route` entry). Signals follow
 * plan §9-2: manual model change, a repeated request, or premium spent on a short answer for
 * model_route; recommended-and-used vs missed vs noise for find_skill; activated-and-called for
 * find_tool.
 *
 * Wrong-looking cases go to `candidates/<feature>.jsonl` in eval-case format. They are
 * suggestions: only a person moves a line into `evals/`. Everything written is secret-masked and
 * each prompt is clipped to 300 characters (`mask.ts`).
 *
 * Transcript parsing is written here in TypeScript rather than reusing
 * `analyze-pi-sessions/scripts/collect-session-evidence.py`: that collector is a Python tool that
 * emits bounded JSON signals for whole sessions and has no per-turn tool-call or model-change
 * timeline, which is what the join needs.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PACKAGE_DIR, percentile } from "./eval.ts";
import { feature as findFeature, FEATURES } from "./features/index.ts";
import { isRecord } from "./features/types.ts";
import { parseFlags } from "./flags.ts";
import { clip } from "./mask.ts";
import { dayStamp, STATE_DIR } from "./state.ts";

export const AUDIT_DOCS_DIR = join(PACKAGE_DIR, "docs", "audit");
export const CANDIDATES_DIR = join(PACKAGE_DIR, "candidates");
export const PI_SESSIONS_DIR = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "sessions");
export const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

/** Premium spent on an answer this short, with no tool use, looks like overspend. */
export const SHORT_ANSWER_CHARS = 400;
/** A re-asked prompt this soon after the last one looks like a retry. */
export const REPEAT_WINDOW_MS = 15 * 60_000;
/** How far apart a log decision and a prompt may be and still be the same moment. */
const JOIN_BEFORE_MS = 15_000;
const JOIN_AFTER_MS = 120_000;
/** A model change this close before a route record is the route's own doing. */
const ROUTE_CAUSE_MS = 15_000;

// --- log -----------------------------------------------------------------------------------

export interface ResultLine {
	ts: number;
	decisionId?: string;
	feature: string;
	version?: string;
	harness?: string;
	sessionId?: string;
	status: string;
	currentModel?: string;
	raw: Record<string, unknown>;
}

export interface DecideLine {
	ts: number;
	decisionId?: string;
	feature: string;
	harness?: string;
	sessionId?: string;
	status: string;
	backend?: string;
	cached: boolean;
	costUsd: number;
	latencyMs: number;
}

export interface OutcomeLine {
	ts: number;
	decisionId?: string;
	feature?: string;
	harness?: string;
	sessionId?: string;
	signal: string;
	detail: unknown;
}

export interface LogData {
	results: ResultLine[];
	decides: DecideLine[];
	outcomes: OutcomeLine[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const numOr = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Which feature an outcome signal belongs to when the line carries no `feature`. */
const SIGNAL_FEATURE: Record<string, string> = {
	applied: "model_route",
	injected: "find_skill",
	used: "find_skill",
	activated: "find_tool",
	called: "find_tool",
};

export function parseLogLines(
	lines: Iterable<string>,
	sinceMs: number,
	into: LogData = { results: [], decides: [], outcomes: [] },
): LogData {
	for (const line of lines) {
		if (!line.trim()) continue;
		let o: unknown;
		try {
			o = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(o)) continue;
		const ts = Date.parse(String(o.ts));
		if (!Number.isFinite(ts) || ts < sinceMs) continue;
		const common = { ts, decisionId: str(o.decisionId), harness: str(o.harness), sessionId: str(o.sessionId) };
		if (o.type === "result" && str(o.feature)) {
			into.results.push({
				...common,
				feature: String(o.feature),
				version: str(o.version),
				status: str(o.status) ?? "unknown",
				currentModel: str(o.currentModel),
				raw: o,
			});
		} else if (o.type === "decide") {
			into.decides.push({
				...common,
				feature: str(o.feature) ?? "adhoc",
				status: str(o.status) ?? "unknown",
				backend: str(o.backend),
				cached: o.cached === true,
				costUsd: numOr(o.costUsd, 0),
				latencyMs: numOr(o.latencyMs, 0),
			});
		} else if (o.type === "outcome" && str(o.signal)) {
			const signal = String(o.signal);
			into.outcomes.push({ ...common, feature: str(o.feature) ?? SIGNAL_FEATURE[signal], signal, detail: o.detail });
		}
	}
	return into;
}

/** `log-YYMMDD.jsonl` files from `sinceMs`'s local day onward, read in order. */
export function loadLog(sinceMs: number, dir = STATE_DIR): LogData {
	const data: LogData = { results: [], decides: [], outcomes: [] };
	if (!existsSync(dir)) return data;
	const first = dayStamp(new Date(sinceMs));
	const files = readdirSync(dir)
		.filter((n) => /^log-\d{6}\.jsonl$/.test(n) && n.slice(4, 10) >= first)
		.sort();
	for (const name of files) parseLogLines(readFileSync(join(dir, name), "utf8").split("\n"), sinceMs, data);
	return data;
}

/** `7d`, `12h`, `4w`, or an ISO date. */
export function parseSince(value: string, now = Date.now()): number {
	const rel = /^(\d+)([hdw])$/.exec(value);
	if (rel) return now - Number(rel[1]) * { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[rel[2] as "h" | "d" | "w"];
	const at = Date.parse(value);
	if (!Number.isFinite(at)) throw new Error(`--since must look like 12h, 7d, 4w, or an ISO date; got ${value}`);
	return at;
}

// --- transcripts ---------------------------------------------------------------------------

export type TEvent =
	| { kind: "user"; ts: number; text: string }
	| { kind: "assistant"; ts: number; model?: string; text: string }
	| { kind: "tool"; ts: number; name: string; input: unknown }
	| { kind: "model_change"; ts: number; model: string }
	| { kind: "route"; ts: number; decisionId?: string; model?: string; tier?: string };

export interface Transcript {
	harness: "pi" | "claude";
	sessionId: string;
	cwd?: string;
	events: TEvent[];
}

const time = (v: unknown): number => {
	const t = typeof v === "string" ? Date.parse(v) : typeof v === "number" ? v : Number.NaN;
	return Number.isFinite(t) ? t : 0;
};

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((p) => (isRecord(p) && p.type === "text" && typeof p.text === "string" ? p.text : "")).join("\n");
}

/** pi session JSONL entries → events. */
export function parsePiTranscript(sessionId: string, entries: readonly unknown[]): Transcript {
	const t: Transcript = { harness: "pi", sessionId, events: [] };
	for (const e of entries) {
		if (!isRecord(e)) continue;
		const ts = time(e.timestamp);
		if (e.type === "session") {
			t.cwd = str(e.cwd);
		} else if (e.type === "model_change" && str(e.modelId)) {
			t.events.push({ kind: "model_change", ts, model: `${str(e.provider) ?? ""}/${e.modelId}` });
		} else if (e.type === "custom" && e.customType === "decision-route" && isRecord(e.data)) {
			t.events.push({
				kind: "route",
				ts,
				decisionId: str(e.data.decisionId),
				model: str(e.data.model),
				tier: str(e.data.tier),
			});
		} else if (e.type === "message" && isRecord(e.message)) {
			const m = e.message;
			if (m.role === "user") {
				t.events.push({ kind: "user", ts, text: textOf(m.content) });
			} else if (m.role === "assistant") {
				t.events.push({
					kind: "assistant",
					ts,
					model: m.model ? `${str(m.provider) ?? ""}/${m.model}` : undefined,
					text: textOf(m.content),
				});
				if (Array.isArray(m.content)) {
					for (const p of m.content) {
						if (isRecord(p) && p.type === "toolCall" && str(p.name))
							t.events.push({ kind: "tool", ts, name: String(p.name), input: p.arguments });
					}
				}
			}
		}
	}
	return t;
}

const CLAUDE_SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/** Claude Code project JSONL entries → events. Model switches are synthesized from the assistant model sequence. */
export function parseClaudeTranscript(sessionId: string, entries: readonly unknown[]): Transcript {
	const t: Transcript = { harness: "claude", sessionId, events: [] };
	let model: string | undefined;
	for (const e of entries) {
		if (!isRecord(e) || e.isSidechain === true || !isRecord(e.message)) continue;
		if (!t.cwd && str(e.cwd)) t.cwd = str(e.cwd);
		const ts = time(e.timestamp);
		const m = e.message;
		if (e.type === "user") {
			if (e.isMeta === true) continue;
			const text = textOf(m.content).replace(CLAUDE_SYSTEM_REMINDER, "").trim();
			if (
				!text ||
				/^<(local-command|command-|task-notification)/.test(text) ||
				text.startsWith("Base directory for this skill")
			)
				continue;
			t.events.push({ kind: "user", ts, text });
		} else if (e.type === "assistant") {
			const used = str(m.model);
			if (used && used !== "<synthetic>") {
				if (model && model !== used) t.events.push({ kind: "model_change", ts, model: used });
				model = used;
			}
			t.events.push({ kind: "assistant", ts, model: used, text: textOf(m.content) });
			if (Array.isArray(m.content)) {
				for (const p of m.content) {
					if (isRecord(p) && p.type === "tool_use" && str(p.name))
						t.events.push({ kind: "tool", ts, name: String(p.name), input: p.input });
				}
			}
		}
	}
	return t;
}

function readJsonl(path: string, skip: (line: string) => boolean): unknown[] {
	const out: unknown[] = [];
	for (const line of readFileSync(path, "utf8").split("\n")) {
		if (!line || skip(line)) continue;
		try {
			out.push(JSON.parse(line));
		} catch {
			// A torn last line from a live session.
		}
	}
	return out;
}

const skipPiLine = (line: string) => line.includes('"role":"system"') && line.startsWith('{"type":"message"');
const skipClaudeLine = (line: string) =>
	/"type":"(api-request|attachment|file-history|ai-title|last-prompt)/.test(line.slice(0, 400));

export type TranscriptLocator = (harness: string | undefined, sessionId: string) => Transcript | undefined;

/** pi `sessions/<cwd-slug>/<ts>_<id>.jsonl` and Claude `projects/<slug>/<id>.jsonl`, indexed by id once. */
export function fileLocator(
	wanted: ReadonlySet<string>,
	piDir = PI_SESSIONS_DIR,
	claudeDir = CLAUDE_PROJECTS_DIR,
): TranscriptLocator {
	const pi = new Map<string, string>();
	const claude = new Map<string, string>();
	const dirs = (root: string) => (existsSync(root) ? readdirSync(root) : []);
	for (const d of dirs(piDir)) {
		let names: string[];
		try {
			names = readdirSync(join(piDir, d));
		} catch {
			continue;
		}
		for (const n of names) {
			const id = /_([0-9a-f-]{36})\.jsonl$/.exec(n)?.[1];
			if (id && wanted.has(id)) pi.set(id, join(piDir, d, n));
		}
	}
	for (const d of dirs(claudeDir)) {
		for (const id of wanted) {
			const path = join(claudeDir, d, `${id}.jsonl`);
			if (existsSync(path)) claude.set(id, path);
		}
	}
	const cache = new Map<string, Transcript | undefined>();
	return (harness, sessionId) => {
		const key = `${harness ?? "?"}:${sessionId}`;
		if (cache.has(key)) return cache.get(key);
		let t: Transcript | undefined;
		try {
			const piPath = harness !== "claude" ? pi.get(sessionId) : undefined;
			const claudePath = harness !== "pi" ? claude.get(sessionId) : undefined;
			if (piPath) t = parsePiTranscript(sessionId, readJsonl(piPath, skipPiLine));
			else if (claudePath) t = parseClaudeTranscript(sessionId, readJsonl(claudePath, skipClaudeLine));
		} catch {
			t = undefined;
		}
		cache.set(key, t);
		return t;
	};
}

// --- turns and joins -----------------------------------------------------------------------

export interface Turn {
	/** Index of the user event in `events`. */
	start: number;
	/** Index one past the turn's last event. */
	end: number;
	ts: number;
	text: string;
}

export function turnsOf(events: readonly TEvent[]): Turn[] {
	const turns: Turn[] = [];
	events.forEach((e, i) => {
		if (e.kind !== "user") return;
		const last = turns[turns.length - 1];
		if (last) last.end = i;
		turns.push({ start: i, end: events.length, ts: e.ts, text: e.text });
	});
	return turns;
}

/** Turn of a decision made when the prompt arrived: pi's recorded `decisionId` first, else the nearest prompt in time. */
export function turnAtPrompt(
	t: Transcript,
	turns: readonly Turn[],
	decisionId: string | undefined,
	ts: number,
): Turn | undefined {
	if (decisionId) {
		const at = t.events.findIndex((e) => e.kind === "route" && e.decisionId === decisionId);
		if (at >= 0) return turns.find((turn) => turn.start > at);
	}
	let best: Turn | undefined;
	for (const turn of turns) {
		const d = turn.ts - ts;
		if (d < -JOIN_BEFORE_MS || d > JOIN_AFTER_MS) continue;
		if (!best || Math.abs(d) < Math.abs(best.ts - ts)) best = turn;
	}
	return best;
}

/** Turn a mid-turn decision (find_tool) happened inside. */
export function turnContaining(turns: readonly Turn[], ts: number): Turn | undefined {
	let hit: Turn | undefined;
	for (const turn of turns) if (turn.ts <= ts + 1000) hit = turn;
	return hit;
}

const tokens = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Same request again: identical after normalization, or a high word overlap on a non-trivial prompt. */
export function similarPrompts(a: string, b: string): boolean {
	const ta = tokens(a);
	const tb = tokens(b);
	if (ta.length === 0 || tb.length === 0) return false;
	if (ta.join(" ") === tb.join(" ")) return true;
	if (ta.length < 3 || tb.length < 3) return false;
	const sa = new Set(ta);
	const sb = new Set(tb);
	let shared = 0;
	for (const w of sa) if (sb.has(w)) shared++;
	return shared / (sa.size + sb.size - shared) >= 0.7;
}

/** Manual model changes inside a span: a change to a different model that no route record explains. */
export function manualModelChanges(
	events: readonly TEvent[],
	from: number,
	to: number,
): { ts: number; from?: string; to: string }[] {
	let current: string | undefined;
	for (let i = 0; i < from; i++) {
		const e = events[i];
		if (e.kind === "model_change") current = e.model;
		else if (e.kind === "assistant" && e.model) current = e.model;
	}
	const out: { ts: number; from?: string; to: string }[] = [];
	for (let i = from; i < to; i++) {
		const e = events[i];
		if (e.kind === "assistant" && e.model) current = e.model;
		if (e.kind !== "model_change") continue;
		if (current !== undefined && e.model !== current) {
			const caused = events.some(
				(r) =>
					r.kind === "route" &&
					r.ts - e.ts >= -1000 &&
					r.ts - e.ts <= ROUTE_CAUSE_MS &&
					(r.model === undefined || r.model === e.model),
			);
			if (!caused) out.push({ ts: e.ts, from: current, to: e.model });
		}
		current = e.model;
	}
	return out;
}

const SKILL_PATH = /skills(?:-routed)?\/([\w.-]+)\/SKILL\.md/g;
const READ_TOOLS = /^(read|bulk_read)$/i;
const SHELL_READ = /\b(cat|head|tail|sed|bat|less|nl)\b[^|;&\n]*skills(?:-routed)?\/[\w.-]+\/SKILL\.md/;

/** Skills a turn opened: a read of `<name>/SKILL.md` or a `Skill` tool call. */
export function skillsUsed(events: readonly TEvent[]): Set<string> {
	const used = new Set<string>();
	for (const e of events) {
		if (e.kind !== "tool") continue;
		if (e.name === "Skill" && isRecord(e.input) && typeof e.input.skill === "string") {
			used.add(e.input.skill.split(":").pop() ?? e.input.skill);
			continue;
		}
		const input = isRecord(e.input) ? e.input : {};
		let scan: string | undefined;
		if (READ_TOOLS.test(e.name)) scan = JSON.stringify(input);
		else if (/^bash$/i.test(e.name) && typeof input.command === "string" && SHELL_READ.test(input.command))
			scan = input.command;
		if (scan) for (const m of scan.matchAll(SKILL_PATH)) used.add(m[1]);
	}
	return used;
}

/** Whether a tool call is `name`, including an MCP-prefixed `mcp__server__name`. */
export function toolMatches(called: string, name: string): boolean {
	const a = called.toLowerCase();
	const b = name.toLowerCase();
	return a === b || a.endsWith(`__${b}`);
}

// --- signals -------------------------------------------------------------------------------

export interface Finding {
	feature: string;
	harness: string;
	decisionId?: string;
	sessionId: string;
	signal: string;
	verdict: "ok" | "wrong";
	detail: string;
}

export interface Judged {
	feature: string;
	harness: string;
	decisionId?: string;
	sessionId?: string;
	/** False when no transcript turn could be matched, so no verdict was possible. */
	joined: boolean;
	wrong: boolean;
}

export interface EvalCaseOut {
	input: Record<string, unknown>;
	expected: unknown;
	source: string;
	note?: string;
}

export interface Candidate {
	feature: string;
	case: EvalCaseOut;
}

export interface Derived {
	findings: Finding[];
	judged: Judged[];
	candidates: Candidate[];
}

const namesOf = (value: unknown): string[] =>
	Array.isArray(value)
		? value.flatMap((v) => (typeof v === "string" ? [v] : isRecord(v) && typeof v.name === "string" ? [v.name] : []))
		: [];

function turnStats(events: readonly TEvent[], turn: Turn) {
	const slice = events.slice(turn.start, turn.end);
	const answer = slice.reduce((n, e) => n + (e.kind === "assistant" ? e.text.length : 0), 0);
	return {
		slice,
		answer,
		assistantTurns: slice.filter((e) => e.kind === "assistant").length,
		tools: slice.filter((e) => e.kind === "tool"),
	};
}

const TIER_DOWN: Record<string, string> = { premium: "high", high: "standard", standard: "quick" };

export function deriveSignals(log: LogData, locate: TranscriptLocator, features: readonly string[]): Derived {
	const findings: Finding[] = [];
	const judged: Judged[] = [];
	const candidates: Candidate[] = [];
	const outcomesBy = new Map<string, OutcomeLine[]>();
	for (const o of log.outcomes) {
		if (!o.decisionId) continue;
		outcomesBy.set(o.decisionId, [...(outcomesBy.get(o.decisionId) ?? []), o]);
	}

	for (const r of log.results) {
		if (!features.includes(r.feature) || r.status !== "routed" || !r.sessionId) continue;
		const harness = r.harness ?? "unknown";
		if (harness !== "pi" && harness !== "claude") continue;
		const t = locate(harness, r.sessionId);
		const mid = r.feature === "find_tool";
		const turns = t ? turnsOf(t.events) : [];
		const turn = t ? (mid ? turnContaining(turns, r.ts) : turnAtPrompt(t, turns, r.decisionId, r.ts)) : undefined;
		if (!t || !turn) {
			judged.push({
				feature: r.feature,
				harness,
				decisionId: r.decisionId,
				sessionId: r.sessionId,
				joined: false,
				wrong: false,
			});
			continue;
		}
		const outcomes = (r.decisionId ? outcomesBy.get(r.decisionId) : undefined) ?? [];
		const { slice, answer, assistantTurns, tools } = turnStats(t.events, turn);
		const found: Finding[] = [];
		const add = (signal: string, verdict: "ok" | "wrong", detail: string) =>
			found.push({
				feature: r.feature,
				harness,
				decisionId: r.decisionId,
				sessionId: r.sessionId as string,
				signal,
				verdict,
				detail: clip(detail, 200),
			});
		let expected: unknown = null;
		let input: Record<string, unknown> = { prompt: clip(turn.text), ...(t.cwd ? { cwd: t.cwd } : {}) };

		if (r.feature === "model_route") {
			const tier = str(r.raw.tier);
			const manual = manualModelChanges(t.events, turn.start, turn.end);
			if (r.currentModel) input = { ...input, currentModel: r.currentModel };
			for (const m of manual)
				add("manual_model_change", "wrong", `${m.from ?? "?"} → ${m.to} after route ${tier ?? "?"}`);
			const next = turns.find((x) => x.start >= turn.end);
			if (next && next.ts - turn.ts <= REPEAT_WINDOW_MS && similarPrompts(turn.text, next.text))
				add("repeat_request", "wrong", "next prompt repeats this one");
			if (tier === "premium" && answer <= SHORT_ANSWER_CHARS && tools.length === 0 && assistantTurns > 0) {
				add("premium_short", "wrong", `premium for a ${answer}-char answer, no tools`);
				expected = TIER_DOWN[tier];
			}
		} else if (r.feature === "find_skill") {
			const recommended = new Set([
				...namesOf(r.raw.skills),
				...outcomes
					.filter((o) => o.signal === "injected")
					.flatMap((o) => (isRecord(o.detail) ? namesOf(o.detail.skills) : [])),
			]);
			const used = skillsUsed(slice);
			for (const o of outcomes)
				if (o.signal === "used" && isRecord(o.detail) && str(o.detail.name)) used.add(String(o.detail.name));
			// A body the harness loaded was delivered, not merely recommended: reading the file is moot.
			const loaded = new Set(
				outcomes
					.filter((o) => o.signal === "injected")
					.flatMap((o) => (isRecord(o.detail) ? namesOf(o.detail.bodies) : [])),
			);
			for (const n of loaded) add("body_loaded", "ok", n);
			const hits = [...recommended].filter((n) => used.has(n));
			const noise = [...recommended].filter((n) => !used.has(n) && !loaded.has(n));
			const missed = [...used].filter((n) => !recommended.has(n));
			for (const n of hits) add("used", "ok", n);
			for (const n of noise) add("noise", "wrong", `${n} recommended, never used`);
			for (const n of missed) add("missed", "wrong", `${n} read without a recommendation`);
			expected = { skills: [...hits, ...missed], rules: [] };
		} else if (r.feature === "find_tool") {
			const activated = namesOf(r.raw.activate);
			const after = slice.filter((e) => e.kind === "tool" && e.ts >= r.ts - 1000);
			const calledOutcome = outcomes
				.filter((o) => o.signal === "called")
				.flatMap((o) => (isRecord(o.detail) && str(o.detail.name) ? [String(o.detail.name)] : []));
			const hits: string[] = [];
			for (const name of activated) {
				const called =
					after.some((e) => e.kind === "tool" && toolMatches(e.name, name)) ||
					calledOutcome.some((c) => toolMatches(c, name));
				add(called ? "called" : "unused", called ? "ok" : "wrong", called ? name : `${name} activated, never called`);
				if (called) hits.push(name);
			}
			input = { userRequest: input.prompt };
			expected = hits;
		}

		const wrong = found.filter((f) => f.verdict === "wrong");
		findings.push(...found);
		judged.push({
			feature: r.feature,
			harness,
			decisionId: r.decisionId,
			sessionId: r.sessionId,
			joined: true,
			wrong: wrong.length > 0,
		});
		if (wrong.length > 0) {
			candidates.push({
				feature: r.feature,
				case: {
					input,
					expected,
					source: r.sessionId,
					note: clip(
						`audit ${new Date(r.ts).toISOString().slice(0, 16)} ${r.feature}: ${wrong.map((w) => `${w.signal} (${w.detail})`).join("; ")}${expected === null ? "; label needed" : "; suggested label, confirm"}`,
						300,
					),
				},
			});
		}
	}
	return { findings, judged, candidates };
}

// --- efficiency ----------------------------------------------------------------------------

export interface EfficiencyRow {
	feature: string;
	harness: string;
	decisions: number;
	routed: number;
	skipped: number;
	unavailable: number;
	cached: number;
	costUsd: number;
	p50?: number;
	p95?: number;
	backends: Record<string, number>;
}

export function efficiency(log: LogData): EfficiencyRow[] {
	const rows = new Map<string, EfficiencyRow & { latencies: number[] }>();
	const row = (feature: string, harness: string | undefined) => {
		const h = harness ?? "unknown";
		const key = `${feature}|${h}`;
		let r = rows.get(key);
		if (!r) {
			r = {
				feature,
				harness: h,
				decisions: 0,
				routed: 0,
				skipped: 0,
				unavailable: 0,
				cached: 0,
				costUsd: 0,
				backends: {},
				latencies: [],
			};
			rows.set(key, r);
		}
		return r;
	};
	for (const res of log.results) {
		const r = row(res.feature, res.harness);
		r.decisions++;
		if (res.status === "routed") r.routed++;
		else if (res.status === "skipped") r.skipped++;
		else r.unavailable++;
	}
	for (const d of log.decides) {
		const r = row(d.feature, d.harness);
		r.costUsd += d.costUsd;
		if (d.cached) r.cached++;
		else if (d.status === "ok") {
			r.latencies.push(d.latencyMs);
			if (d.backend) r.backends[d.backend] = (r.backends[d.backend] ?? 0) + 1;
		}
	}
	return [...rows.values()]
		.map(({ latencies, ...r }) => ({ ...r, p50: percentile(latencies, 50), p95: percentile(latencies, 95) }))
		.sort((a, b) => a.feature.localeCompare(b.feature) || a.harness.localeCompare(b.harness));
}

// --- report --------------------------------------------------------------------------------

export interface SignalRow {
	feature: string;
	harness: string;
	decisions: number;
	joined: number;
	wrong: number;
	signals: Record<string, number>;
}

export function tally(derived: Derived): SignalRow[] {
	const rows = new Map<string, SignalRow>();
	const row = (feature: string, harness: string) => {
		const key = `${feature}|${harness}`;
		let r = rows.get(key);
		if (!r) rows.set(key, (r = { feature, harness, decisions: 0, joined: 0, wrong: 0, signals: {} }));
		return r;
	};
	for (const j of derived.judged) {
		const r = row(j.feature, j.harness);
		r.decisions++;
		if (j.joined) r.joined++;
		if (j.wrong) r.wrong++;
	}
	for (const f of derived.findings) {
		const r = row(f.feature, f.harness);
		r.signals[f.signal] = (r.signals[f.signal] ?? 0) + 1;
	}
	return [...rows.values()].sort((a, b) => a.feature.localeCompare(b.feature) || a.harness.localeCompare(b.harness));
}

export interface AuditReport {
	generatedAt: string;
	since: string;
	harness: string;
	feature?: string;
	logRecords: { results: number; decides: number; outcomes: number };
	efficiency: EfficiencyRow[];
	signals: SignalRow[];
	wrong: Finding[];
	candidates: { feature: string; count: number; path: string }[];
}

const ms = (n: number | undefined) => (n === undefined ? "–" : String(Math.round(n)));

function table(header: string[], rows: string[][]): string[] {
	return [
		`| ${header.join(" | ")} |`,
		`|${header.map(() => "---").join("|")}|`,
		...rows.map((r) => `| ${r.join(" | ")} |`),
	];
}

export function renderAudit(report: AuditReport): string {
	const out: string[] = [];
	out.push("# decision audit", "");
	out.push(
		`- generated ${report.generatedAt}, window since ${report.since}, harness ${report.harness}${report.feature ? `, feature ${report.feature}` : ""}`,
	);
	out.push(
		`- log records: ${report.logRecords.results} results, ${report.logRecords.decides} decides, ${report.logRecords.outcomes} outcomes`,
		"",
	);
	out.push("## Efficiency", "");
	if (report.efficiency.length === 0) out.push("No decisions in the window.");
	else {
		out.push(
			...table(
				[
					"feature",
					"harness",
					"decisions",
					"routed",
					"skipped",
					"unavail",
					"cached",
					"cost USD",
					"p50 ms",
					"p95 ms",
					"backends",
				],
				report.efficiency.map((e) => [
					e.feature,
					e.harness,
					String(e.decisions),
					String(e.routed),
					String(e.skipped),
					String(e.unavailable),
					String(e.cached),
					e.costUsd.toFixed(5),
					ms(e.p50),
					ms(e.p95),
					Object.entries(e.backends)
						.map(([k, n]) => `${k} ×${n}`)
						.join(", ") || "–",
				]),
			),
		);
	}
	out.push("", "## Outcome signals", "");
	if (report.signals.length === 0) out.push("No routed pi/claude decisions to judge in the window.");
	else {
		out.push(
			...table(
				["feature", "harness", "decisions", "joined", "wrong-looking", "signals"],
				report.signals.map((s) => [
					s.feature,
					s.harness,
					String(s.decisions),
					String(s.joined),
					String(s.wrong),
					Object.entries(s.signals)
						.map(([k, n]) => `${k} ×${n}`)
						.join(", ") || "–",
				]),
			),
		);
		out.push(
			"",
			"`joined` counts decisions matched to a transcript turn; the rest have no verdict. A skill read counts as use, so a harness that injects skill text directly shows as noise.",
		);
	}
	if (report.wrong.length > 0) {
		out.push("", "## Wrong-looking decisions", "");
		for (const f of report.wrong.slice(0, 40))
			out.push(`- ${f.feature}/${f.harness} ${f.signal}: ${f.detail} (session ${f.sessionId.slice(0, 8)})`);
		if (report.wrong.length > 40) out.push(`- … ${report.wrong.length - 40} more`);
	}
	out.push("", "## Candidates", "");
	if (report.candidates.length === 0) out.push("None written.");
	else {
		for (const c of report.candidates) out.push(`- ${c.feature}: ${c.count} case(s) in \`${c.path}\``);
		out.push(
			"",
			"Candidates are suggestions. Move a line into `evals/<feature>.jsonl` only after confirming its label.",
		);
	}
	out.push("");
	return out.join("\n");
}

/** Append candidates to `candidates/<feature>.jsonl`, skipping cases already present (same source and input). */
export function writeCandidates(
	candidates: readonly Candidate[],
	dir = CANDIDATES_DIR,
): { feature: string; count: number; path: string }[] {
	const byFeature = new Map<string, EvalCaseOut[]>();
	for (const c of candidates) byFeature.set(c.feature, [...(byFeature.get(c.feature) ?? []), c.case]);
	const written: { feature: string; count: number; path: string }[] = [];
	for (const [feature, cases] of byFeature) {
		mkdirSync(dir, { recursive: true });
		const path = join(dir, `${feature}.jsonl`);
		const existing = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
		const keyOf = (c: EvalCaseOut) => `${c.source}\u0000${JSON.stringify(c.input)}`;
		const seen = new Set(
			existing.flatMap((line) => {
				try {
					return [keyOf(JSON.parse(line) as EvalCaseOut)];
				} catch {
					return [];
				}
			}),
		);
		const fresh = cases.filter((c) => !seen.has(keyOf(c)) && seen.add(keyOf(c)));
		if (fresh.length > 0) writeFileSync(path, `${[...existing, ...fresh.map((c) => JSON.stringify(c))].join("\n")}\n`);
		written.push({ feature, count: fresh.length, path });
	}
	return written;
}

export interface AuditOptions {
	sinceMs: number;
	sinceLabel: string;
	harness: "pi" | "claude" | "all";
	feature?: string;
	logDir?: string;
	locate?: TranscriptLocator;
	docsDir?: string;
	candidatesDir?: string;
	write?: boolean;
}

export function runAudit(options: AuditOptions): { report: AuditReport; markdown: string; file?: string } {
	const raw = loadLog(options.sinceMs, options.logDir);
	const keep = (h: string | undefined) => options.harness === "all" || h === options.harness;
	const log: LogData = {
		results: raw.results.filter((r) => keep(r.harness) && (!options.feature || r.feature === options.feature)),
		decides: raw.decides.filter((d) => keep(d.harness) && (!options.feature || d.feature === options.feature)),
		outcomes: raw.outcomes.filter((o) => keep(o.harness) && (!options.feature || o.feature === options.feature)),
	};
	const features = (options.feature ? [options.feature] : FEATURES.map((f) => f.name)).filter((f) => findFeature(f));
	const wanted = new Set(
		log.results.flatMap((r) => (r.sessionId && (r.harness === "pi" || r.harness === "claude") ? [r.sessionId] : [])),
	);
	const locate = options.locate ?? fileLocator(wanted);
	const derived = deriveSignals(log, locate, features);
	const dedupedCandidates = options.write === false ? [] : writeCandidates(derived.candidates, options.candidatesDir);
	const report: AuditReport = {
		generatedAt: new Date().toISOString(),
		since: new Date(options.sinceMs).toISOString(),
		harness: options.harness,
		feature: options.feature,
		logRecords: { results: log.results.length, decides: log.decides.length, outcomes: log.outcomes.length },
		efficiency: efficiency(log),
		signals: tally(derived),
		wrong: derived.findings.filter((f) => f.verdict === "wrong"),
		candidates: dedupedCandidates,
	};
	const markdown = renderAudit(report);
	let file: string | undefined;
	if (options.write !== false) {
		const dir = options.docsDir ?? AUDIT_DOCS_DIR;
		mkdirSync(dir, { recursive: true });
		file = join(dir, `${dayStamp()}-audit.md`);
		writeFileSync(file, markdown);
	}
	return { report, markdown, file };
}

export const AUDIT_USAGE = "usage: decision audit [--since 7d] [--harness pi|claude|all] [--feature f]";

export function auditCommand(argv: string[]): number {
	try {
		const { values } = parseFlags(argv);
		const harness = values.harness ?? "all";
		if (harness !== "pi" && harness !== "claude" && harness !== "all")
			throw new Error("--harness must be pi, claude, or all");
		if (values.feature && !findFeature(values.feature))
			throw new Error(`unknown feature ${values.feature} (have ${FEATURES.map((f) => f.name).join(", ")})`);
		const sinceLabel = values.since ?? "7d";
		const { markdown, file } = runAudit({
			sinceMs: parseSince(sinceLabel),
			sinceLabel,
			harness,
			feature: values.feature,
		});
		console.log(markdown);
		if (file) console.log(`report ${file}`);
		return 0;
	} catch (error) {
		console.error(`${error instanceof Error ? error.message : String(error)}\n${AUDIT_USAGE}`);
		return 2;
	}
}
