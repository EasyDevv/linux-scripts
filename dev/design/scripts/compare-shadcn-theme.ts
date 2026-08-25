import { resolve } from "node:path";

type Scope = ":root" | "@theme inline";
type Token = {
	name: string;
	value: string;
	normalizedValue: string;
	scope: Scope;
	line: number;
};

const args = Bun.argv.slice(2);
const valueFor = (flag: string) => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};

const projectPath = resolve(
	valueFor("--project") ?? "apps/web/src/routes/layout.css",
);
const defaultPath = resolve(
	valueFor("--default") ??
		"/home/easydev/.agents/skills-ready/shadcn-svelte/theme/default.css",
);
const output = valueFor("--out");
const failOnUnsectioned = args.includes("--fail-on-unsectioned");

function normalizeValue(value: string) {
	return value
		.replace(/\s+/g, " ")
		.replace(/(-?\d+\.\d*?[1-9])0+(?=\D|$)/g, "$1")
		.replace(/(-?\d+)\.0+(?=\D|$)/g, "$1")
		.trim();
}

function closingBrace(source: string, opening: number) {
	let depth = 0;
	for (let index = opening; index < source.length; index++) {
		if (source[index] === "{") depth++;
		if (source[index] === "}" && --depth === 0) return index;
	}
	throw new Error(`Unclosed CSS block at character ${opening}`);
}

function parseTokens(source: string) {
	const tokens: Token[] = [];
	for (const scope of [":root", "@theme inline"] as const) {
		const scopePattern =
			scope === ":root" ? /:root\s*\{/g : /@theme\s+inline\s*\{/g;
		for (const match of source.matchAll(scopePattern)) {
			const opening = source.indexOf("{", match.index);
			const end = closingBrace(source, opening);
			const body = source.slice(opening + 1, end);
			for (const declaration of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
				const value = declaration[2].trim();
				tokens.push({
					name: declaration[1],
					value,
					normalizedValue: normalizeValue(value),
					scope,
					line: source.slice(0, opening + 1 + declaration.index).split("\n")
						.length,
				});
			}
		}
	}
	return tokens;
}

const [projectSource, defaultSource] = await Promise.all([
	Bun.file(projectPath).text(),
	Bun.file(defaultPath).text(),
]);
const projectTokens = parseTokens(projectSource);
const defaultTokens = parseTokens(defaultSource);
const keyFor = (token: Token) => `${token.scope}\0${token.name}`;
const projectByKey = new Map(
	projectTokens.map((token) => [keyFor(token), token]),
);
const defaultByKey = new Map(
	defaultTokens.map((token) => [keyFor(token), token]),
);

const unchanged: Array<{ project: Token; default: Token }> = [];
const overridden: Array<{ project: Token; default: Token }> = [];
const added: Token[] = [];
for (const project of projectTokens) {
	const baseline = defaultByKey.get(keyFor(project));
	if (!baseline) added.push(project);
	else if (project.normalizedValue === baseline.normalizedValue)
		unchanged.push({ project, default: baseline });
	else overridden.push({ project, default: baseline });
}
const missing = defaultTokens.filter(
	(token) => !projectByKey.has(keyFor(token)),
);

function markerLine(pattern: RegExp) {
	const match = pattern.exec(projectSource);
	return match?.index === undefined
		? null
		: projectSource.slice(0, match.index).split("\n").length;
}
const markers = {
	root: markerLine(/\/\*\s*Project primitives\s*\*\//i),
	theme: markerLine(/\/\*\s*Project utilities\s*\*\//i),
};
const addedByScope = {
	root: added.filter((token) => token.scope === ":root"),
	theme: added.filter((token) => token.scope === "@theme inline"),
};
const unsectioned = [
	...addedByScope.root.filter(
		(token) => markers.root === null || token.line <= markers.root,
	),
	...addedByScope.theme.filter(
		(token) => markers.theme === null || token.line <= markers.theme,
	),
];

const report = {
	project: projectPath,
	default: defaultPath,
	summary: {
		projectTokens: projectTokens.length,
		defaultTokens: defaultTokens.length,
		unchanged: unchanged.length,
		overridden: overridden.length,
		added: added.length,
		missingDefault: missing.length,
		unsectionedAdditions: unsectioned.length,
	},
	sectionRecommendation: {
		strategy: "comments-within-existing-blocks",
		reason:
			":root owns runtime custom properties while @theme inline registers Tailwind utilities. Keeping one block of each avoids split ownership and preserves cascade order.",
		rootMarker: "/* Project primitives */",
		themeMarker: "/* Project utilities */",
		placement: {
			":root":
				"Keep shadcn-compatible primitives first, then place project-only runtime values after the Project primitives marker.",
			"@theme inline":
				"Keep shadcn aliases and overrides first, then place project-only utility tokens after the Project utilities marker.",
		},
		separateTopLevelBlocks:
			"Valid CSS, but not recommended: duplicate :root or @theme inline blocks make token ownership and comparison harder to audit.",
	},
	markers,
	unchanged,
	overridden,
	added,
	missing,
	unsectioned,
};

const json = `${JSON.stringify(report, null, 2)}\n`;
if (output) await Bun.write(resolve(output), json);
else process.stdout.write(json);

if (failOnUnsectioned && unsectioned.length > 0) {
	console.error(
		`${unsectioned.length} project token(s) are outside a marked project section`,
	);
	process.exit(1);
}
