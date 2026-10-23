/**
 * find_skill: which skills and routed rules a prompt needs loaded.
 *
 * Jev judges, code composes. A large catalog is first narrowed by one choice question (the
 * candidate whose activity the request asks for, or `none`); the shortlist then gets one bool
 * each: "is the requested activity this candidate's activity" (pi-jev's applicability wording;
 * a shared topic alone is not enough). A small catalog skips the narrowing and asks the bools
 * directly, so a prompt costs at most two Jev calls. Rules linked to a selected skill through
 * their `skills:` frontmatter come along. Nothing is applied here: the harness injects.
 *
 * With `limits.scriptFirst`, `paths:` globs run before Jev (`path-trigger.ts`): a rule whose glob
 * matches a path the prompt names or the harness touched is selected outright, and a matching
 * skill, or one a matched rule names in `skills:`, is always asked (the shortlist cannot drop it).
 * A body with `paths` and no prompt is a touch report: only the globs answer, no Jev call, and
 * those skills come back as hints.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClassifierAnswer, ClassifierQuestion, JsonObject } from "@earendil-works/pi-ai";
import { type CatalogEntry, CatalogReader, projectRoot } from "../catalog.ts";
import type { DecideRequest, Decision } from "../engine.ts";
import { skipReason } from "./model-route.ts";
import { mentionedPaths, type PathHit, pathHits } from "./path-trigger.ts";
import { type FeatureDef, type FeatureResult, strings, str } from "./types.ts";

export interface FindSkillPrompt {
	version: string;
	kinds: Record<CatalogEntry["kind"], string>;
	choose: { noneLabel: string; noneDescription: string; instructions: string };
	apply: { instructions: string; true: string; false: string };
	limits: {
		chooseDescriptionChars: number;
		applyDescriptionChars: number;
		historyChars: number;
		/** At most this many candidates: ask the bools directly, no shortlist call. */
		directBelow: number;
		shortlistSize: number;
		/** A shortlist member needs at least this choice probability. */
		shortlistFloor: number;
		/** `none` at or above this probability ends the lookup with nothing selected. */
		noneStop: number;
		skillThreshold: number;
		ruleThreshold: number;
		maxSkills: number;
		maxRules: number;
		/** A skill at or above this probability arrives with its `SKILL.md` body; absent = hints only. */
		injectThreshold?: number;
		/** At most this many skills carry a body (the highest p first); default 1. */
		injectMax?: number;
		/** A body longer than this stays a hint: a skill cut mid-way misleads. Default 12000. */
		injectMaxChars?: number;
		/** Match `paths:` globs before asking Jev. */
		scriptFirst?: boolean;
	};
}

export function loadFindSkillPrompt(
	version = "v1",
	dir = join(import.meta.dir, "..", "prompts", "find_skill"),
): FindSkillPrompt {
	return JSON.parse(readFileSync(join(dir, `${version}.json`), "utf8")) as FindSkillPrompt;
}

export interface FindSkillInput {
	prompt: string;
	history?: string;
	cwd?: string;
	loaded?: string[];
	/** Files the harness touched (read, edited, written) since the last call. */
	paths?: string[];
	harness?: string;
	sessionId?: string;
}

export interface FoundSkill {
	name: string;
	path: string;
	description: string;
	p: number;
	/** `SKILL.md` without frontmatter, set when the harness should load it into context itself. */
	body?: string;
}

export interface FoundRule {
	name: string;
	path: string;
	scope: "global" | "project";
	p: number;
	body: string;
}

export interface FindSkillResult extends FeatureResult {
	skills: FoundSkill[];
	rules: FoundRule[];
	/** Skills and rules that were candidates (everything visible minus `loaded`). */
	candidates: number;
	/** Set when Jev did not answer and code (paths, keywords) picked these candidates: hints only. */
	fallback?: true;
}

/** Keyword fallback caps: a few of each kind, so a Jev outage stays quiet. */
export const KEYWORD_LIMITS = { skills: 3, rules: 2 } as const;
/** One name token match is enough; a description word alone is not. */
export const KEYWORD_MIN_SCORE = 3;
/** A keyword hit's p: below every `skillThreshold`/`ruleThreshold`, so it is never injected. */
export const KEYWORD_P = 0.4;

const STOPWORDS = new Set([
	"the", "and", "for", "with", "this", "that", "from", "into", "when", "what", "how", "why", "who",
	"fix", "add", "use", "using", "used", "not", "are", "was", "were", "has", "had", "have", "but", "you",
	"your", "its", "can", "could", "does", "did", "all", "any", "one", "two", "out", "get", "set", "make",
	"new", "run", "via", "per", "then", "than", "also", "just", "only", "more", "most", "some", "such", "over",
	"after", "before", "again", "still", "there", "here", "them", "they", "should", "would", "will", "please",
	"대한", "대해", "때문", "그리고", "합니다", "해줘", "해주세요", "에서", "으로", "하는", "있는", "없는", "이거",
	"그거", "저거", "것을", "것은", "수가", "등", "및", "더", "잘", "안", "좀", "그", "이", "저", "수", "것",
]);

function words(text: string): string[] {
	return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function isHangul(token: string): boolean {
	return /\p{Script=Hangul}/u.test(token);
}

function nameTokens(name: string): string[] {
	return name.toLowerCase().split(/[-._/]+/).filter(Boolean);
}

/** Prompt tokens that can match: latin 3+ chars, Korean 2+; stopwords never. */
function promptTokens(prompt: string): Set<string> {
	const set = new Set<string>();
	for (const token of words(prompt)) {
		if (STOPWORDS.has(token)) continue;
		if (token.length >= (isHangul(token) ? 2 : 3)) set.add(token);
	}
	return set;
}

/** Korean particles attach to a stem, so a 2+ char token also matches inside a longer word. */
function hangulOverlap(token: string, prompt: Set<string>): boolean {
	if (token.length < 2) return false;
	for (const word of prompt) {
		if (word.length >= 2 && (word === token || word.includes(token) || token.includes(word))) return true;
	}
	return false;
}

/**
 * Code-only recall for a Jev outage: token overlap between the prompt and an entry's name +
 * description, name tokens weighing more. Returns the highest scores per kind, above the floor.
 */
export function keywordHits(
	prompt: string,
	candidates: readonly CatalogEntry[],
	limits: { skills: number; rules: number } = KEYWORD_LIMITS,
): { entry: CatalogEntry; score: number }[] {
	const tokens = promptTokens(prompt);
	if (tokens.size === 0) return [];
	const scored: { entry: CatalogEntry; score: number }[] = [];
	for (const entry of candidates) {
		let score = 0;
		for (const token of nameTokens(entry.name)) {
			if (token.length < 2) continue;
			if (tokens.has(token) || (isHangul(token) && hangulOverlap(token, tokens))) score += 3;
		}
		for (const token of new Set(words(entry.description))) {
			if (STOPWORDS.has(token) || token.length < (isHangul(token) ? 2 : 3)) continue;
			if (tokens.has(token) || (isHangul(token) && hangulOverlap(token, tokens))) score += 1;
		}
		if (score >= KEYWORD_MIN_SCORE) scored.push({ entry, score });
	}
	scored.sort((a, b) => b.score - a.score);
	const kind = (want: CatalogEntry["kind"], cap: number) =>
		scored.filter((h) => h.entry.kind === want).slice(0, cap);
	return [...kind("skill", limits.skills), ...kind("rule", limits.rules)];
}

type DecideFn = (request: DecideRequest) => Promise<Decision>;

export function labelOf(entry: CatalogEntry): string {
	return `${entry.kind}:${entry.name}`;
}

/** Cut at a word boundary so a description never ends mid-token. */
export function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const space = cut.lastIndexOf(" ");
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function fill(template: string, values: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/** Visible entries minus the names already in context, in a stable order. */
export function candidatesOf(entries: readonly CatalogEntry[], loaded: readonly string[] = []): CatalogEntry[] {
	const skip = new Set(loaded);
	return entries.filter((e) => !skip.has(e.name));
}

function stateOf(input: FindSkillInput, prompt: FindSkillPrompt): JsonObject {
	return {
		request: input.prompt,
		conversation_excerpt: input.history ? input.history.slice(-prompt.limits.historyChars) : null,
		environment: { cwd: input.cwd ?? null },
	};
}

export function buildChooseRequest(
	input: FindSkillInput,
	candidates: readonly CatalogEntry[],
	prompt: FindSkillPrompt,
): DecideRequest {
	const criteria: Record<string, string> = { [prompt.choose.noneLabel]: prompt.choose.noneDescription };
	for (const entry of candidates) {
		criteria[labelOf(entry)] =
			`${prompt.kinds[entry.kind]}: ${clip(entry.description, prompt.limits.chooseDescriptionChars)}`;
	}
	return {
		feature: "find_skill",
		version: prompt.version,
		state: stateOf(input, prompt),
		questions: { pick: { type: "choice", instructions: prompt.choose.instructions, criteria } },
		harness: input.harness,
		sessionId: input.sessionId,
	};
}

/** Bool question ids are `c<index>` into the asked list, so a label never has to be a valid key. */
export function buildApplyRequest(
	input: FindSkillInput,
	asked: readonly CatalogEntry[],
	prompt: FindSkillPrompt,
): DecideRequest {
	const questions: Record<string, ClassifierQuestion> = {};
	asked.forEach((entry, index) => {
		const values = {
			kind: prompt.kinds[entry.kind],
			name: entry.name,
			description: clip(entry.description, prompt.limits.applyDescriptionChars),
		};
		questions[`c${index}`] = {
			type: "bool",
			instructions: fill(prompt.apply.instructions, values),
			criteria: { true: fill(prompt.apply.true, values), false: fill(prompt.apply.false, values) },
		};
	});
	return {
		feature: "find_skill",
		version: prompt.version,
		state: stateOf(input, prompt),
		questions,
		harness: input.harness,
		sessionId: input.sessionId,
	};
}

/** Top choice probabilities that clear the floor; `none` is reported separately. */
export function shortlist(
	answer: ClassifierAnswer | undefined,
	candidates: readonly CatalogEntry[],
	prompt: FindSkillPrompt,
): { picked: { entry: CatalogEntry; p: number }[]; none: number } {
	if (answer?.type !== "choice") return { picked: [], none: 0 };
	const l = prompt.limits;
	const ranked = candidates
		.map((entry) => ({ entry, p: answer.probabilities[labelOf(entry)] ?? 0 }))
		.filter((c) => c.p >= l.shortlistFloor)
		.sort((a, b) => b.p - a.p)
		.slice(0, l.shortlistSize);
	return { picked: ranked, none: answer.probabilities[prompt.choose.noneLabel] ?? 0 };
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/** Applicability answers to a capped selection, plus the rules linked to the chosen skills. */
export function compose(
	asked: readonly CatalogEntry[],
	answers: Record<string, ClassifierAnswer>,
	candidates: readonly CatalogEntry[],
	prompt: FindSkillPrompt,
	forced: readonly PathHit[] = [],
): { skills: FoundSkill[]; rules: FoundRule[]; notes: string[] } {
	const l = prompt.limits;
	const scored = asked.map((entry, index) => {
		const answer = answers[`c${index}`];
		return { entry, p: answer?.type === "bool" ? answer.probability : 0 };
	});
	const byP = (a: { p: number }, b: { p: number }) => b.p - a.p;
	const skills = scored
		.filter((c) => c.entry.kind === "skill" && c.p >= l.skillThreshold)
		.sort(byP)
		.slice(0, l.maxSkills);
	const rules = new Map<string, { entry: CatalogEntry; p: number }>();
	const notes: string[] = [];
	for (const hit of forced) {
		rules.set(hit.entry.name, { entry: hit.entry, p: 1 });
		notes.push(`rule ${hit.entry.name} via path ${hit.via}`);
	}
	for (const c of scored.filter((c) => c.entry.kind === "rule" && c.p >= l.ruleThreshold).sort(byP)) {
		if (!rules.has(c.entry.name)) rules.set(c.entry.name, c);
	}
	for (const skill of skills) {
		for (const entry of candidates) {
			if (entry.kind !== "rule" || !entry.skills.includes(skill.entry.name) || rules.has(entry.name)) continue;
			rules.set(entry.name, { entry, p: skill.p });
			notes.push(`rule ${entry.name} via skill ${skill.entry.name}`);
		}
	}
	return {
		skills: skills.map(({ entry, p }, index) => {
			const found: FoundSkill = { name: entry.name, path: entry.path, description: entry.description, p: round(p) };
			const body = entry.body ?? "";
			const forced =
				l.injectThreshold !== undefined &&
				p >= l.injectThreshold &&
				index < (l.injectMax ?? 1) &&
				body !== "" &&
				body.length <= (l.injectMaxChars ?? 12_000);
			if (forced) {
				found.body = body;
				notes.push(`skill ${entry.name} body injected (p ${round(p)})`);
			}
			return found;
		}),
		rules: [...rules.values()]
			.sort(byP)
			.slice(0, l.maxRules)
			.map(({ entry, p }) => ({
				name: entry.name,
				path: entry.path,
				scope: entry.scope,
				p: round(p),
				body: entry.body ?? "",
			})),
		notes,
	};
}

/** `name=p` for every asked candidate, so an audit sees the near misses too. */
function askedProbabilities(asked: readonly CatalogEntry[], answers: Record<string, ClassifierAnswer>): string {
	return asked
		.map((entry, index) => {
			const answer = answers[`c${index}`];
			return `${entry.name}=${(answer?.type === "bool" ? answer.probability : 0).toFixed(2)}`;
		})
		.join(" ");
}

function unavailable(candidates: number, decisions: Decision[], started: number): FindSkillResult {
	const last = decisions.at(-1);
	return {
		decisionId: last?.decisionId,
		status: "unavailable",
		reason: "no backend answered",
		notes: last?.skipped ?? [],
		skills: [],
		rules: [],
		candidates,
		latencyMs: Date.now() - started,
	};
}

export async function findSkills(
	input: FindSkillInput,
	decide: DecideFn,
	prompt: FindSkillPrompt,
	catalog: CatalogReader,
): Promise<FindSkillResult> {
	const l = prompt.limits;
	const touchOnly = l.scriptFirst === true && !input.prompt.trim() && (input.paths?.length ?? 0) > 0;
	const skip = touchOnly ? undefined : skipReason({ prompt: input.prompt, history: input.history });
	if (skip) return { status: "skipped", reason: skip, notes: [], skills: [], rules: [], candidates: 0 };
	const started = Date.now();
	const candidates = candidatesOf(catalog.read(input.cwd), input.loaded);
	if (candidates.length === 0) {
		return { status: "skipped", reason: "no candidates", notes: [], skills: [], rules: [], candidates: 0 };
	}
	const hits = l.scriptFirst
		? pathHits(
				candidates,
				mentionedPaths(input.prompt, projectRoot(input.cwd ?? process.cwd()), input.cwd, input.paths),
			)
		: [];
	const ruleHits = hits.filter((h) => h.entry.kind === "rule");
	// A matched rule's `skills:` count as matched too: the rule names the skill its work needs.
	const paired = new Set(ruleHits.flatMap((h) => h.entry.skills));
	const skillHits = candidates.filter(
		(e) => e.kind === "skill" && (paired.has(e.name) || hits.some((h) => h.entry === e)),
	);
	const pathOnly = (reason: string, decision?: Decision): FindSkillResult => {
		const found = compose([], {}, candidates, prompt, ruleHits);
		return {
			decisionId: decision?.decisionId,
			status: "routed",
			reason,
			notes: [...found.notes, ...skillHits.map((e) => `skill ${e.name} hinted by path`)],
			skills: skillHits.map((e) => ({ name: e.name, path: e.path, description: e.description, p: 1 })),
			rules: found.rules,
			candidates: candidates.length,
			backend: decision?.backend,
			calibrated: decision?.calibrated,
			latencyMs: Date.now() - started,
		};
	};
	// A Jev outage: path hits as ever, plus keyword-matched candidates as hints (no bodies).
	const fallback = (decisions: Decision[]): FindSkillResult => {
		const decision = decisions.at(-1);
		const found = compose([], {}, candidates, prompt, ruleHits);
		const taken = new Set([...ruleHits.map((h) => h.entry.name), ...skillHits.map((e) => e.name)]);
		const keywords = keywordHits(
			input.prompt,
			candidates.filter((e) => !taken.has(e.name)),
		);
		if (keywords.length === 0) {
			if (ruleHits.length > 0) return pathOnly(`${ruleHits.length} rules by path, Jev unavailable`, decision);
			return unavailable(candidates.length, decisions, started);
		}
		return {
			decisionId: decision?.decisionId,
			status: "routed",
			reason: "fallback: keyword (Jev unavailable)",
			notes: [
				...(decision?.skipped ?? []),
				...found.notes,
				...skillHits.map((e) => `skill ${e.name} hinted by path`),
				...keywords.map((h) => `${h.entry.kind} ${h.entry.name} hinted by keyword (score ${h.score})`),
			],
			skills: [
				...skillHits.map((e) => ({ name: e.name, path: e.path, description: e.description, p: 1 })),
				...keywords
					.filter((h) => h.entry.kind === "skill")
					.map((h) => ({
						name: h.entry.name,
						path: h.entry.path,
						description: h.entry.description,
						p: KEYWORD_P,
					})),
			],
			rules: [
				...found.rules,
				...keywords
					.filter((h) => h.entry.kind === "rule")
					.map((h) => ({
						name: h.entry.name,
						path: h.entry.path,
						scope: h.entry.scope,
						p: KEYWORD_P,
						body: "",
					})),
			],
			candidates: candidates.length,
			fallback: true,
			backend: decision?.backend,
			calibrated: decision?.calibrated,
			latencyMs: Date.now() - started,
		};
	};
	if (touchOnly) return pathOnly(`${ruleHits.length} rules, ${skillHits.length} skills by path`);

	// Rules a glob already selected are not asked again.
	const forcedRules = new Set(ruleHits.map((h) => h.entry));
	const open = candidates.filter((e) => !forcedRules.has(e));
	const decisions: Decision[] = [];
	const notes: string[] = [];
	let asked = open;
	if (open.length > l.directBelow) {
		const choose = await decide(buildChooseRequest(input, open, prompt));
		decisions.push(choose);
		if (choose.status !== "ok") {
			// A glob or keyword match stands without Jev; fail-open only drops what Jev would have added.
			return fallback(decisions);
		}
		const { picked, none } = shortlist(choose.answers.pick, open, prompt);
		const pickedEntries = picked.map((c) => c.entry);
		asked = [...pickedEntries, ...skillHits.filter((e) => !pickedEntries.includes(e))];
		if ((none >= l.noneStop || picked.length === 0) && skillHits.length === 0) {
			return {
				...pathOnly(`none applies (none ${none.toFixed(2)})`, choose),
				calibrated: choose.calibrated,
			};
		}
		notes.push(`shortlist ${picked.map((c) => `${labelOf(c.entry)}=${c.p.toFixed(2)}`).join(" ")}`);
		if (skillHits.length > 0) notes.push(`asked by path ${skillHits.map((e) => e.name).join(" ")}`);
	}
	const apply = await decide(buildApplyRequest(input, asked, prompt));
	decisions.push(apply);
	if (apply.status !== "ok") return fallback(decisions);
	const found = compose(asked, apply.answers, candidates, prompt, ruleHits);
	notes.push(`p ${askedProbabilities(asked, apply.answers)}`);
	return {
		decisionId: apply.decisionId,
		status: "routed",
		reason:
			found.skills.length + found.rules.length === 0
				? `nothing applies (asked ${asked.length} of ${candidates.length})`
				: `${found.skills.length} skills, ${found.rules.length} rules (asked ${asked.length} of ${candidates.length})`,
		notes: [...notes, ...found.notes],
		skills: found.skills,
		rules: found.rules,
		candidates: candidates.length,
		backend: apply.backend,
		calibrated: decisions.every((d) => d.calibrated),
		latencyMs: Date.now() - started,
	};
}

function parseFindSkillInput(b: Record<string, unknown>): FindSkillInput | string {
	const prompt = str(b.prompt);
	if (prompt === undefined) return "prompt is required";
	if (b.loaded !== undefined && !strings(b.loaded)) return "loaded must be an array of strings";
	if (b.paths !== undefined && !strings(b.paths)) return "paths must be an array of strings";
	return {
		prompt,
		history: str(b.history),
		cwd: str(b.cwd),
		loaded: strings(b.loaded),
		paths: strings(b.paths),
		harness: str(b.harness),
		sessionId: str(b.sessionId),
	};
}

/** Names from a case label or a result, kind-prefixed so a skill and a rule never collide. */
function selected(skills: readonly string[] | undefined, rules: readonly string[] | undefined): Set<string> {
	return new Set([...(skills ?? []).map((n) => `skill:${n}`), ...(rules ?? []).map((n) => `rule:${n}`)]);
}

export const findSkill: FeatureDef = {
	name: "find_skill",
	path: "/v1/find_skill",
	load(version) {
		const prompt = loadFindSkillPrompt(version);
		const catalog = new CatalogReader();
		return {
			version: prompt.version,
			parse: parseFindSkillInput,
			run: (input, decide) => findSkills(input as FindSkillInput, decide, prompt, catalog),
		};
	},
	/** `expected` is `{skills, rules}` names; metrics are over the union of both kinds. */
	score(expected, result): Record<string, number> {
		if (typeof expected !== "object" || expected === null) return {};
		const e = expected as { skills?: string[]; rules?: string[] };
		const want = selected(e.skills, e.rules);
		if (result.status === "unavailable") {
			return { answered: 0, exact: 0, recall: 0, precision: 0, ...(want.size === 0 ? { quiet: 0 } : {}) };
		}
		const r = result as Partial<FindSkillResult>;
		const got = selected(
			r.skills?.map((s) => s.name),
			r.rules?.map((x) => x.name),
		);
		const hit = [...got].filter((g) => want.has(g)).length;
		return {
			answered: 1,
			exact: Number(hit === want.size && got.size === want.size),
			recall: want.size === 0 ? 1 : hit / want.size,
			precision: got.size === 0 ? 1 : hit / got.size,
			// Only cases that expect nothing: did the lookup stay silent.
			...(want.size === 0 ? { quiet: Number(got.size === 0) } : {}),
		};
	},
};
