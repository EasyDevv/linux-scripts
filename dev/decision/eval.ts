/**
 * `decision eval`: run a feature's labelled cases through one prompt version (or two) and
 * report the metrics `FeatureDef.score` defines, plus latency, cost, and how much of the answer
 * came from a calibrated backend.
 *
 * Cases run in-process through the same engine, backends, budget, and log as the live daemon,
 * tagged `harness: "eval"` so `decision audit` can tell them apart. This module never promotes:
 * it states whether the plan's promotion rule holds, and `decision promote` is a separate act.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BackendLadder } from "./backends.ts";
import type { Backend, DecideRequest, Decision } from "./engine.ts";
import { feature as findFeature, FEATURES } from "./features/index.ts";
import { type Decide, type FeatureDef, type FeatureResult, isRecord } from "./features/types.ts";
import { parseFlags, positiveInt } from "./flags.ts";
import { clip } from "./mask.ts";
import { createRuntime, type DaemonConfig, readConfig } from "./runtime.ts";
import { dayStamp, type DecisionLog } from "./state.ts";

export const PACKAGE_DIR = import.meta.dir;
export const EVAL_DOCS_DIR = join(PACKAGE_DIR, "docs", "eval");
export const EVALS_DIR = join(PACKAGE_DIR, "evals");

export interface EvalCase {
	input: Record<string, unknown>;
	expected: unknown;
	source: string;
	note?: string;
}

/** One case, run once. */
export interface CaseOutcome {
	index: number;
	prompt: string;
	expected: unknown;
	status: "routed" | "skipped" | "unavailable" | "invalid" | "error";
	metrics: Record<string, number>;
	/** Short summary of the feature result (masked, clipped). */
	got: string;
	latencyMs?: number;
	costUsd: number;
	backend?: string;
	calibrated?: boolean;
	error?: string;
}

export interface Percentiles {
	p50?: number;
	p95?: number;
	n: number;
}

export interface EvalSummary {
	version: string;
	cases: number;
	answered: number;
	unavailable: number;
	skipped: number;
	invalid: number;
	/** Mean of each `score` metric over answered cases, plus `coverage` (answered share). */
	metrics: Record<string, number>;
	latency: Percentiles;
	costUsd: number;
	/** Share of answered results that came from a calibrated (classifier) backend. */
	calibratedShare: number;
	backends: Record<string, number>;
}

// --- cases ---------------------------------------------------------------------------------

export function parseCases(text: string, origin = "cases"): EvalCase[] {
	const cases: EvalCase[] = [];
	text.split("\n").forEach((line, i) => {
		if (!line.trim()) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			throw new Error(`${origin}:${i + 1}: not JSON`);
		}
		if (!isRecord(parsed) || !isRecord(parsed.input) || parsed.expected === undefined) {
			throw new Error(`${origin}:${i + 1}: needs {input: object, expected}`);
		}
		cases.push({
			input: parsed.input,
			expected: parsed.expected,
			source: typeof parsed.source === "string" ? parsed.source : "seed",
			note: typeof parsed.note === "string" ? parsed.note : undefined,
		});
	});
	return cases;
}

export function loadCases(path: string): EvalCase[] {
	return parseCases(readFileSync(path, "utf8"), path);
}

/** The text a person would recognise a case by: the feature's main free-text field. */
export function casePrompt(input: Record<string, unknown>): string {
	for (const key of ["prompt", "userRequest", "task", "request"]) {
		if (typeof input[key] === "string") return clip(input[key]);
	}
	return clip(JSON.stringify(input));
}

// --- metric semantics ----------------------------------------------------------------------

/** Metrics where a smaller number is the better one (noise, extra tools); everything else is higher-is-better. */
const LOWER_IS_BETTER = /extra|noise|count|miss|false|error|wrong/i;

export function lowerIsBetter(metric: string): boolean {
	return LOWER_IS_BETTER.test(metric);
}

/** A case missed when any of its metrics is on the bad side of its ideal. */
export function isMiss(metrics: Record<string, number>): boolean {
	return Object.entries(metrics).some(([name, value]) => (lowerIsBetter(name) ? value > 0 : value < 1));
}

/** The plan's absolute promotion floors (§9-1), per feature and metric. A feature without an entry has none: ≥ baseline only. */
export const FLOORS: Record<string, Record<string, number>> = {
	model_route: { within1: 0.9 },
	find_skill: { recall: 0.9 },
	find_tool: { recall: 0.95 },
};

/** Guards for the "common" row of §9-1: p95 latency and cost must not get worse, within noise. */
export const LATENCY_TOLERANCE = 1.25;
export const COST_TOLERANCE = 1.1;
export const CALIBRATION_TOLERANCE = 0.05;
const EPS = 1e-9;

// --- aggregation ---------------------------------------------------------------------------

/** Nearest-rank percentile of an unsorted list. */
export function percentile(values: readonly number[], p: number): number | undefined {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.ceil((p / 100) * sorted.length);
	return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function summarize(version: string, outcomes: readonly CaseOutcome[]): EvalSummary {
	const valid = outcomes.filter((o) => o.status !== "invalid" && o.status !== "error");
	const answerable = valid.filter((o) => o.status !== "unavailable");
	const sums: Record<string, { total: number; n: number }> = {};
	for (const outcome of answerable) {
		for (const [name, value] of Object.entries(outcome.metrics)) {
			const slot = (sums[name] ??= { total: 0, n: 0 });
			slot.total += value;
			slot.n++;
		}
	}
	const metrics: Record<string, number> = {};
	for (const [name, { total, n }] of Object.entries(sums)) metrics[name] = total / n;
	metrics.coverage = valid.length === 0 ? 0 : answerable.length / valid.length;

	const routed = answerable.filter((o) => o.status === "routed");
	const backends: Record<string, number> = {};
	for (const o of routed) if (o.backend) backends[o.backend] = (backends[o.backend] ?? 0) + 1;
	const latencies = outcomes.flatMap((o) => (o.latencyMs === undefined ? [] : [o.latencyMs]));
	return {
		version,
		cases: outcomes.length,
		answered: answerable.length,
		unavailable: valid.length - answerable.length,
		skipped: answerable.filter((o) => o.status === "skipped").length,
		invalid: outcomes.length - valid.length,
		metrics,
		latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), n: latencies.length },
		costUsd: outcomes.reduce((sum, o) => sum + o.costUsd, 0),
		calibratedShare: routed.length === 0 ? 0 : routed.filter((o) => o.calibrated === true).length / routed.length,
		backends,
	};
}

// --- promotion rule ------------------------------------------------------------------------

export interface FloorCheck {
	metric: string;
	floor: number;
	value?: number;
	ok: boolean;
}

export interface GuardCheck {
	name: string;
	base: number;
	value: number;
	ok: boolean;
}

export interface Verdict {
	/** `floor`: no baseline given, only the absolute floors were checked. */
	mode: "floor" | "against";
	holds: boolean;
	floors: FloorCheck[];
	better: string[];
	worse: string[];
	guards: GuardCheck[];
	reasons: string[];
}

/**
 * Plan §9-1: the candidate is promotable when it clears the feature's absolute floor and, against
 * a baseline, is better on at least one metric and worse on none (latency and cost within
 * tolerance). Without a baseline only the floor can be judged.
 */
export function judgePromotion(featureName: string, candidate: EvalSummary, base?: EvalSummary): Verdict {
	const reasons: string[] = [];
	const floors = Object.entries(FLOORS[featureName] ?? {}).map(([metric, floor]): FloorCheck => {
		const value = candidate.metrics[metric];
		const ok = value !== undefined && value >= floor - EPS;
		if (!ok) reasons.push(`${metric} ${value === undefined ? "missing" : value.toFixed(3)} < floor ${floor}`);
		return { metric, floor, value, ok };
	});
	const better: string[] = [];
	const worse: string[] = [];
	const guards: GuardCheck[] = [];
	if (base) {
		for (const [metric, value] of Object.entries(candidate.metrics)) {
			const before = base.metrics[metric];
			if (before === undefined) continue;
			const delta = lowerIsBetter(metric) ? before - value : value - before;
			if (delta > EPS) better.push(metric);
			else if (delta < -EPS) worse.push(metric);
		}
		if (worse.length > 0) reasons.push(`worse on ${worse.join(", ")}`);
		if (better.length === 0) reasons.push("not better on any metric");
		const p95 = { base: base.latency.p95, value: candidate.latency.p95 };
		if (p95.base !== undefined && p95.value !== undefined) {
			const ok = p95.value <= p95.base * LATENCY_TOLERANCE;
			guards.push({ name: "p95 latency ms", base: p95.base, value: p95.value, ok });
			if (!ok) reasons.push(`p95 ${p95.value}ms > ${LATENCY_TOLERANCE}× baseline ${p95.base}ms`);
		}
		const costOk = candidate.costUsd <= base.costUsd * COST_TOLERANCE + EPS;
		guards.push({ name: "cost USD", base: base.costUsd, value: candidate.costUsd, ok: costOk });
		if (!costOk) reasons.push(`cost $${candidate.costUsd.toFixed(5)} > baseline $${base.costUsd.toFixed(5)}`);
		const calOk = candidate.calibratedShare >= base.calibratedShare - CALIBRATION_TOLERANCE;
		guards.push({ name: "calibrated share", base: base.calibratedShare, value: candidate.calibratedShare, ok: calOk });
		if (!calOk) reasons.push("calibrated share dropped");
	}
	// Unavailable cases are left out of the averages, so a partial run proves nothing either way.
	for (const [label, side] of [
		["candidate", candidate],
		["baseline", base],
	] as const) {
		if (side && side.unavailable > 0)
			reasons.push(`${label} had ${side.unavailable} unavailable case(s); rerun when the backend answers`);
	}
	const complete = candidate.unavailable === 0 && (base?.unavailable ?? 0) === 0;
	const holds =
		complete &&
		floors.every((f) => f.ok) &&
		(!base || (better.length > 0 && worse.length === 0 && guards.every((g) => g.ok)));
	return { mode: base ? "against" : "floor", holds, floors, better, worse, guards, reasons };
}

// --- running -------------------------------------------------------------------------------

export interface RunOptions {
	def: FeatureDef;
	version: string;
	cases: readonly EvalCase[];
	decide: (request: DecideRequest) => Promise<Decision>;
	log?: DecisionLog;
	runId: string;
	concurrency?: number;
}

function brief(result: FeatureResult): string {
	const rest: Record<string, unknown> = { ...result };
	for (const key of ["decisionId", "notes", "backend", "calibrated", "latencyMs"]) delete rest[key];
	return clip(JSON.stringify(rest), 240);
}

export async function runCases(options: RunOptions): Promise<CaseOutcome[]> {
	const { def, version, cases, log, runId } = options;
	const runtime = def.load(version);
	const sessionId = `eval-${runId}`;
	const outcomes: CaseOutcome[] = new Array(cases.length);
	let next = 0;

	async function runOne(index: number): Promise<CaseOutcome> {
		const c = cases[index];
		const base = { index, prompt: casePrompt(c.input), expected: c.expected, metrics: {}, got: "", costUsd: 0 };
		let parsed: unknown;
		try {
			parsed = runtime.parse({ ...c.input, harness: "eval", sessionId });
		} catch (error) {
			return { ...base, status: "error", error: clip(String(error)) };
		}
		if (typeof parsed === "string") return { ...base, status: "invalid", error: clip(parsed) };
		let cost = 0;
		let latency = 0;
		let calls = 0;
		const decide: Decide = async (request) => {
			const decision = await options.decide({ ...request, harness: "eval", sessionId: request.sessionId ?? sessionId });
			cost += decision.costUsd;
			latency += decision.latencyMs;
			calls++;
			return decision;
		};
		let result: FeatureResult;
		try {
			result = await runtime.run(parsed, decide);
		} catch (error) {
			return { ...base, status: "error", costUsd: cost, error: clip(String(error)) };
		}
		log?.write({ type: "result", feature: def.name, version, harness: "eval", sessionId, evalRun: runId, ...result });
		let metrics: Record<string, number> = {};
		try {
			metrics = def.score(c.expected, result);
		} catch {
			// A feature that cannot score this label leaves the case unscored.
		}
		return {
			...base,
			status: result.status,
			metrics: result.status === "unavailable" ? {} : metrics,
			got: brief(result),
			latencyMs: calls > 0 ? latency : result.latencyMs,
			costUsd: cost,
			backend: result.backend,
			calibrated: result.calibrated,
		};
	}

	async function worker(): Promise<void> {
		while (next < cases.length) {
			const index = next++;
			outcomes[index] = await runOne(index);
		}
	}
	await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 2, cases.length)) }, worker));
	return outcomes;
}

// --- report --------------------------------------------------------------------------------

export interface EvalReport {
	schema: 1;
	feature: string;
	version: string;
	against?: string;
	backend: string;
	ladder: string[];
	casesPath: string;
	generatedAt: string;
	candidate: { summary: EvalSummary; outcomes: CaseOutcome[] };
	baseline?: { summary: EvalSummary; outcomes: CaseOutcome[] };
	verdict: Verdict;
}

const fmt = (n: number | undefined, digits = 3): string => (n === undefined ? "–" : n.toFixed(digits));

function metricNames(...summaries: (EvalSummary | undefined)[]): string[] {
	const names = new Set<string>();
	for (const s of summaries) for (const name of Object.keys(s?.metrics ?? {})) names.add(name);
	return [...names];
}

/** Plain-text table for stdout (and the Markdown code block). */
export function renderTable(report: EvalReport): string {
	const cand = report.candidate.summary;
	const base = report.baseline?.summary;
	const rows: string[][] = [["metric", cand.version, ...(base ? [base.version, "Δ"] : [])]];
	for (const name of metricNames(cand, base)) {
		const row = [name, fmt(cand.metrics[name])];
		if (base) {
			const before = base.metrics[name];
			const delta = before === undefined || cand.metrics[name] === undefined ? undefined : cand.metrics[name] - before;
			row.push(fmt(before), delta === undefined ? "–" : `${delta >= 0 ? "+" : ""}${delta.toFixed(3)}`);
		}
		rows.push(row);
	}
	const extra = (label: string, pick: (s: EvalSummary) => string): void => {
		rows.push([label, pick(cand), ...(base ? [pick(base), ""] : [])]);
	};
	extra("answered / cases", (s) => `${s.answered}/${s.cases}`);
	extra("unavailable", (s) => String(s.unavailable));
	extra("p50 ms", (s) => fmt(s.latency.p50, 0));
	extra("p95 ms", (s) => fmt(s.latency.p95, 0));
	extra("cost USD", (s) => s.costUsd.toFixed(5));
	extra("calibrated", (s) => `${Math.round(s.calibratedShare * 100)}%`);
	const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
	return rows
		.map((r) =>
			r
				.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i])))
				.join("  ")
				.trimEnd(),
		)
		.join("\n");
}

export function renderVerdict(report: EvalReport): string {
	const v = report.verdict;
	const lines: string[] = [];
	for (const side of [report.candidate.summary, report.baseline?.summary]) {
		if (side && side.unavailable > 0) {
			lines.push(
				`WARNING ${side.version}: ${side.unavailable} of ${side.cases} cases UNAVAILABLE (no backend answered); excluded from the averages, coverage ${fmt(side.metrics.coverage, 2)}`,
			);
		}
	}
	const scope = v.mode === "against" ? `${report.version} vs ${report.against}` : `${report.version} floor`;
	lines.push(`promotion rule (${scope}): ${v.holds ? "HOLDS" : "does not hold"}`);
	for (const f of v.floors) lines.push(`  floor ${f.metric} ≥ ${f.floor}: ${fmt(f.value)} ${f.ok ? "ok" : "FAIL"}`);
	if (v.mode === "against") {
		lines.push(`  better on: ${v.better.join(", ") || "none"}`);
		lines.push(`  worse on:  ${v.worse.join(", ") || "none"}`);
		for (const g of v.guards)
			lines.push(`  guard ${g.name}: ${fmt(g.base, 4)} → ${fmt(g.value, 4)} ${g.ok ? "ok" : "FAIL"}`);
	}
	if (v.reasons.length > 0) lines.push(`  why not: ${v.reasons.join("; ")}`);
	return lines.join("\n");
}

export function renderMarkdown(report: EvalReport): string {
	const cand = report.candidate.summary;
	const out: string[] = [];
	out.push(`# ${report.feature} ${report.version}${report.against ? ` vs ${report.against}` : ""}`);
	out.push("");
	out.push(
		`${report.verdict.holds ? "Promotion rule holds." : "Promotion rule does not hold."} This report never promotes; \`decision promote ${report.feature} ${report.version}\` is a separate step.`,
	);
	out.push("");
	out.push("## Run");
	out.push("");
	out.push(`- generated: ${report.generatedAt}`);
	out.push(`- cases: \`${report.casesPath}\` (${cand.cases})`);
	out.push(`- backend: ${report.backend} · ladder ${report.ladder.join(" → ") || "none"}`);
	out.push(
		`- answered ${cand.answered}, unavailable ${cand.unavailable}, skipped ${cand.skipped}, invalid ${cand.invalid}`,
	);
	out.push(
		`- backends used: ${
			Object.entries(cand.backends)
				.map(([k, n]) => `${k} ×${n}`)
				.join(", ") || "none"
		}`,
	);
	out.push("");
	out.push("## Metrics");
	out.push("");
	out.push("```text");
	out.push(renderTable(report));
	out.push("```");
	out.push("");
	out.push("## Promotion rule");
	out.push("");
	out.push("```text");
	out.push(renderVerdict(report));
	out.push("```");
	out.push("");
	out.push(
		`Rule: clears the feature floor, better on one metric, worse on none; p95 latency within ${LATENCY_TOLERANCE}×, cost within ${COST_TOLERANCE}×, calibrated share within ${CALIBRATION_TOLERANCE}.`,
	);
	const misses = report.candidate.outcomes
		.filter((o) => (o.status === "routed" && isMiss(o.metrics)) || o.status === "skipped")
		.slice(0, 20);
	if (misses.length > 0) {
		out.push("");
		out.push(`## Misses (${cand.version}, first ${misses.length})`);
		out.push("");
		out.push("| # | prompt | expected | got |");
		out.push("|---|---|---|---|");
		const cell = (text: string) => text.replace(/\|/g, "\\|");
		for (const m of misses)
			out.push(
				`| ${m.index + 1} | ${cell(m.prompt)} | ${cell(clip(JSON.stringify(m.expected), 120))} | ${cell(m.got)} |`,
			);
	}
	out.push("");
	return out.join("\n");
}

export function reportBasename(
	report: Pick<EvalReport, "feature" | "version" | "against" | "backend">,
	flagBackend: boolean,
	date = new Date(),
): string {
	const parts = [dayStamp(date), `${report.feature}-${report.version}`];
	const suffix = [
		flagBackend ? report.backend.replace(/[^\w.-]+/g, "_") : "",
		report.against ? `vs-${report.against}` : "",
	].filter(Boolean);
	return suffix.length > 0 ? `${parts.join("-")}-${suffix.join("-")}` : parts.join("-");
}

export function writeReport(
	report: EvalReport,
	flagBackend: boolean,
	dir = EVAL_DOCS_DIR,
): { md: string; json: string } {
	mkdirSync(dir, { recursive: true });
	const base = join(dir, reportBasename(report, flagBackend));
	writeFileSync(`${base}.md`, renderMarkdown(report));
	writeFileSync(`${base}.json`, `${JSON.stringify(report, null, "\t")}\n`);
	return { md: `${base}.md`, json: `${base}.json` };
}

// --- CLI -----------------------------------------------------------------------------------

/** Cases run by default; the free Jev quota is small and shared with the live daemon. */
export const DEFAULT_LIMIT = 10;

export const EVAL_USAGE = `usage: decision eval --feature <f> --version vN [--against vM] [--backend <provider/jev-sku>] [--cases path] [--limit n | --all] [--concurrency n]
  Runs the first ${DEFAULT_LIMIT} cases unless --limit n or --all is given: every case is one Jev call and the free
  Jev quota is small (it is shared with the live daemon, and a spent quota makes the run \`unavailable\`).`;

async function pinBackends(config: DaemonConfig, which: string | undefined): Promise<Backend[] | undefined> {
	const probe = new BackendLadder(config.backends);
	if (which === undefined) return probe.list();
	// Pin one Jev SKU (e.g. `openrouter/typesafe/jev-1.14`) to compare free and paid on the same cases.
	const list = probe.list().filter((b) => b.model === which);
	if (list.length === 0)
		throw new Error(
			`--backend ${which} is not in the ladder (${probe
				.list()
				.map((b) => b.model)
				.join(", ")})`,
		);
	return list;
}

export async function evalCommand(argv: string[]): Promise<number> {
	let flags: ReturnType<typeof parseFlags>;
	try {
		flags = parseFlags(argv, ["all"]);
	} catch (error) {
		console.error(`${(error as Error).message}\n${EVAL_USAGE}`);
		return 2;
	}
	const { feature: name, version, against, backend, cases: casesFlag } = flags.values;
	const def = name ? findFeature(name) : undefined;
	if (!def || !version) {
		console.error(
			`${name && !def ? `unknown feature ${name} (have ${FEATURES.map((f) => f.name).join(", ")})\n` : ""}${EVAL_USAGE}`,
		);
		return 2;
	}
	try {
		const limit = positiveInt(flags.values.limit, "limit");
		const concurrency = positiveInt(flags.values.concurrency, "concurrency") ?? 2;
		const casesPath = casesFlag ?? join(EVALS_DIR, `${def.name}.jsonl`);
		if (!existsSync(casesPath)) throw new Error(`no cases at ${casesPath}`);
		const all = loadCases(casesPath);
		if (limit && flags.values.all) throw new Error("--limit and --all are exclusive");
		const cases = flags.values.all ? all : all.slice(0, limit ?? DEFAULT_LIMIT);
		if (cases.length === 0) throw new Error(`${casesPath} has no cases`);
		for (const v of [version, against]) {
			if (v) def.load(v);
		}

		const config = readConfig();
		const ladder = await pinBackends(config, backend);
		const runtime = createRuntime({ ...config, backends: ladder, cacheTtlSec: 0 });
		const decide = runtime.engine.decide.bind(runtime.engine);
		const runId = Math.random().toString(36).slice(2, 8);
		console.log(
			`${def.name}: running ${cases.length} of ${all.length} cases${cases.length < all.length ? " (default cap; --all or --limit n to change; the free Jev quota is small)" : ""}`,
		);
		console.log(
			`${def.name}: ${cases.length} cases · ${version}${against ? ` vs ${against}` : ""} · backends ${(ladder ?? []).map((b) => b.model).join(" → ")}`,
		);

		const run = async (v: string) => {
			const outcomes = await runCases({ def, version: v, cases, decide, log: runtime.log, runId, concurrency });
			return { summary: summarize(v, outcomes), outcomes };
		};
		const candidate = await run(version);
		const baseline = against ? await run(against) : undefined;
		const report: EvalReport = {
			schema: 1,
			feature: def.name,
			version,
			against,
			backend: backend ?? "default",
			ladder: (ladder ?? []).map((b) => b.model),
			casesPath,
			generatedAt: new Date().toISOString(),
			candidate,
			baseline,
			verdict: judgePromotion(def.name, candidate.summary, baseline?.summary),
		};
		const files = writeReport(report, backend !== undefined);
		console.log(`\n${renderTable(report)}\n\n${renderVerdict(report)}\n\nreport ${files.md}\njson   ${files.json}`);
		console.log("this run does not promote; use `decision promote <feature> <vN>` when satisfied");
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}
