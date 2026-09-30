// Regenerate the SEED recipe CSS inside every components/*.svelte snippet.
//
//   bun themes/daangn/.build/recipes.ts            # rewrite all snippets
//   bun themes/daangn/.build/recipes.ts --print action-button   # print one recipe
//
// A snippet opts in with a marker block in its <style>:
//   /* @recipe action-button, progress-circle */
//   …generated…
//   /* @end recipe */
// Source: ~/.ref/seed-design/packages/css/recipes/<name>.css (Apache-2.0, SEED Design).
// The rules are SEED's own; only three things change:
//   1. foundation vars are renamed to this theme's tokens (--seed-color-fg-neutral → --fg-neutral,
//      --seed-dimension-x2_5 → --dimension-x2-5, --seed-font-size-t4 → --text-t4 …);
//      component-internal --seed-* vars (box, menu, wheel-picker …) are kept verbatim
//   2. variant classes become data attributes on the same element
//      (.seed-chip--size_medium-layout_withText → .seed-chip[data-size="medium"][data-layout="withText"])
//   3. every selector is wrapped in :global() so Svelte neither scopes nor prunes it
// base.css keyframes are referenced with a seed- prefix (layout.css defines them).
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const recipesDir = resolve(homedir(), ".ref/seed-design/packages/css/recipes");
const theme = resolve(import.meta.dir, "..");
const layout = await Bun.file(join(theme, "layout.css")).text();
const declared = new Set([...layout.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const missing = new Map<string, Set<string>>();

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const dash = (s: string) => s.replace(/_/g, "-");

/** Foundation var → theme token; component-internal vars pass through. */
function mapVar(v: string, recipe: string): string {
	let m: RegExpMatchArray | null;
	let out: string | null = null;
	if ((m = v.match(/^--seed-color-palette-(.+)$/))) out = `--palette-${m[1]}`;
	else if ((m = v.match(/^--seed-color-((?:fg|bg|stroke|manner-temp|banner)-.+)$/))) out = `--${m[1]}`;
	else if ((m = v.match(/^--seed-dimension-spacing-[xy]-(.+)$/))) out = `--spacing-${m[1]}`;
	else if ((m = v.match(/^--seed-dimension-(x.+)$/))) out = `--dimension-${dash(m[1])}`;
	else if ((m = v.match(/^--seed-font-size-(t\d+)(-static)?$/))) out = `--text-${m[1]}${m[2] ?? ""}`;
	else if ((m = v.match(/^--seed-line-height-(t\d+)(-static)?$/))) out = `--text-${m[1]}${m[2] ?? ""}--line-height`;
	else if ((m = v.match(/^--seed-font-weight-(regular|medium|bold)$/))) out = `--font-weight-${m[1]}`;
	else if ((m = v.match(/^--seed-radius-(.+)$/))) out = `--radius-${dash(m[1])}`;
	else if ((m = v.match(/^--seed-duration-(.+)$/))) out = `--duration-${m[1]}`;
	else if ((m = v.match(/^--seed-timing-function-(.+)$/))) out = `--ease-${m[1]}`;
	else if ((m = v.match(/^--seed-(scale-s\d+|shadow-s\d+|gradient-.+|safe-area-.+|feedback-scale(?:-transition)?|(?:font-size|line-height)-limit-(?:min|max))$/))) out = `--${m[1]}`;
	if (!out) return v;
	if (!declared.has(out)) {
		if (!missing.has(recipe)) missing.set(recipe, new Set());
		missing.get(recipe)?.add(`${v} → ${out}`);
	}
	return out;
}

const KEYFRAMES = /\b(rotate|slide-x|progress-circle-head|progress-circle-tail|fade-in|fade-out|drawer-slide-from-bottom|drawer-slide-to-bottom)\b/g;

function value(text: string, recipe: string) {
	let out = text.replace(/var\((--seed-[\w-]+)/g, (_, v) => `var(${mapVar(v, recipe)}`);
	if (/animation(-name)?\s*:/.test(out)) out = out.replace(KEYFRAMES, "seed-$1");
	return out;
}

/** `.seed-x__slot--size_medium-layout_withText` → `.seed-x__slot[data-size="medium"][data-layout="withText"]` */
function variantSelector(sel: string) {
	return sel.replace(/\.(seed-[a-z0-9-]+?(?:__[a-zA-Z0-9-]+?)?)--([A-Za-z0-9_-]+)/g, (_, base: string, mods: string) => {
		const attrs = mods
			.split(/-(?=[a-zA-Z]+_)/)
			.map((pair) => {
				const i = pair.indexOf("_");
				return `[data-${kebab(pair.slice(0, i))}="${pair.slice(i + 1)}"]`;
			})
			.join("");
		return `.${base}${attrs}`;
	});
}

/** Split declarations on `;` outside quotes and parentheses (data: URLs contain `;utf8`). */
function splitDecls(body: string) {
	const out: string[] = [];
	let depth = 0;
	let quote = "";
	let cur = "";
	for (const ch of body) {
		if (quote) {
			if (ch === quote) quote = "";
		} else if (ch === "'" || ch === '"') quote = ch;
		else if (ch === "(") depth++;
		else if (ch === ")") depth--;
		else if (ch === ";" && depth === 0) {
			out.push(cur);
			cur = "";
			continue;
		}
		cur += ch;
	}
	out.push(cur);
	return out;
}

/** Split a selector list on top-level commas. */
function splitList(list: string) {
	const out: string[] = [];
	let depth = 0;
	let cur = "";
	for (const ch of list) {
		if (ch === "(") depth++;
		if (ch === ")") depth--;
		if (ch === "," && depth === 0) {
			out.push(cur.trim());
			cur = "";
		} else cur += ch;
	}
	if (cur.trim()) out.push(cur.trim());
	return out;
}

let wrapGlobal = true;
const selector = (list: string) =>
	splitList(list.replace(/\s+/g, " "))
		.map((s) => (wrapGlobal ? `:global(${variantSelector(s)})` : variantSelector(s)))
		.join(",\n");

/** Walk the stylesheet: style rules get new selectors + mapped values; at-rules recurse. */
function transform(css: string, recipe: string, indent = "\t"): string {
	css = css.replace(/\/\*[\s\S]*?\*\//g, "");
	let out = "";
	let i = 0;
	while (i < css.length) {
		const open = css.indexOf("{", i);
		if (open < 0) break;
		const prelude = css.slice(i, open).trim();
		let depth = 1;
		let j = open + 1;
		while (depth && j < css.length) {
			if (css[j] === "{") depth++;
			else if (css[j] === "}") depth--;
			j++;
		}
		const body = css.slice(open + 1, j - 1);
		if (prelude.startsWith("@keyframes")) {
			const name = prelude.replace(/^@keyframes\s+/, "");
			const kept = body.replace(/var\((--seed-[\w-]+)/g, (_, v) => `var(${mapVar(v, recipe)}`);
			out += `${indent}@keyframes ${name.startsWith("seed-") ? name : `seed-${name}`} {${kept}}\n`;
		} else if (prelude.startsWith("@")) {
			out += `${indent}${prelude} {\n${transform(body, recipe, `${indent}\t`)}${indent}}\n`;
		} else {
			const decls = splitDecls(body)
				.map((d) => d.trim())
				.filter(Boolean)
				.map((d) => d.replace(/\s+/g, " ").replace(/^(--seed-[\w-]+)(?=\s*:)/, (v) => mapVar(v, recipe)))
				.map((d) => `${indent}\t${value(d, recipe)};`)
				.join("\n");
			const sel = selector(prelude)
				.split("\n")
				.map((s) => `${indent}${s}`)
				.join("\n");
			out += `${sel} {\n${decls}\n${indent}}\n`;
		}
		i = j;
	}
	return out;
}

export async function recipeCss(names: string[]) {
	const parts: string[] = [];
	for (const name of names) {
		const css = await Bun.file(join(recipesDir, `${name}.css`)).text();
		parts.push(`\t/* SEED recipe: ${name} */\n${transform(css, name)}`);
	}
	return parts.join("\n");
}

const MARK = /(\t*)\/\* @recipe ([^*]+?) \*\/[\s\S]*?\/\* @end recipe \*\//g;

if (import.meta.main) {
	const print = process.argv.indexOf("--print");
	if (process.argv.includes("--base")) {
		// base.css shared primitives: everything except the token blocks (:root, colour modes, platform).
		wrapGlobal = false;
		const base = await Bun.file(join(recipesDir, "../base.css")).text();
		const keep = base
			.split(/\n(?=[^\s}])/)
			.filter((block) => /^(\.seed-|@keyframes|@media \(min-width|@media \(prefers-reduced-motion)/.test(block))
			.filter((block) => !/^@media \(prefers-reduced-motion[^{]*\{\s*:root/.test(block))
			.join("\n");
		const css = transform(keep, "base", "");
		await Bun.write(join(import.meta.dir, "base.css"), `/* SEED base.css shared primitives (icon slots, loading indicator, count, box, grid, consistent width,
   scale feedback, keyframes). Generated by .build/recipes.ts --base; do not edit. */\n${css}`);
		console.log(join(import.meta.dir, "base.css"));
	} else if (print > 0) {
		console.log(await recipeCss(process.argv[print + 1].split(",")));
	} else {
		const dir = join(theme, "components");
		for (const file of readdirSync(dir).filter((f) => f.endsWith(".svelte"))) {
			const path = join(dir, file);
			const text = await Bun.file(path).text();
			const blocks = [...text.matchAll(MARK)];
			if (!blocks.length) continue;
			let next = text;
			for (const [whole, , names] of blocks) {
				const list = names.split(",").map((n) => n.trim());
				next = next.replace(whole, `\t/* @recipe ${list.join(", ")} */\n${await recipeCss(list)}\t/* @end recipe */`);
			}
			if (next !== text) await Bun.write(path, next);
			console.log(`${file}: ${blocks.map((b) => b[2].trim()).join(" | ")}`);
		}
	}
	for (const [recipe, vars] of missing) console.error(`unmapped in ${recipe}: ${[...vars].join(", ")}`);
	if (missing.size) process.exitCode = 1;
}
