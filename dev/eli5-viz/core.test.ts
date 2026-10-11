import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_ICONS, buildSpecPage, inline } from "./inline.ts";

const req = createRequire(import.meta.url);
const E = req("./core/runtime.js");
const B = req("./examples/big-o/widgets.js");
const SRC = join(import.meta.dir, "examples/big-o/page.src.html");
const GATE = join(process.env.HOME ?? "", ".claude/skills/generate-eli5-html/scripts/check-static.ts");
const build = () => {
	const dir = mkdtempSync(join(tmpdir(), "eli5-"));
	const out = join(dir, "big-o.html");
	writeFileSync(out, inline(readFileSync(SRC, "utf8"), join(import.meta.dir, "examples/big-o")));
	return out;
};

test("core: shared store clamps to its configured range and notifies once per change", () => {
	E.store.config({ n: 5, min: 1, max: 1000, log: true });
	let calls = 0;
	E.store.sub(() => calls++);
	const base = calls;
	E.store.set(5e6);
	expect(E.store.n).toBe(1000);
	E.store.set(1000);
	expect(calls).toBe(base + 1);
	E.store.set(0);
	expect(E.store.n).toBe(1);
	for (const n of [1, 10, 100, 1000]) expect(E.fromPos(E.toPos(n))).toBe(n);
});

test("core: fmtFit keeps digits while they fit and switches to the page language's compact form", () => {
	expect(E.fmtFit(1_000_000, 9, "ko")).toBe("1,000,000");
	expect(E.fmtFit(1e12, 9, "ko")).toBe("1조");
	expect(E.fmtFit(1e12, 9, "en")).toBe("1T");
	expect(E.fmtFit(1e12, 17, "en")).toBe("1,000,000,000,000");
});

test("example math: counts match the source page", () => {
	expect([10, 100, 1000].map((n) => B.steps("log", n))).toEqual([4, 7, 10]);
	expect(B.steps("n2", 100)).toBe(10000);
	expect(B.steps("o1", 1e6)).toBe(1);
	expect([10, 100, 1000, 1e6].map((n) => B.halving(n).length - 1)).toEqual([4, 7, 10, 20]);
	for (let n = 1; n <= 2048; n++) {
		const gap = B.steps("log", n) - (B.halving(n).length - 1);
		expect(gap >= 0 && gap <= 1).toBe(true);
		const t = n - 1;
		expect(B.trace("log", n, t).length).toBeLessThanOrEqual(B.steps("log", n));
		expect(B.trace("log", n, t).at(-1).at).toBe(t);
	}
	expect(B.fmtRatio(1000)).toBe("×1,000");
});

test("inline: one file, no placeholders, only the allowed CDN, only the icons in use", () => {
	const html = readFileSync(build(), "utf8");
	expect(html).not.toContain('data-ic="');
	expect(html).toContain("<style data-eli5-theme>");
	expect(html).toContain("<script data-eli5-core>");
	expect(html.trim().endsWith("</html>")).toBe(true);
	expect(html.indexOf("ELI5.mount();")).toBeGreaterThan(html.indexOf('id="eli5-data"'));
	const srcs = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map((m) => m[1]);
	expect(srcs).toEqual(["https://cdn.tailwindcss.com"]);
	const data = JSON.parse(html.match(/<script type="application\/json" id="eli5-data">([\s\S]*?)<\/script>/)![1]!);
	for (const n of [...CORE_ICONS, "scissors", "grid-3x3", "warehouse"]) expect(Object.keys(data.icons)).toContain(n);
	expect(Object.keys(data.icons).length).toBeLessThan(60);
});

test("inline: an unknown icon name fails loudly instead of rendering blank", () => {
	expect(() => inline('<html><head></head><body><i data-ic="no-such-icon"></i></body></html>', import.meta.dir)).toThrow(/unknown Lucide icon/);
});

test("example data: every quiz answer exists and every data-q has a quiz", () => {
	const src = readFileSync(SRC, "utf8");
	const data = JSON.parse(src.match(/id="eli5-data">([\s\S]*?)<\/script>/)![1]!);
	for (const q of Object.values<{ options: string[]; answer: number; why: string }>(data.quiz)) {
		expect(q.answer).toBeLessThan(q.options.length);
		expect(q.why.length).toBeGreaterThan(10);
	}
	for (const m of src.matchAll(/data-q="([^"]+)"/g)) expect(data.quiz[m[1]!]).toBeDefined();
});

test("3D example: kit inlined only on [data-3d] pages, canvas draws, all gates pass", () => {
	const dir = mkdtempSync(join(tmpdir(), "eli5-3d-"));
	const out = join(dir, "big-o-3d.html");
	writeFileSync(out, inline(readFileSync(join(import.meta.dir, "examples/big-o-3d/page.src.html"), "utf8"), join(import.meta.dir, "examples/big-o-3d")));
	expect(readFileSync(out, "utf8")).toContain("<script data-eli5-3d>");
	expect(readFileSync(build(), "utf8")).not.toContain("<script data-eli5-3d>");
	for (const [cmd, args] of [[GATE, [out]], [join(import.meta.dir, "probe.ts"), [out, "--smoke"]], [join(import.meta.dir, "check-layout.ts"), [out]]] as const) {
		const r = spawnSync("bun", [cmd, ...args], { encoding: "utf8" });
		expect(r.stderr + r.stdout).not.toContain("fail:");
		expect(r.status).toBe(0);
	}
}, 120_000);

test("gates: the built example passes check-static and check-layout", () => {
	const out = build();
	const st = spawnSync("bun", [GATE, out], { encoding: "utf8" });
	expect(st.stderr).not.toContain("fail:");
	expect(st.status).toBe(0);
	const lay = spawnSync("bun", [join(import.meta.dir, "check-layout.ts"), out], { encoding: "utf8" });
	expect(lay.stderr).not.toContain("fail:");
	expect(lay.status).toBe(0);
}, 60_000);

// every gate must also FAIL on the bug class it exists for (a gate that never fails proves nothing)
const broken = (fix: (html: string) => string) => {
	const out = build();
	const p = out.replace(/\.html$/, "-broken.html");
	writeFileSync(p, fix(readFileSync(out, "utf8")));
	return p;
};
const run = (script: string, file: string) => spawnSync("bun", [script, file], { encoding: "utf8" });
const LAYOUT = join(import.meta.dir, "check-layout.ts");

test("check-static fails: dead bridge, unknown widget, unclosed div, em dash", () => {
	const cases: [string, (h: string) => string, RegExp][] = [
		["dead bridge", (h) => h.replace('href="#step-3"', 'href="#step-9"'), /bridge points to missing #step-9/],
		["unknown widget", (h) => h.replace('data-w="halve"', 'data-w="nosuch"'), /data-w="nosuch" has no widget/],
		["unclosed div", (h) => h.replace('<div id="nbar"', '<div><div id="nbar"'), /<div> opened/],
		["em dash", (h) => h.replace("하루의 방이 창고가 된 날", "하루의 방 — 창고"), /em dash/],
	];
	for (const [, fix, want] of cases) {
		const r = run(GATE, broken(fix));
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(want);
	}
});

test("check-layout fails: appended text (round trip) and a resizing slider readout (drag)", () => {
	const accum = run(LAYOUT, broken((h) => h.replace('r.count.replaceChildren(h("span"', 'r.count.append(h("span"')));
	expect(accum.status).toBe(1);
	expect(accum.stderr).toMatch(/round trip/);
	const drag = run(LAYOUT, broken((h) => h.replace("reserve(out, [() => (out.textContent = widest)", "void ([() => (out.textContent = widest)")));
	expect(drag.status).toBe(1);
	expect(drag.stderr).toMatch(/drag n=/);
}, 120_000);

test("probe: smoke passes on the example and reports page errors", () => {
	const ok = spawnSync("bun", [join(import.meta.dir, "probe.ts"), build(), "--smoke"], { encoding: "utf8" });
	expect(ok.status).toBe(0);
	const bad = spawnSync("bun", [join(import.meta.dir, "probe.ts"), broken((h) => h.replace("ELI5.mount();", "ELI5.mount(); null.x;")), "--smoke"], { encoding: "utf8" });
	expect(bad.status).toBe(1);
	expect(bad.stdout).toMatch(/errors/);
}, 60_000);

test("anti-slop: copy tells warn, accent overuse fails the smoke run", () => {
	const copy = run(GATE, broken((h) => h.replace("하루의 방이 창고가 된 날", "하루의 방이 창고가 된 날. 문이 열렸다. 불이 꺼졌다. 숨이 멎었다.").replace("<h2 ", "<p>Big-O는 시계가 아니라 모양이다.</p><h2 ")));
	expect(copy.stderr).toMatch(/negative parallelism/);
	expect(copy.stderr).toMatch(/staccato run/);
	const accent = spawnSync("bun", [join(import.meta.dir, "probe.ts"), broken((h) => h.replace("</head>", "<style>main p{color:var(--accent)!important}</style></head>")), "--smoke"], { encoding: "utf8" });
	expect(accent.status).toBe(1);
	expect(accent.stdout).toMatch(/accent on \d+ text elements/);
}, 60_000);

test("core math: barPct floors tiny values on shared tracks", () => {
	expect(E.barPct(800000, 800000, true)).toBe(100);
	expect(E.barPct(16000, 800000, true)).toBeCloseTo(71.2, 0);
	expect(E.barPct(500, 1000, false)).toBe(50);
	expect(E.barPct(0, 100, false)).toBe(2);
	expect(E.barPct(5, 0, false)).toBe(2);
});

const COREW_SRC = `<!doctype html>
<html lang="ko" data-theme="dark">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>T</title><script src="https://cdn.tailwindcss.com"></script></head>
<body><main class="mx-auto max-w-[50rem] space-y-16 px-4 pb-24 pt-14 sm:px-6">
<header><div class="flex items-center justify-between gap-4"><p class="ui-eyebrow">종류 · 주제</p><button type="button" data-theme-toggle class="ui-ctl ui-ink-2" aria-label="전환"><i data-ic="sun" class="h-4 w-4 show-dark"></i><i data-ic="moon" class="h-4 w-4 show-light"></i></button></div>
<h1 id="title" class="mt-4 text-[2rem] leading-[1.25]">주인공의 하루</h1>
<p class="ui-prose mt-4">이 글이 약속하는 내용을 한두 문장으로 정리해서 적는다.</p>
<p class="ui-scene mt-4">주인공은 평소 모습 그대로 살아가다가 큰 변화를 맞는다.</p></header>
<section id="predict" class="ui-card p-4" data-w="quiz" data-q="predict" data-title="읽기 전"></section>
<section id="hero" class="ui-card p-4"><h3 class="mb-3 text-sm font-medium">이 그림이 답하는 질문을 여기에 적는다?</h3><div data-w="bars" data-ids="a,b" data-log data-note="로그 눈금이다."></div><dl data-w="facts"></dl><div data-w="flow" data-steps="첫째;둘째" data-result="결과"></div><div data-w="cards"></div></section>
<section id="steps" class="pt-4"><article id="step-1" class="ui-chapter scroll-mt-28 p-4">
<div class="ui-chapter-head"><span class="ui-step-ic"><i data-ic="box" class="h-6 w-6"></i></span><div class="min-w-0"><p class="text-xs ui-ink-3">이 장에서 다루는 주제를 짧게 소개한다.</p><h2 class="mt-0.5 text-[1.4rem]">1장 · 제목</h2></div></div>
<p class="ui-scene mt-4">주인공이 지금 어디에 있는지 한 문장으로 소개한다.</p><p class="mt-4" data-w="say" data-say="step-1"></p><div class="ui-quiz mt-4 p-4" data-w="quiz" data-q="step-1"></div>
<div class="ui-chapter-foot mt-5 pt-4"><p class="text-xs ui-ink-3">얻는 것을 세 가지 나열해서 적는다.</p>
<a class="ui-next" href="#takeaway"><span>다다음 장이 열리는 까닭을 쓴다.</span></a></div></article></section>
<section id="takeaway" class="ui-card p-6"><p class="ui-scene">처음 장소로 돌아온 주인공이 바른 질문을 던진다.</p>
<h2 class="mt-6 text-[1.75rem]">한 줄 주장을 여기에 분명하게 적는다.</h2></section>
<footer class="border-t ui-line pt-6 text-sm ui-ink-3"><p>출처 문서를 적는다.</p></footer></main>
<script type="application/json" id="eli5-data">{"store":{"n":1,"min":1,"max":100,"log":false,"places":[{"upTo":100,"label":"여기","icon":"box"}]},"ui":{"storeLabel":"n","tone":{"pass":"통과","go":"진행","stop":"정지"},"quizTitle":"확인 문제","quizRight":"맞았다","quizWrong":"다시 보자","quizRetry":"다시 풀기","toneHelp":{"pass":"통과","go":"진행","stop":"정지"}},"bars":{"a":{"icon":"box","label":"에이","term":"100","value":100,"story":"이야기","tone":"pass"},"b":{"icon":"globe","label":"비","term":"10","value":10,"story":"이야기","tone":"go"}},"facts":[{"icon":"globe","term":"용어","desc":"설명"}],"cast":[{"icon":"landmark","term":"TERM","label":"이름","story":"이야기","stat":"1","tone":"pass"}],"quiz":{"predict":{"q":"가장 놀라운 출처 숫자로 질문을 만든다.","options":["첫 번째 선택지","두 번째 선택지"],"answer":1,"why":"출처 숫자를 들어서 정답인 까닭을 설명한다."},"step-1":{"q":"이 장의 핵심을 묻는 확인 질문이다.","options":["첫 번째 선택지","두 번째 선택지"],"answer":0,"why":"출처 숫자를 들어서 해결인 까닭을 설명한다."}},"say":{"step-1":{"by":"done","before":{"icon":"circle-question-mark","t":"문제를 풀기 전에 읽는 안내 문장이다."},"after":{"icon":"lightbulb","t":"문제를 푼 뒤에 읽는 해결 문장이다."}}},"lexicon":[{"t":"주인공","cls":"hl-t3"},{"t":"주장","cls":"hl-t1"}]}</script></body></html>`;

test("core widgets: bars/facts/flow/cards render and pass all gates", () => {
	const dir = mkdtempSync(join(tmpdir(), "eli5-corew-"));
	const src = join(dir, "page.src.html");
	const out = join(dir, "corew.html");
	writeFileSync(src, COREW_SRC);
	writeFileSync(out, inline(readFileSync(src, "utf8"), dir));
	const html = readFileSync(out, "utf8");
	for (const w of ["bars", "facts", "flow", "cards"]) expect(html).toContain(`data-w="${w}"`);
	expect(html).toContain("hl-t1");
	for (const [cmd, args] of [[GATE, [out]], [join(import.meta.dir, "probe.ts"), [out, "--smoke"]], [join(import.meta.dir, "check-layout.ts"), [out]]] as const) {
		const r = spawnSync("bun", [cmd, ...args], { encoding: "utf8" });
		expect(r.stderr + r.stdout).not.toContain("fail:");
		expect(r.status).toBe(0);
	}
}, 120_000);

// ---- page-spec parts (the shadcn-style composition layer) -------------------
import { parseSpec, specData, kindColors } from "./parts/spec.ts";
import { shell } from "./parts/shell.ts";
import { recapLabel } from "./parts/chapter.ts";

const STORY_SRC = join(import.meta.dir, "examples/story/page.src.html");

const specOf = (over: Record<string, unknown> = {}) => {
	const spec = JSON.parse(
		readFileSync(STORY_SRC, "utf8").match(/id="eli5-page">([\s\S]*?)<\/script>/i)![1]!,
	) as Record<string, unknown>;
	return { ...spec, ...over };
};

test("spec: parse validates the contract a chapter needs (quiz + say + body)", () => {
	const spec = specOf();
	expect(parseSpec(spec).chapters.length).toBe(5);
	// a chapter without its self-check entry fails here, not at the browser gate
	const noSay = specOf({ say: { "step-1": spec.say["step-1"] } });
	expect(() => parseSpec(noSay)).toThrow(/say\.step-2/);
	const noQuiz = specOf({ quiz: { predict: spec.quiz.predict } });
	expect(() => parseSpec(noQuiz)).toThrow(/quiz\.step-1/);
	// unknown icon, unknown block, missing template refs, hero without a question
	expect(() => parseSpec(specOf({ hero: { question: "질문이 아니다", tabs: spec.hero.tabs } }))).toThrow(/missing "\?"/);
	expect(() => parseSpec(specOf({ chapters: [{ ...spec.chapters[0], icon: "No Such Icon" }] }))).toThrow(/not a Lucide name/);
	expect(() => parseSpec(specOf({ hero: { blocks: [{ w: "nope" }] } }))).toThrow(/unknown block/);
	expect(() => parseSpec(specOf({ hero: { body: "ghost" } }))).not.toThrow(); // the template check is the builder's
	// kind colors derive from cast tones, no hand-written color block anywhere
	const kinds = kindColors(parseSpec(spec));
	expect(kinds).toEqual([
		{ id: "cash", tone: "pass" },
		{ id: "qqq", tone: "go" },
		{ id: "qld", tone: "go" },
		{ id: "tqqq", tone: "stop" },
	]);
});

test("spec: runtime slice carries everything the browser widgets read", () => {
	const data = specData(parseSpec(specOf()));
	for (const k of ["store", "ui", "quiz", "flip", "say", "lexicon", "cast"]) expect(Object.keys(data)).toContain(k);
	expect((data.ui as { tone: Record<string, string> }).tone.pass).toBe("통과");
});

test("parts: shell renders the shared skeleton from the spec alone", () => {
	const spec = parseSpec(specOf());
	const { head, main } = shell(spec, { "step-1": "<p>본문</p>", "step-2": "<p>본문</p>", "step-3": "<p>본문</p>", "step-5": "<p>본문</p>" });
	// ids the gates measure, one article per chapter, consecutive steps
	for (const need of ['id="title"', 'id="predict"', 'id="cast"', 'id="hero"', 'id="takeaway"'])
		expect(main).toContain(need);
	for (const n of [1, 2, 3, 4, 5]) expect(main).toContain(`id="step-${n}"`);
	// every chapter: scene, say hook, quiz hook, gains, a bridge that lands on a real id
	for (const n of [1, 2, 3, 4, 5]) {
		const card = main.slice(main.indexOf(`id="step-${n}"`), main.indexOf(n === 5 ? `id="takeaway"` : `id="step-${n + 1}"`));
		expect(card).toContain("ui-scene");
		expect(card).toContain(`data-w="say" data-say="step-${n}"`);
		expect(card).toContain(`data-w="quiz" data-q="step-${n}"`);
		expect(card).toMatch(/class="ui-next" href="#step-\d"|class="ui-next" href="#takeaway"/);
	}
	expect(main).toContain('<a class="ui-next" href="#takeaway">');
	// recap chips drop the "1장 · " prefix; the kind css is generated, never hand-written
	expect(main).toContain('<span>목표와 심판</span>');
	expect(main).not.toContain("<span>1장 · 목표와 심판</span>");
	expect(head).toContain(".k-cash { --k: var(--c-cash); }");
	expect(head).toContain("--c-tqqq: var(--stop)");
	// template bodies land inside their chapter; a missing one fails loudly
	expect(main).toContain("<p>본문</p>");
	expect(() => shell(parseSpec(specOf()), {})).toThrow(/no <template data-body="step-1">/);
	// no visible copy is hard-coded in a part: chapter numbers and terms come from the spec
	expect(main).toContain('<span class="font-mono">벤치마크 · 기각</span>');
	expect(main).not.toMatch(/<p class="text-xs ui-ink-3">\d/);
	expect(recapLabel({ icon: "box", title: "1장 · 목표와 심판", scene: "s" })).toBe("목표와 심판");
	expect(recapLabel({ icon: "box", title: "이름 없는 장", scene: "s" })).toBe("이름 없는 장");
	expect(recapLabel({ icon: "box", title: "1장 · 목표와 심판", scene: "s", recap: "요약" })).toBe("요약");
});

test("spec build: the story example builds and passes all three gates", () => {
	const dir = mkdtempSync(join(tmpdir(), "eli5-spec-"));
	const out = join(dir, "story.html");
	writeFileSync(out, inline(readFileSync(STORY_SRC, "utf8"), join(import.meta.dir, "examples/story")));
	const html = readFileSync(out, "utf8");
	expect(html).not.toContain("data-ic=");
	expect(html).toContain("<style data-eli5-kinds>");
	expect(html).toContain("<style data-eli5-theme>");
	expect(html).toContain("<script data-eli5-core>");
	// the runtime JSON is generated from the spec, icons included
	const data = JSON.parse(html.match(/<script type="application\/json" id="eli5-data">([\s\S]*?)<\/script>/)![1]!);
	expect(Object.keys(data.icons)).toContain("wallet");
	expect(Object.keys(data.icons)).toContain("list-checks");
	for (const [cmd, args] of [[GATE, [out]], [join(import.meta.dir, "probe.ts"), [out, "--smoke"]], [join(import.meta.dir, "check-layout.ts"), [out]]] as const) {
		const r = spawnSync("bun", [cmd, ...args], { encoding: "utf8" });
		expect(r.stderr + r.stdout).not.toContain("fail:");
		expect(r.status).toBe(0);
	}
}, 180_000);

test("spec build: a missing body template fails at build time with its name", () => {
	const src = readFileSync(STORY_SRC, "utf8").replace('<template data-body="step-3">', "<template>");
	expect(() => inline(src, join(import.meta.dir, "examples/story"))).toThrow(/step-3/);
	// legacy sources (no #eli5-page) skip the builder and build through the classic path unchanged
	const legacy = "<html><head></head><body><p>legacy</p></body></html>";
	expect(buildSpecPage(legacy)).toBe(legacy);
	expect(inline(legacy, import.meta.dir)).toContain("<p>legacy</p>");
	expect(inline(legacy, import.meta.dir)).toContain("<style data-eli5-theme>");
});
