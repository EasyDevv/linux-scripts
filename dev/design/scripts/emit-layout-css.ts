import { dirname, resolve } from "node:path";

type ScopeMap = Record<string, string>;

type Spec = {
	slug: string;
	liveUrl: string;
	imports?: string[];
	root?: ScopeMap;
	dark?: ScopeMap | null;
	projectPrimitives?: ScopeMap;
	projectUtilities?: ScopeMap;
};

const args = Bun.argv.slice(2);
const valueFor = (flag: string) => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};

const specArg = valueFor("--spec");
if (!specArg) {
	throw new Error("--spec <path-to-spec.json> is required");
}
const specPath = resolve(specArg);

const defaultPath = resolve(
	valueFor("--default") ??
		resolve(import.meta.dir, "../templates/_core/layout.css"),
);
const spec = (await Bun.file(specPath).json()) as Spec;
const output = resolve(
	valueFor("--out") ?? resolve(dirname(specPath), "layout.css"),
);

const source = await Bun.file(defaultPath).text();

function closingBrace(text: string, opening: number) {
	let depth = 0;
	for (let index = opening; index < text.length; index++) {
		if (text[index] === "{") depth++;
		if (text[index] === "}" && --depth === 0) return index;
	}
	throw new Error(`Unclosed CSS block at character ${opening}`);
}

function replaceDeclarations(body: string, overrides?: ScopeMap | null) {
	if (!overrides) return body;
	let next = body;
	for (const [name, value] of Object.entries(overrides)) {
		const pattern = new RegExp(`(${name}\\s*:\\s*)([^;]+)(;)`);
		if (!pattern.test(next)) {
			throw new Error(`Token ${name} is not in this block`);
		}
		next = next.replace(pattern, `$1${value}$3`);
	}
	return next;
}

function insertBeforeClose(body: string, title: string, extra: string) {
	const marker = new RegExp(`\n\t\/\*\s*${title}\s*\*\/[\s\S]*$`);
	if (marker.test(body)) return body.replace(marker, extra);
	const trimmed = body.replace(/\s+$/, "");
	return `${trimmed}\n${extra}\n`;
}

function formatDeclarations(title: string, tokens?: ScopeMap) {
	const entries = Object.entries(tokens ?? {});
	if (entries.length === 0) return `\n\t/* ${title} */\n`;
	const lines = entries.map(([name, value]) => `\t${name}: ${value};`);
	return `\n\t/* ${title} */\n${lines.join("\n")}\n`;
}

let next = source.replace(
	/^@import "tailwindcss";\n/,
	`${(spec.imports ?? ['@import "tailwindcss";']).join("\n")}\n`,
);

const rootMatch = next.match(/:root\s*\{/);
if (!rootMatch || rootMatch.index === undefined) {
	throw new Error("default.css is missing :root");
}
const rootOpen = next.indexOf("{", rootMatch.index);
const rootClose = closingBrace(next, rootOpen);
const rootBody = replaceDeclarations(
	next.slice(rootOpen + 1, rootClose),
	spec.root,
);
const rootWithProject = insertBeforeClose(
	rootBody,
	"Project primitives",
	formatDeclarations("Project primitives", spec.projectPrimitives),
);
next =
	next.slice(0, rootOpen + 1) + rootWithProject + next.slice(rootClose);

const darkMatch = next.match(/\.dark\s*\{/);
if (darkMatch && darkMatch.index !== undefined && spec.dark !== undefined) {
	const darkOpen = next.indexOf("{", darkMatch.index);
	const darkClose = closingBrace(next, darkOpen);
	if (spec.dark === null) {
		next = `${next.slice(0, darkMatch.index)}${next.slice(darkClose + 1)}`;
	} else {
		const darkBody = replaceDeclarations(
			next.slice(darkOpen + 1, darkClose),
			spec.dark,
		);
		next = next.slice(0, darkOpen + 1) + darkBody + next.slice(darkClose);
	}
}

const themeMatch = next.match(/@theme\s+inline\s*\{/);
if (!themeMatch || themeMatch.index === undefined) {
	throw new Error("default.css is missing @theme inline");
}
const themeOpen = next.indexOf("{", themeMatch.index);
const themeClose = closingBrace(next, themeOpen);
const themeBody = next.slice(themeOpen + 1, themeClose);
const themeWithProject = insertBeforeClose(
	themeBody,
	"Project utilities",
	formatDeclarations("Project utilities", spec.projectUtilities),
);
next =
	next.slice(0, themeOpen + 1) + themeWithProject + next.slice(themeClose);

const banner = `/* Measured from ${spec.liveUrl}. Copy over a shadcn-svelte layout.css; keep the project's @import lines if they already exist. */\n`;
await Bun.write(output, banner + next);
process.stdout.write(`${output}\n`);
