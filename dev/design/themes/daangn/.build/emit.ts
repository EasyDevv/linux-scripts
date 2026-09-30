// Build themes/daangn/layout.css from spec.json + chrome.css.
//
//   bun themes/daangn/.build/emit.ts
//
// Why not the dashboard's emit-layout-css.ts: that tool only replaces tokens
// that already exist in each _core block, so it cannot put the adaptive palette
// into `.dark`, and its marker regex throws. This emitter merges instead:
//   - shadcn tokens in :root / .dark are replaced in place
//   - spec keys that are not shadcn tokens land in that block's "Project primitives"
//     (a _core primitive with the same name is overridden, not duplicated)
//   - projectUtilities merge into @theme inline "Project utilities"
//   - spec.comments[section][firstToken] becomes a comment line above that group
//   - chrome.css (primitive [data-slot] chrome) is appended last
import { resolve } from "node:path";

type Scope = Record<string, string>;
type Spec = {
	liveUrl: string;
	imports: string[];
	root: Scope;
	dark: Scope;
	projectPrimitives: Scope;
	projectUtilities: Scope;
	/** section -> first token of a group -> comment line emitted above it */
	comments?: Record<string, Record<string, string>>;
};

const here = import.meta.dir;
const theme = resolve(here, "..");
const core = resolve(theme, "../_core/layout.css");
const spec = (await Bun.file(resolve(theme, "spec.json")).json()) as Spec;
const chrome = `${await Bun.file(resolve(here, "base.css")).text()}\n${await Bun.file(resolve(here, "chrome.css")).text()}`;
let css = await Bun.file(core).text();

const PRIMITIVES = "\t/* Project primitives */";
const UTILITIES = "\t/* Project utilities */";

function block(text: string, selector: RegExp) {
	const m = text.match(selector);
	if (!m || m.index === undefined) throw new Error(`no block ${selector}`);
	const open = text.indexOf("{", m.index);
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === "{") depth++;
		if (text[i] === "}" && --depth === 0) return { open, close: i };
	}
	throw new Error(`unclosed ${selector}`);
}

function lines(tokens: Scope, section: string) {
	const notes = spec.comments?.[section] ?? {};
	return Object.entries(tokens).flatMap(([k, v]) => (notes[k] ? [`\n\t/* ${notes[k]} */`, `\t${k}: ${v};`] : [`\t${k}: ${v};`]));
}

/** Split a block body at its marker; the tail after the marker holds that section's declarations. */
function mergeSection(body: string, marker: string, extra: Scope, section: string) {
	const at = body.indexOf(marker);
	const head = at >= 0 ? body.slice(0, at) : body.replace(/\s+$/, "\n");
	const tail = at >= 0 ? body.slice(at + marker.length) : "";
	const kept = [...tail.matchAll(/\t(--[\w-]+):\s*([^;]+);/g)]
		.filter(([, name]) => !(name in extra))
		.map(([, name, value]) => `\t${name}: ${value.replace(/\s+/g, " ").trim()};`);
	const body2 = [...kept, ...lines(extra, section)].join("\n");
	return `${head}${marker}\n${body2}\n`;
}

function applyScope(selector: RegExp, section: string, tokens: Scope, primitives: Scope = {}) {
	const { open, close } = block(css, selector);
	let body = css.slice(open + 1, close);
	const extra: Scope = { ...primitives };
	for (const [name, value] of Object.entries(tokens)) {
		const re = new RegExp(`(\\t${name}:)([\\s\\S]*?);`);
		const head = body.slice(0, body.indexOf(PRIMITIVES) >= 0 ? body.indexOf(PRIMITIVES) : body.length);
		if (re.test(head)) body = body.replace(re, `$1 ${value};`);
		else extra[name] = value;
	}
	body = mergeSection(body, PRIMITIVES, extra, section === "root" ? "projectPrimitives" : section);
	css = `${css.slice(0, open + 1)}${body}${css.slice(close)}`;
}

css = css.replace(/^@import "tailwindcss";\n@import "tw-animate-css";\n@import "shadcn-svelte\/tailwind.css";\n@import "@fontsource-variable\/inter";\n/m, `${spec.imports.join("\n")}\n`);
applyScope(/:root\s*\{/, "root", spec.root, spec.projectPrimitives);
applyScope(/\.dark\s*\{/, "dark", spec.dark);

{
	const { open, close } = block(css, /@theme\s+inline\s*\{/);
	const body = mergeSection(css.slice(open + 1, close), UTILITIES, spec.projectUtilities, "projectUtilities");
	css = `${css.slice(0, open + 1)}${body}${css.slice(close)}`;
}

css = css.replace(/^\/\* Token scheme core\.[^\n]*\n/, "");
const banner = `/* Generated from SEED Design rootage tokens (${spec.liveUrl}) by .build/extract.ts → spec.json → .build/emit.ts (+ .build/chrome.css); edit those, not this file. Copy over a shadcn-svelte layout.css; keep the project's @import lines if they already exist. */\n`;
await Bun.write(resolve(theme, "layout.css"), `${banner}${css.trimEnd()}\n\n${chrome.trim()}\n`);
console.log(resolve(theme, "layout.css"));
