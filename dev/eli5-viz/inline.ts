#!/usr/bin/env bun
/** Turn an ELI5 source page into the one standalone HTML file the reader opens.
 *  usage: bun inline.ts <page.src.html> [-o out.html]
 *
 *  The source page is plain HTML the author writes (see the skill's references/core-api.md):
 *    - <script type="application/json" id="eli5-data">  copy + quiz + store config for the runtime
 *    - <i data-ic="lucide-name" class="h-4 w-4" [aria-label]></i>  icon placeholders
 *    - <script data-eli5-page src="./widgets.js"></script>  optional document-specific widgets
 *  This script inlines core/theme.css, core/runtime.js, the page script, and only the Lucide icons the
 *  page uses (read from the bun cache; Lucide is ISC). Then it appends ELI5.mount(). */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, exit } from "node:process";
import { parseSpec, specData } from "./parts/spec.ts";
import { shell } from "./parts/shell.ts";

const here = import.meta.dir;
type IconNode = [string, Record<string, string>][];

/** Icons the core runtime draws itself; always shipped. */
export const CORE_ICONS = ["circle-check", "circle-arrow-right", "octagon-x", "triangle-alert", "circle-question-mark", "lightbulb", "check", "x", "repeat", "sliders-horizontal", "sun", "moon"];

let lucideDir = "";
const lucide = () => {
	if (lucideDir) return lucideDir;
	const cache = join(process.env.HOME ?? "", ".bun/install/cache");
	const pkg = existsSync(cache)
		? readdirSync(cache)
				.filter((d) => /^lucide-svelte@\d/.test(d))
				.sort((a, b) => Bun.semver.order(a.split("@")[1]!, b.split("@")[1]!))
				.at(-1)
		: undefined;
	if (!pkg) throw new Error("lucide-svelte not in the bun cache. Run once: bun add -g lucide-svelte");
	return (lucideDir = join(cache, pkg, "dist/icons"));
};
export function iconNode(name: string): IconNode {
	const file = join(lucide(), `${name}.svelte`);
	if (!existsSync(file)) throw new Error(`unknown Lucide icon "${name}" (see https://lucide.dev/icons)`);
	const m = readFileSync(file, "utf8").match(/const iconNode = (\[.*?\]);\n/s);
	if (!m) throw new Error(`no iconNode in ${name}`);
	return JSON.parse(m[1]!);
}
const svg = (node: IconNode, cls: string, label: string) =>
	`<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${node.map(([t, a]) => `<${t} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("")}</svg>`;

/** Every icon name the page can ask for: placeholders, data JSON "icon" fields, preset chips, icon("…") calls. */
export function iconNames(html: string, data: unknown, scripts: string): string[] {
	const names = new Set(CORE_ICONS);
	for (const m of html.matchAll(/data-ic="([a-z0-9-]+)"/g)) names.add(m[1]!);
	for (const m of html.matchAll(/data-presets="([^"]*)"/g)) for (const p of m[1]!.split(";")) { const ic = p.split("|")[2]; if (ic) names.add(ic); }
	for (const m of scripts.matchAll(/\bicon\(\s*["']([a-z0-9-]+)["']/g)) names.add(m[1]!);
	const walk = (v: unknown): void => {
		if (Array.isArray(v)) v.forEach(walk);
		else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (k === "icon" && typeof x === "string" ? names.add(x) : walk(x));
	};
	walk(data);
	return [...names].sort();
}

const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** Spec-path build: a page-spec source (one #eli5-page JSON + named <template data-body>
 *  fragments) becomes the full story-flow skeleton. Returns the source untouched when it has no
 *  #eli5-page script (the legacy hand-written source keeps working). */
export function buildSpecPage(src: string): string {
	const pm = src.match(/<script\s+type="application\/json"\s+id="eli5-page">([\s\S]*?)<\/script>/i);
	if (!pm) return src;
	let html = src.replace(pm[0], "");
	let spec;
	try {
		spec = parseSpec(JSON.parse(pm[1]!));
	} catch (e) {
		throw new Error(`#eli5-page ${(e as Error).message}`);
	}
	const bodies: Record<string, string> = {};
	// comments never hold markup the page needs; drop them before templates are collected
	html = html.replace(/<!--[\s\S]*?-->/g, "");
	html = html.replace(/<template\b[^>]*\bdata-body="([^"]+)"[^>]*>([\s\S]*?)<\/template>/g, (_m, id, inner) => {
		if (bodies[id]) throw new Error(`spec: duplicate <template data-body="${id}">`);
		bodies[id] = inner.trim();
		return "";
	});
	const { head, main } = shell(spec, bodies);

	// keep the author's page-widget scripts; everything else in the body is generated
	const pageScripts = [...html.matchAll(/<script\b[^>]*\bdata-eli5-page\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[0]);
	html = html.replace(/<html[^>]*>/i, `<html lang="${spec.lang}" data-theme="${spec.theme ?? "dark"}">`);
	if (/<title>[\s\S]*?<\/title>/i.test(html)) html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${spec.meta.title}</title>`);
	else html = html.replace(/<head([^>]*)>/i, `<head$1>\n    <title>${spec.meta.title}</title>`);
	html = html.replace("</head>", () => `    ${head}\n  </head>`);
	const dataTag = `<script type="application/json" id="eli5-data">${safeJson(specData(spec))}</script>`;
	html = html.replace(/<body[^>]*>[\s\S]*<\/body>/i, () => `<body>\n${main}\n    ${dataTag}\n${pageScripts.map((s) => "    " + s).join("\n")}\n  </body>`);
	return html;
}

export function inline(src: string, baseDir: string): string {
	let html = src;
	// 0. page-spec sources: one JSON lesson spec + <template data-body> fragments → full skeleton
	html = buildSpecPage(html);
	// 1. page scripts: <script data-eli5-page src="x.js"></script> → inline body
	html = html.replace(/<script\b([^>]*)\bdata-eli5-page\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/g, (_m, a, b, file, c) => {
		const code = readFileSync(resolve(baseDir, file), "utf8");
		return `<script${a}data-eli5-page${b}${c}>\n${code}\n</script>`;
	});
	const pageScripts = [...html.matchAll(/<script\b[^>]*data-eli5-page[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
	const runtime = readFileSync(join(here, "core/runtime.js"), "utf8");

	// 2. data JSON + the icons it needs
	const dm = html.match(/<script type="application\/json" id="eli5-data">([\s\S]*?)<\/script>/);
	const data = dm ? JSON.parse(dm[1]!) : {};
	const names = iconNames(html, data, pageScripts + "\n" + runtime);
	const nodes = Object.fromEntries(names.map((n) => [n, iconNode(n)]));
	data.icons = nodes;
	const dataTag = `<script type="application/json" id="eli5-data">${safeJson(data)}</script>`;
	html = dm ? html.replace(dm[0], () => dataTag) : html.replace("</body>", () => `${dataTag}\n</body>`);

	// 3. icon placeholders → inline svg (class and aria-label carried over)
	html = html.replace(/<i\s+([^>]*?)data-ic="([a-z0-9-]+)"([^>]*)><\/i>/g, (_m, a, name, b) => {
		const attrs = a + b;
		const cls = attrs.match(/class="([^"]*)"/)?.[1] ?? "h-4 w-4";
		const label = attrs.match(/aria-label="([^"]*)"/)?.[1] ?? "";
		return svg(nodes[name]!, cls, label);
	});

	// 4. theme before </head>; runtime before the first page script; mount after the last one
	const theme = readFileSync(join(here, "core/theme.css"), "utf8");
	html = html.replace("</head>", () => `    <style data-eli5-theme>\n${theme}\n    </style>\n  </head>`);
	// the 3D kit (three.js, ~0.5 MB) ships only to pages that ask for it with a [data-3d] element
	const kit3d = /\sdata-3d[\s=>]/.test(html) ? `\n<script data-eli5-3d>\n${readFileSync(join(here, "core/scene3d.js"), "utf8")}\n</script>` : "";
	const core = `<script data-eli5-core>\n${runtime}\n</script>${kit3d}`;
	const firstPage = html.search(/<script\b[^>]*data-eli5-page/);
	html = firstPage >= 0 ? html.slice(0, firstPage) + core + "\n" + html.slice(firstPage) : html.replace("</body>", () => `${core}\n</body>`);
	// mount runs last, after the data JSON and every page script exist
	html = html.replace(/<\/body>(?![\s\S]*<\/body>)/, () => "<script>ELI5.mount();</script>\n  </body>");
	if (/data-ic="/.test(html)) throw new Error("icon placeholder left unresolved");
	return html;
}

if (import.meta.main) {
	const file = argv[2];
	if (!file) {
		console.error("usage: bun inline.ts <page.src.html> [-o out.html]");
		exit(2);
	}
	const oi = argv.indexOf("-o");
	const out = oi > 0 ? argv[oi + 1]! : file.replace(/\.src\.html$/, ".html").replace(/^(?!.*\.html$)/, "");
	if (resolve(out) === resolve(file)) {
		console.error("refusing to overwrite the source: name it *.src.html or pass -o");
		exit(2);
	}
	try {
		writeFileSync(out, inline(readFileSync(file, "utf8"), dirname(resolve(file))));
	} catch (e) {
		console.error(`fail: ${(e as Error).message}`);
		exit(1);
	}
	console.log(resolve(out));
}
