import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierAnswer } from "@earendil-works/pi-ai";
import { type CatalogEntry, CatalogReader } from "../catalog.ts";
import type { DecideRequest, Decision } from "../engine.ts";
import {
	buildApplyRequest,
	buildChooseRequest,
	candidatesOf,
	clip,
	compose,
	findSkill,
	findSkills,
	loadFindSkillPrompt,
	shortlist,
} from "./find-skill.ts";

const prompt = loadFindSkillPrompt("v1");

function entry(kind: CatalogEntry["kind"], name: string, extra: Partial<CatalogEntry> = {}): CatalogEntry {
	return {
		kind,
		name,
		path: `/x/${name}`,
		scope: "global",
		description: `${name} description`,
		skills: [],
		paths: [],
		...(kind === "rule" ? { body: `# ${name}\n- body` } : {}),
		...extra,
	};
}

const catalog: CatalogEntry[] = [
	entry("skill", "build-frontend"),
	entry("skill", "browse-site"),
	entry("rule", "svelte-effects", { skills: ["build-frontend"] }),
	entry("rule", "pi-print"),
	...Array.from({ length: 12 }, (_, i) => entry("skill", `filler-${i}`)),
];

function bool(probability: number): ClassifierAnswer {
	return { type: "bool", probability };
}

function choice(probabilities: Record<string, number>): ClassifierAnswer {
	const [top] = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
	return { type: "choice", choice: top?.[0] ?? "none", probabilities, confidence: top?.[1] ?? 0 };
}

function decision(answers: Record<string, ClassifierAnswer>, status: Decision["status"] = "ok"): Decision {
	return {
		status,
		decisionId: "d",
		backend: "opencode/jev-test",
		calibrated: true,
		answers,
		latencyMs: 5,
		costUsd: 0,
		cached: false,
		skipped: status === "ok" ? [] : ["opencode/jev-test: error"],
	};
}

const temps: string[] = [];
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A reader over a throwaway home holding exactly `entries`. */
function reader(entries: readonly CatalogEntry[]): CatalogReader {
	const home = mkdtempSync(join(tmpdir(), "decision-find-skill-"));
	temps.push(home);
	for (const e of entries) {
		const front = [
			`description: ${e.description}`,
			...(e.skills.length ? [`skills: [${e.skills.join(", ")}]`] : []),
			...(e.paths.length ? ["paths:", ...e.paths.map((g) => `  - "${g}"`)] : []),
		];
		const file =
			e.kind === "skill"
				? join(home, ".agents/skills", e.name, "SKILL.md")
				: join(home, ".agents/rules-routed", `${e.name}.md`);
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(file, `---\n${front.join("\n")}\n---\n${e.body ?? ""}`);
	}
	return new CatalogReader(home);
}

describe("find_skill requests", () => {
	test("choose lists every candidate plus none, with clipped descriptions", () => {
		const long = entry("skill", "long", { description: `${"word ".repeat(200)}end` });
		const r = buildChooseRequest({ prompt: "fix it" }, [long, entry("rule", "r1")], prompt);
		const q = r.questions.pick;
		expect(q?.type).toBe("choice");
		const criteria = (q as { criteria: Record<string, string> }).criteria;
		expect(Object.keys(criteria)).toEqual(["none", "skill:long", "rule:r1"]);
		expect(criteria["skill:long"]?.length).toBeLessThan(prompt.limits.chooseDescriptionChars + 20);
		expect(criteria["rule:r1"]).toContain("standing rule");
	});

	test("apply asks one bool per candidate with the applicability wording", () => {
		const r = buildApplyRequest({ prompt: "fix it" }, [entry("skill", "a"), entry("rule", "b")], prompt);
		expect(Object.keys(r.questions)).toEqual(["c0", "c1"]);
		expect(r.questions.c0).toMatchObject({ type: "bool" });
		expect(r.questions.c0?.instructions).toContain("a description");
		expect(r.questions.c0?.instructions).toContain("a shared topic alone is not enough");
		expect(r.questions.c1?.instructions).toContain("standing rule");
	});

	test("loaded names are never candidates", () => {
		expect(candidatesOf(catalog, ["pi-print", "browse-site"]).map((e) => e.name)).not.toContain("pi-print");
		expect(candidatesOf(catalog, ["pi-print", "browse-site"])).toHaveLength(catalog.length - 2);
	});

	test("clip cuts at a word boundary", () => {
		expect(clip("short", 10)).toBe("short");
		expect(clip("alpha beta gamma delta", 14)).toBe("alpha beta…");
	});
});

describe("find_skill shortlist and compose", () => {
	test("shortlist drops candidates under the floor and reports none", () => {
		const pick = choice({ none: 0.2, "skill:build-frontend": 0.6, "rule:pi-print": 0.19, "skill:browse-site": 0.01 });
		const { picked, none } = shortlist(pick, catalog, prompt);
		expect(picked.map((c) => c.entry.name)).toEqual(["build-frontend", "pi-print"]);
		expect(none).toBe(0.2);
	});

	test("thresholds, caps, and rules pulled in by a selected skill", () => {
		const asked = [entry("skill", "build-frontend"), entry("skill", "browse-site"), entry("rule", "pi-print")];
		const r = compose(asked, { c0: bool(0.9), c1: bool(0.4), c2: bool(0.3) }, catalog, prompt);
		expect(r.skills.map((s) => s.name)).toEqual(["build-frontend"]);
		expect(r.rules.map((x) => [x.name, x.p, x.scope])).toEqual([["svelte-effects", 0.9, "global"]]);
		expect(r.rules[0]?.body).toBe("# svelte-effects\n- body");
		expect(r.notes).toEqual(["rule svelte-effects via skill build-frontend"]);
	});

	test("a directly selected rule keeps its own p over the link", () => {
		const asked = [entry("skill", "build-frontend"), entry("rule", "svelte-effects")];
		const r = compose(asked, { c0: bool(0.7), c1: bool(0.95) }, catalog, prompt);
		expect(r.rules).toHaveLength(1);
		expect(r.rules[0]?.p).toBe(0.95);
	});

	test("a linked rule that is already loaded is not returned", () => {
		const rest = candidatesOf(catalog, ["svelte-effects"]);
		const r = compose([entry("skill", "build-frontend")], { c0: bool(0.9) }, rest, prompt);
		expect(r.rules).toEqual([]);
	});
});

describe("findSkills", () => {
	const calls: DecideRequest[] = [];
	function engine(...replies: Decision[]) {
		calls.length = 0;
		return async (request: DecideRequest) => {
			calls.push(request);
			return replies[calls.length - 1] ?? decision({}, "unavailable");
		};
	}

	test("choose then apply: two calls, the shortlist is what gets asked", async () => {
		const run = engine(
			decision({ pick: choice({ none: 0.1, "skill:build-frontend": 0.5, "rule:svelte-effects": 0.4 }) }),
			decision({ c0: bool(0.9), c1: bool(0.8) }),
		);
		const r = await findSkills({ prompt: "$effect resets on a poll" }, run, prompt, reader(catalog));
		expect(calls).toHaveLength(2);
		expect(Object.keys(calls[1]?.questions ?? {})).toEqual(["c0", "c1"]);
		expect(r.status).toBe("routed");
		expect(r.candidates).toBe(catalog.length);
		expect(r.skills.map((s) => s.name)).toEqual(["build-frontend"]);
		expect(r.rules.map((x) => x.name)).toEqual(["svelte-effects"]);
		expect(r.rules[0]?.body).toContain("svelte-effects");
	});

	test("a confident none costs one call and selects nothing", async () => {
		const run = engine(decision({ pick: choice({ none: 0.97, "skill:build-frontend": 0.03 }) }));
		const r = await findSkills({ prompt: "what is the capital of France" }, run, prompt, reader(catalog));
		expect(calls).toHaveLength(1);
		expect(r).toMatchObject({ status: "routed", skills: [], rules: [] });
	});

	test("a small catalog skips the shortlist call", async () => {
		const small = catalog.slice(0, 4);
		const run = engine(decision({ c0: bool(0.1), c1: bool(0.1), c2: bool(0.88), c3: bool(0.1) }));
		const r = await findSkills({ prompt: "pi -p one-shot" }, run, prompt, reader(small));
		expect(calls).toHaveLength(1);
		expect(r.rules.map((x) => x.name)).toEqual(["pi-print"]);
	});

	test("a backend failure is unavailable with empty lists, at either step", async () => {
		const first = await findSkills(
			{ prompt: "fix the svelte effect" },
			engine(decision({}, "unavailable")),
			prompt,
			reader(catalog),
		);
		expect(first).toMatchObject({ status: "unavailable", skills: [], rules: [] });
		expect(first.notes).toEqual(["opencode/jev-test: error"]);
		const second = await findSkills(
			{ prompt: "fix the svelte effect" },
			engine(decision({ pick: choice({ "skill:build-frontend": 0.9 }) }), decision({}, "unavailable")),
			prompt,
			reader(catalog),
		);
		expect(second).toMatchObject({ status: "unavailable", skills: [], rules: [], candidates: catalog.length });
	});

	test("skips share model_route's skip rules and an empty catalog", async () => {
		const run = engine();
		expect((await findSkills({ prompt: "/model" }, run, prompt, reader(catalog))).reason).toBe("slash command");
		expect((await findSkills({ prompt: "고마워" }, run, prompt, reader(catalog))).reason).toBe("acknowledgement");
		const empty = await findSkills({ prompt: "write a parser" }, run, prompt, reader([]));
		expect(empty).toMatchObject({ status: "skipped", reason: "no candidates" });
		expect(calls).toHaveLength(0);
	});
});

describe("findSkills scriptFirst", () => {
	const v3 = loadFindSkillPrompt("v3");
	const pathCatalog: CatalogEntry[] = [
		...catalog,
		entry("skill", "write-doc", { paths: ["docs/**/*.md"] }),
		entry("rule", "docs-archive", { paths: ["docs/**/*.md"] }),
	];
	const calls: DecideRequest[] = [];
	function engine(...replies: Decision[]) {
		calls.length = 0;
		return async (request: DecideRequest) => {
			calls.push(request);
			return replies[calls.length - 1] ?? decision({}, "unavailable");
		};
	}

	test("a named path selects the rule and puts the skill in the asked set past the shortlist", async () => {
		const run = engine(
			decision({ pick: choice({ none: 0.2, "skill:build-frontend": 0.6 }) }),
			decision({ c0: bool(0.1), c1: bool(0.7) }),
		);
		const r = await findSkills(
			{ prompt: "docs/plan에 새 계획 문서를 써줘", cwd: "/repo" },
			run,
			v3,
			reader(pathCatalog),
		);
		const choose = (calls[0]?.questions.pick as { criteria: Record<string, string> }).criteria;
		expect(Object.keys(choose)).not.toContain("rule:docs-archive");
		expect(Object.keys(calls[1]?.questions ?? {})).toEqual(["c0", "c1"]);
		expect(r.skills.map((s) => s.name)).toEqual(["write-doc"]);
		expect(r.rules).toMatchObject([{ name: "docs-archive", p: 1 }]);
		expect(r.notes).toContain("rule docs-archive via path docs/plan");
	});

	test("a confident none still asks a path-matched skill", async () => {
		const run = engine(decision({ pick: choice({ none: 0.97 }) }), decision({ c0: bool(0.2) }));
		const r = await findSkills({ prompt: "read docs/a.md", cwd: "/repo" }, run, v3, reader(pathCatalog));
		expect(calls).toHaveLength(2);
		expect(r).toMatchObject({ status: "routed", skills: [], rules: [{ name: "docs-archive" }] });
	});

	test("a touch report answers from globs alone, and survives a Jev outage", async () => {
		const run = engine();
		const touch = await findSkills(
			{ prompt: "", paths: ["/repo/docs/x/y.md"], cwd: "/repo" },
			run,
			v3,
			reader(pathCatalog),
		);
		expect(calls).toHaveLength(0);
		expect(touch).toMatchObject({ status: "routed", skills: [], rules: [{ name: "docs-archive" }] });
		const down = await findSkills({ prompt: "fix docs/x.md wording", cwd: "/repo" }, run, v3, reader(pathCatalog));
		expect(down).toMatchObject({ status: "routed", rules: [{ name: "docs-archive" }] });
	});

	test("v2 ignores paths", async () => {
		const v2 = loadFindSkillPrompt("v2");
		const run = engine(decision({ pick: choice({ none: 0.97 }) }));
		const r = await findSkills({ prompt: "read docs/a.md", cwd: "/repo" }, run, v2, reader(pathCatalog));
		expect(r.rules).toEqual([]);
		expect(calls).toHaveLength(1);
	});
});

describe("find_skill parse and score", () => {
	const runtime = findSkill.load("v1");

	test("body validation", () => {
		expect(runtime.parse({})).toBe("prompt is required");
		expect(runtime.parse({ prompt: "x", loaded: [1] })).toBe("loaded must be an array of strings");
		expect(runtime.parse({ prompt: "x", loaded: ["a"], cwd: "/w" })).toMatchObject({ loaded: ["a"], cwd: "/w" });
	});

	test("score is over skills and rules together", () => {
		const base = { status: "routed" as const, reason: "", notes: [] };
		const got = {
			...base,
			skills: [{ name: "a" }, { name: "x" }],
			rules: [{ name: "r" }],
		};
		expect(findSkill.score({ skills: ["a"], rules: ["r"] }, got)).toEqual({
			answered: 1,
			exact: 0,
			recall: 1,
			precision: 2 / 3,
		});
		expect(findSkill.score({ skills: [], rules: [] }, { ...base, skills: [], rules: [] })).toEqual({
			answered: 1,
			exact: 1,
			recall: 1,
			precision: 1,
			quiet: 1,
		});
		expect(findSkill.score({ skills: ["a"], rules: [] }, { ...base, status: "unavailable" })).toMatchObject({
			answered: 0,
			recall: 0,
		});
	});
});
