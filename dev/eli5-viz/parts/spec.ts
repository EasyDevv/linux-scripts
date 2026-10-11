/** The page spec: the single JSON contract an ELI5 page is authored against.
 *  Structure and copy live here; the parts/ builders render the shared skeleton from it.
 *  Every visible string comes from this JSON (the page language is the author's choice), and the
 *  build fails here with a precise message when something a widget needs is missing. */
import { checkCopy, checkIcon, escAttr, isTone, TONE_ICON, type Tone } from "./tokens.ts";

export type { Tone } from "./tokens.ts";

export interface StoreSpec {
	n: number;
	min: number;
	max: number;
	log?: boolean;
	/** Story places: where the shared number puts the protagonist. */
	places?: { upTo: number; label: string; icon: string }[];
}

export interface UiSpec {
	storeLabel?: string;
	tone: Record<Tone, string>;
	toneHelp?: Partial<Record<Tone, string>>;
	quizTitle?: string;
	quizRight?: string;
	quizWrong?: string;
	quizRetry?: string;
	flipBad?: string;
	flipGood?: string;
	flipStop?: string;
	flipPass?: string;
	/** Copy for the chrome the parts own; language comes from the page, never from the part. */
	themeToggle: string;
}

export interface QuizSpec {
	q: string;
	options: string[];
	answer: number;
	why: string;
}

export type SaySpec =
	| { by: "store"; lines: { upTo: number; icon?: string; t: string; state?: string }[] }
	| { by: "done"; before: { icon?: string; t: string }; after: { icon?: string; t: string } };

export interface CastMember {
	id: string;
	icon: string;
	/** Mono line on the cast card (e.g. "현금 · 0층"). */
	term: string;
	/** Short mono label in the takeaway summary (default: term). */
	short?: string;
	label: string;
	story: string;
	stat: string;
	/** Takeaway summary reading (default: story). */
	reading?: string;
	tone: Tone;
}

export interface CastSpec {
	title: string;
	lead?: string;
	members: CastMember[];
	/** Tone legend copy; derived from ui.tone + ui.toneHelp when absent. */
	legend?: { tone: Tone; text: string }[];
}

export interface TabItem {
	id: string;
	label: string;
	icon?: string;
	panel: string;
}

export type BlockSpec =
	| { w: "flip" }
	| { w: "facts" }
	| { w: "flow"; steps: string; result?: string }
	| { w: "bars"; ids: string[]; log?: boolean; note?: string }
	| { w: "cards" }
	| { w: "tabs"; start?: string; items: TabItem[] }
	| { w: "numinput" };

export interface HeroSpec {
	/** The question the stage answers (the gate warns on a label instead of a question). */
	question?: string;
	icon?: string;
	/** Key of a <template data-body> fragment for fully custom stage content. */
	body?: string;
	blocks?: BlockSpec[];
	tabs?: { start?: string; items: TabItem[] };
}

export interface ChapterSpec {
	icon: string;
	/** Mono terms after the chapter number (e.g. "n · 작업량"). */
	term?: string;
	title: string;
	scene: string;
	body?: string;
	blocks?: BlockSpec[];
	/** What the reader walks away with ("win · win · win"). */
	gains?: string;
	/** Bridge line pulling into the next chapter. */
	bridge?: string;
	/** Recap chip label in the takeaway; defaults to the title without its leading chapter-number prefix. */
	recap?: string;
	/** Bridge target; defaults to the next chapter, or #takeaway on the last one. */
	next?: string;
	/** Force the shared ui-stage wrapper instead of the default (one block = one ui-card). */
	wrap?: "stage" | "none";
}

export interface TakeawaySpec {
	scene: string;
	claim: string;
	prose?: string;
	recapTitle?: string;
	summaryTitle?: string;
}

export interface FooterSpec {
	/** Full copy of the source line (e.g. "출처: docs/investment/….md."). */
	source: string;
	/** The map-not-spec note. */
	note: string;
}

export interface PageSpec {
	lang: string;
	theme?: "dark" | "light";
	meta: { title: string; eyebrow: string; h1: string; prose: string; scene: string };
	store: StoreSpec;
	ui: UiSpec;
	/** Emitted when quiz.predict exists; data-title copy. */
	predict?: { title?: string };
	cast?: CastSpec;
	/** Sticky store bar; omitted entirely when absent. */
	storeBar?: { presets?: string; wide?: boolean };
	hero: HeroSpec;
	chapters: ChapterSpec[];
	takeaway?: TakeawaySpec;
	footer?: FooterSpec;
	quiz?: Record<string, QuizSpec>;
	flip?: { bad: string; good: string }[];
	say?: Record<string, SaySpec>;
	bars?: Record<string, { icon?: string; label?: string; term?: string; value: number; story?: string; tone?: Tone; kind?: string }>;
	facts?: { icon?: string; term: string; desc: string }[];
	lexicon?: { t: string; cls: string }[];
	/** The page uses <pre class="mermaid"> in a template; emit the Mermaid ESM import. */
	mermaid?: boolean;
}

const err = (msg: string) => new Error(`spec: ${msg}`);

const str = (where: string, v: unknown): string => checkCopy(where, v);
const optStr = (where: string, v: unknown): string | undefined => (v == null ? undefined : checkCopy(where, v));

const parseInto = <T>(where: string, v: unknown, fn: (where: string, v: unknown) => T): T => {
	try {
		return fn(where, v);
	} catch (e) {
		throw err(`${where}: ${(e as Error).message.replace(/^spec: /, "")}`);
	}
};

const num = (where: string, v: unknown): number => {
	if (typeof v !== "number" || !Number.isFinite(v)) throw err(`${where}: expected a finite number, got ${JSON.stringify(v)}`);
	return v;
};

const arr = <T>(where: string, v: unknown, fn: (w: string, x: unknown) => T): T[] => {
	if (!Array.isArray(v)) throw err(`${where}: expected an array`);
	return v.map((x, i) => parseInto(`${where}[${i}]`, x, fn));
};

const obj = (where: string, v: unknown): Record<string, unknown> => {
	if (!v || typeof v !== "object" || Array.isArray(v)) throw err(`${where}: expected an object`);
	return v as Record<string, unknown>;
};

function parseUi(where: string, v: unknown): UiSpec {
	const o = obj(where, v);
	const tone = obj(`${where}.tone`, o.tone);
	for (const t of ["pass", "go", "stop"] as const) checkCopy(`${where}.tone.${t}`, tone[t]);
	const toneHelp = o.toneHelp == null ? undefined : obj(`${where}.toneHelp`, o.toneHelp);
	return {
		storeLabel: optStr(`${where}.storeLabel`, o.storeLabel),
		tone: { pass: tone.pass as string, go: tone.go as string, stop: tone.stop as string },
		toneHelp: toneHelp as Partial<Record<Tone, string>> | undefined,
		quizTitle: optStr(`${where}.quizTitle`, o.quizTitle),
		quizRight: optStr(`${where}.quizRight`, o.quizRight),
		quizWrong: optStr(`${where}.quizWrong`, o.quizWrong),
		quizRetry: optStr(`${where}.quizRetry`, o.quizRetry),
		flipBad: optStr(`${where}.flipBad`, o.flipBad),
		flipGood: optStr(`${where}.flipGood`, o.flipGood),
		flipStop: optStr(`${where}.flipStop`, o.flipStop),
		flipPass: optStr(`${where}.flipPass`, o.flipPass),
		themeToggle: checkCopy(`${where}.themeToggle`, o.themeToggle),
	};
}

function parseQuiz(where: string, v: unknown): QuizSpec {
	const o = obj(where, v);
	const options = arr(`${where}.options`, o.options, (w, x) => checkCopy(w, x));
	if (options.length < 2) throw err(`${where}.options: needs 2+ options`);
	const answer = num(`${where}.answer`, o.answer);
	if (!(answer >= 0 && answer < options.length)) throw err(`${where}.answer: index out of range`);
	if (checkCopy(`${where}.why`, o.why).length < 10) throw err(`${where}.why: needs an explanation of at least 10 characters`);
	return { q: str(`${where}.q`, o.q), options, answer, why: str(`${where}.why`, o.why) };
}

function parseSay(where: string, v: unknown): SaySpec {
	const o = obj(where, v);
	const by = str(`${where}.by`, o.by);
	if (by === "store") {
		const lines = arr(`${where}.lines`, o.lines, (w, x) => {
			const l = obj(w, x);
			const line: { upTo: number; icon?: string; t: string; state?: string } = { upTo: num(`${w}.upTo`, l.upTo), t: str(`${w}.t`, l.t) };
			if (l.icon != null) line.icon = checkIcon(`${w}.icon`, l.icon);
			if (l.state != null) line.state = str(`${w}.state`, l.state);
			return line;
		});
		if (!lines.length) throw err(`${where}.lines: needs at least one line`);
		return { by: "store", lines };
	}
	if (by !== "done") throw err(`${where}.by: expected "store" or "done"`);
	const side = (name: "before" | "after") => {
		const b = obj(`${where}.${name}`, o[name]);
		const s: { icon?: string; t: string } = { t: str(`${where}.${name}.t`, b.t) };
		if (b.icon != null) s.icon = checkIcon(`${where}.${name}.icon`, b.icon);
		return s;
	};
	return { by: "done", before: side("before"), after: side("after") };
}

function parseTabItems(where: string, v: unknown): TabItem[] {
	return arr(where, v, (w, x) => {
		const o = obj(w, x);
		const item: TabItem = { id: str(`${w}.id`, o.id), label: str(`${w}.label`, o.label), panel: str(`${w}.panel`, o.panel) };
		if (o.icon != null) item.icon = checkIcon(`${w}.icon`, o.icon);
		return item;
	});
}

function parseBlock(where: string, v: unknown): BlockSpec {
	const o = obj(where, v);
	const w = str(`${where}.w`, o.w);
	switch (w) {
		case "flip":
			return { w: "flip" };
		case "facts":
			return { w: "facts" };
		case "numinput":
			return { w: "numinput" };
		case "cards":
			return { w: "cards" };
		case "flow": {
			const steps = str(`${where}.steps`, o.steps);
			const result = optStr(`${where}.result`, o.result);
			return result == null ? { w: "flow", steps } : { w: "flow", steps, result };
		}
		case "bars": {
			const ids = arr(`${where}.ids`, o.ids, (xw, x) => str(`${xw}`, x));
			if (!ids.length) throw err(`${where}.ids: needs at least one id`);
			const log = o.log === true;
			const note = optStr(`${where}.note`, o.note);
			return note == null ? { w: "bars", ids, log } : { w: "bars", ids, log, note };
		}
		case "tabs": {
			const start = optStr(`${where}.start`, o.start);
			const items = parseTabItems(`${where}.items`, o.items);
			if (!items.length) throw err(`${where}.items: needs at least one tab`);
			const ids = items.map((i) => i.id);
			if (new Set(ids).size !== ids.length) throw err(`${where}.items: duplicate tab ids`);
			if (start != null && !ids.includes(start)) throw err(`${where}.start: "${start}" is not a tab id`);
			return start == null ? { w: "tabs", items } : { w: "tabs", start, items };
		}
		default:
			throw err(`${where}.w: unknown block "${w}"`);
	}
}

/** Parse + validate a page spec. Throws with a precise path on the first problem. */
export function parseSpec(input: unknown): PageSpec {
	const o = obj("page", input);
	const lang = str("lang", o.lang);
	const metaO = obj("meta", o.meta);
	const meta = {
		title: str("meta.title", metaO.title),
		eyebrow: str("meta.eyebrow", metaO.eyebrow),
		h1: str("meta.h1", metaO.h1),
		prose: str("meta.prose", metaO.prose),
		scene: str("meta.scene", metaO.scene),
	};
	const theme = o.theme == null ? "dark" : str("theme", o.theme);
	if (theme !== "dark" && theme !== "light") throw err(`theme: expected "dark" or "light"`);

	const storeO = obj("store", o.store);
	const min = num("store.min", storeO.min);
	const max = num("store.max", storeO.max);
	const n = num("store.n", storeO.n);
	if (!(min <= max)) throw err(`store: min ${min} is above max ${max}`);
	if (n < min || n > max) throw err(`store: n ${n} is outside ${min}..${max}`);
	const places = storeO.places == null ? undefined : arr("store.places", storeO.places, (w, x) => {
		const p = obj(w, x);
		return { upTo: num(`${w}.upTo`, p.upTo), label: str(`${w}.label`, p.label), icon: checkIcon(`${w}.icon`, p.icon) };
	});
	const store: StoreSpec = { n, min, max, ...(storeO.log === true ? { log: true } : {}), ...(places ? { places } : {}) };
	const ui = parseUi("ui", o.ui);

	const predict = o.predict == null ? undefined : obj("predict", o.predict);
	const castO = obj("cast", o.cast ?? {});
	const cast = o.cast == null ? undefined : ({
		title: str("cast.title", castO.title),
		...(castO.lead == null ? {} : { lead: str("cast.lead", castO.lead) }),
		members: arr("cast.members", castO.members, (w, x) => {
			const m = obj(w, x);
			const id = str(`${w}.id`, m.id);
			if (!/^[a-z][a-z0-9-]*$/.test(id)) throw err(`${w}.id: "${id}" must match [a-z][a-z0-9-]* (it becomes the k- class)`);
			const tone = m.tone;
			if (!isTone(tone)) throw err(`${w}.tone: expected pass, go, or stop`);
			return {
				id,
				icon: checkIcon(`${w}.icon`, m.icon),
				term: str(`${w}.term`, m.term),
				short: optStr(`${w}.short`, m.short),
				label: str(`${w}.label`, m.label),
				story: str(`${w}.story`, m.story),
				stat: str(`${w}.stat`, m.stat),
				reading: optStr(`${w}.reading`, m.reading),
				tone,
			};
		}),
		...(castO.legend == null ? {} : { legend: arr("cast.legend", castO.legend, (w, x) => {
			const l = obj(w, x);
			if (!isTone(l.tone)) throw err(`${w}.tone: expected pass, go, or stop`);
			return { tone: l.tone, text: str(`${w}.text`, l.text) };
		}) }),
	});

	const storeBar = o.storeBar == null ? undefined : obj("storeBar", o.storeBar);

	const heroO = obj("hero", o.hero);
	const hero: HeroSpec = {
		...(heroO.question == null ? {} : { question: str("hero.question", heroO.question) }),
		...(heroO.icon == null ? {} : { icon: checkIcon("hero.icon", heroO.icon) }),
		...(heroO.body == null ? {} : { body: str("hero.body", heroO.body) }),
		...(heroO.blocks == null ? {} : { blocks: arr("hero.blocks", heroO.blocks, (w, x) => parseBlock(w, x)) }),
		...(heroO.tabs == null ? {} : { tabs: { start: optStr("hero.tabs.start", obj("hero.tabs", heroO.tabs).start), items: parseTabItems("hero.tabs.items", obj("hero.tabs", heroO.tabs).items) } }),
	};
	if (hero.question != null && !/[?？]/.test(hero.question)) throw err(`hero.question: must be the question the stage answers (missing "?")`);
	if (!hero.body && !hero.blocks && !hero.tabs) throw err(`hero: needs one of body, blocks, or tabs`);
	if (hero.tabs && (hero.blocks || hero.body)) throw err(`hero: pick tabs, blocks, or body (not several)`);

	const chapters = arr("chapters", o.chapters, (w, x) => {
		const c = obj(w, x);
		const ch: ChapterSpec = {
			icon: checkIcon(`${w}.icon`, c.icon),
			title: str(`${w}.title`, c.title),
			scene: str(`${w}.scene`, c.scene),
			...(c.term == null ? {} : { term: str(`${w}.term`, c.term) }),
			...(c.body == null ? {} : { body: str(`${w}.body`, c.body) }),
			...(c.blocks == null ? {} : { blocks: arr(`${w}.blocks`, c.blocks, (bw, bx) => parseBlock(bw, bx)) }),
			...(c.gains == null ? {} : { gains: str(`${w}.gains`, c.gains) }),
			...(c.bridge == null ? {} : { bridge: str(`${w}.bridge`, c.bridge) }),
			...(c.recap == null ? {} : { recap: str(`${w}.recap`, c.recap) }),
			...(c.next == null ? {} : { next: str(`${w}.next`, c.next) }),
			...(c.wrap == null ? {} : { wrap: c.wrap === "stage" || c.wrap === "none" ? c.wrap : undefined }),
		};
		if (!ch.body && !ch.blocks) throw err(`${w}: needs a body template or blocks`);
		return ch;
	});
	if (!chapters.length) throw err(`chapters: at least one chapter`);

	const takeaway = o.takeaway == null ? undefined : (() => {
		const t = obj("takeaway", o.takeaway);
		return {
			scene: str("takeaway.scene", t.scene),
			claim: str("takeaway.claim", t.claim),
			prose: optStr("takeaway.prose", t.prose),
			recapTitle: optStr("takeaway.recapTitle", t.recapTitle),
			summaryTitle: optStr("takeaway.summaryTitle", t.summaryTitle),
		};
	})();

	const footer = o.footer == null ? undefined : (() => {
		const f = obj("footer", o.footer);
		return { source: str("footer.source", f.source), note: str("footer.note", f.note) };
	})();

	const quiz = o.quiz == null ? undefined : Object.fromEntries(Object.entries(obj("quiz", o.quiz)).map(([k, v]) => [k, parseQuiz(`quiz.${k}`, v)]));
	const flip = o.flip == null ? undefined : arr("flip", o.flip, (w, x) => {
		const f = obj(w, x);
		return { bad: str(`${w}.bad`, f.bad), good: str(`${w}.good`, f.good) };
	});
	const say = o.say == null ? undefined : Object.fromEntries(Object.entries(obj("say", o.say)).map(([k, v]) => [k, parseSay(`say.${k}`, v)]));
	const bars = o.bars == null ? undefined : Object.fromEntries(Object.entries(obj("bars", o.bars)).map(([k, v]) => {
		const b = obj(`bars.${k}`, v);
		const entry: NonNullable<PageSpec["bars"]>[string] = { value: num(`bars.${k}.value`, b.value) };
		if (b.icon != null) entry.icon = checkIcon(`bars.${k}.icon`, b.icon);
		if (b.label != null) entry.label = str(`bars.${k}.label`, b.label);
		if (b.term != null) entry.term = str(`bars.${k}.term`, b.term);
		if (b.story != null) entry.story = str(`bars.${k}.story`, b.story);
		if (b.tone != null) { if (!isTone(b.tone)) throw err(`bars.${k}.tone: expected pass, go, or stop`); entry.tone = b.tone; }
		if (b.kind != null) { if (!/^[a-z][a-z0-9-]*$/.test(String(b.kind))) throw err(`bars.${k}.kind: must match [a-z][a-z0-9-]*`); entry.kind = String(b.kind); }
		return [k, entry];
	}));
	const facts = o.facts == null ? undefined : arr("facts", o.facts, (w, x) => {
		const f = obj(w, x);
		return { icon: f.icon == null ? undefined : checkIcon(`${w}.icon`, f.icon), term: str(`${w}.term`, f.term), desc: str(`${w}.desc`, f.desc) };
	});
	const lexicon = o.lexicon == null ? undefined : arr("lexicon", o.lexicon, (w, x) => {
		const l = obj(w, x);
		return { t: str(`${w}.t`, l.t), cls: str(`${w}.cls`, l.cls) };
	});

	const spec: PageSpec = {
		lang,
		theme,
		meta,
		store,
		ui,
		...(predict ? { predict: { title: (predict.title as string) || undefined } } : {}),
		...(cast ? { cast } : {}),
		...(storeBar ? { storeBar: { presets: optStr("storeBar.presets", storeBar.presets), wide: storeBar.wide === true } } : {}),
		hero,
		chapters,
		...(takeaway ? { takeaway } : {}),
		...(footer ? { footer } : {}),
		...(quiz ? { quiz } : {}),
		...(flip ? { flip } : {}),
		...(say ? { say } : {}),
		...(bars ? { bars } : {}),
		...(facts ? { facts } : {}),
		...(lexicon ? { lexicon } : {}),
		...(o.mermaid === true ? { mermaid: true } : {}),
	};

	// a chapter is not optional for its widgets: quiz + say hooks fire per chapter id
	chapters.forEach((_, i) => {
		const key = `step-${i + 1}`;
		if (!spec.quiz?.[key]) throw err(`quiz.${key}: every chapter renders a self-check quiz; add an entry`);
		if (!spec.say?.[key]) throw err(`say.${key}: every chapter's narration line needs a say entry`);
	});
	// blocks need their data
	const blockNeeds = (b: BlockSpec) => {
		if (b.w === "flip" && !spec.flip?.length) throw err("flip block: needs at least one flip[] entry");
		if (b.w === "facts" && !spec.facts?.length) throw err("facts block: needs at least one facts[] entry");
		if (b.w === "bars") for (const id of b.ids) if (!spec.bars?.[id]) throw err(`bars block: no bars.${id} entry`);
		if (b.w === "cards" && !spec.cast?.members.length) throw err("cards block: needs cast.members");
	};
	for (const b of hero.blocks ?? []) blockNeeds(b);
	chapters.forEach((c, i) => (c.blocks ?? []).forEach((b, j) => {
		try {
			blockNeeds(b);
		} catch (e) {
			throw err(`chapters[${i}].blocks[${j}]: ${(e as Error).message}`);
		}
	}));
	if (spec.predict !== undefined && !spec.quiz?.predict) throw err("predict section: needs a quiz.predict entry");
	if (spec.takeaway?.summaryTitle && !spec.cast?.members.length) throw err("takeaway.summaryTitle: needs cast.members for the summary rows");
	return spec;
}

/** The runtime slice: what #eli5-data carries for the browser (icons are added by inline.ts). */
export function specData(spec: PageSpec): Record<string, unknown> {
	const data: Record<string, unknown> = { store: spec.store, ui: spec.ui };
	if (spec.cast) data.cast = spec.cast.members;
	if (spec.quiz) data.quiz = spec.quiz;
	if (spec.flip) data.flip = spec.flip;
	if (spec.say) data.say = spec.say;
	if (spec.lexicon) data.lexicon = spec.lexicon;
	if (spec.bars) data.bars = spec.bars;
	if (spec.facts) data.facts = spec.facts;
	return data;
}

/** Kind colors the page needs, derived from cast members (and any bars kind): one k-<id> per entity,
 *  reusing its tone color, so no page ever hand-writes a color block again. */
export function kindColors(spec: PageSpec): { id: string; tone: Tone }[] {
	const out: { id: string; tone: Tone }[] = [];
	const seen = new Set<string>();
	const add = (id: string, tone: Tone) => {
		if (seen.has(id)) return;
		seen.add(id);
		out.push({ id, tone });
	};
	for (const m of spec.cast?.members ?? []) add(m.id, m.tone);
	for (const b of Object.values(spec.bars ?? {})) if (b.kind && b.tone) add(b.kind, b.tone);
	return out;
}

/** Where a chapter's bridge lands: the next chapter, else the takeaway, else nowhere. */
export const nextTarget = (spec: PageSpec, i: number): string | undefined => {
	const own = spec.chapters[i]!.next;
	if (own) return own;
	if (i + 1 < spec.chapters.length) return `#step-${i + 2}`;
	return spec.takeaway ? "#takeaway" : undefined;
};

export const chapterKey = (i: number) => `step-${i + 1}`;

export const toneIconName = (t: Tone) => TONE_ICON[t];

export { escAttr };
