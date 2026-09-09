import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { designStore } from "./paths.ts";

type Scope = ":root" | ".dark" | "@theme inline";
type Token = {
	name: string;
	value: string;
	normalizedValue: string;
	scope: Scope;
	line: number;
};

const designDir = designStore();
const args = Bun.argv.slice(2);
const valueFor = (flag: string) => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};

const failOnError = !args.includes("--no-fail");
const corePath = resolve(
	valueFor("--core") ?? resolve(designDir, "themes/_core/layout.css"),
);
const defaultPath = resolve(valueFor("--default") ?? corePath);

const STRUCTURAL = new Set([
	"--font-sans",
	"--font-serif",
	"--font-mono",
	"--radius",
	"--shadow-x",
	"--shadow-y",
	"--shadow-blur",
	"--shadow-spread",
	"--shadow-opacity",
	"--shadow-color",
	"--shadow-2xs",
	"--shadow-xs",
	"--shadow-sm",
	"--shadow",
	"--shadow-md",
	"--shadow-lg",
	"--shadow-xl",
	"--shadow-2xl",
	"--tracking-normal",
	"--spacing",
	"--card-spacing",
	"--card-spacing-sm",
	"--font-heading",
	"--chart-axis-nudge",
	"--radius-pill",
]);

const MARKERS = {
	rootShadcn: /\/\*\s*shadcn primitives and project overrides\s*\*\//i,
	rootProject: /\/\*\s*Project primitives\s*\*\//i,
	darkShadcn: /\/\*\s*shadcn primitives and project overrides\s*\*\//i,
	themeShadcn: /\/\*\s*shadcn aliases and project overrides\s*\*\//i,
	themeProject: /\/\*\s*Project utilities\s*\*\//i,
};

function normalizeValue(value: string) {
	return value.replace(/\s+/g, " ").trim();
}

function closingBrace(source: string, opening: number) {
	let depth = 0;
	for (let index = opening; index < source.length; index++) {
		if (source[index] === "{") depth++;
		if (source[index] === "}" && --depth === 0) return index;
	}
	throw new Error(`Unclosed CSS block at character ${opening}`);
}

function blockBody(source: string, pattern: RegExp) {
	const match = pattern.exec(source);
	if (!match || match.index === undefined) return null;
	const opening = source.indexOf("{", match.index);
	const end = closingBrace(source, opening);
	return {
		startLine: source.slice(0, opening).split("\n").length,
		body: source.slice(opening + 1, end),
		full: source.slice(match.index, end + 1),
	};
}

function parseBlock(source: string, scope: Scope, pattern: RegExp) {
	const block = blockBody(source, pattern);
	if (!block) return { block: null, tokens: [] as Token[] };
	const tokens: Token[] = [];
	for (const declaration of block.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
		const value = declaration[2].trim();
		tokens.push({
			name: declaration[1],
			value,
			normalizedValue: normalizeValue(value),
			scope,
			line:
				block.startLine +
				block.body.slice(0, declaration.index).split("\n").length -
				1,
		});
	}
	return { block, tokens };
}

function markerLine(source: string, pattern: RegExp) {
	const match = pattern.exec(source);
	return match?.index === undefined
		? null
		: source.slice(0, match.index).split("\n").length;
}

function tokenMap(tokens: Token[]) {
	return new Map(tokens.map((token) => [token.name, token]));
}

function missingNames(required: Token[], found: Map<string, Token>) {
	return required
		.map((token) => token.name)
		.filter((name) => !found.has(name));
}

type ParsedLayout = {
	root: ReturnType<typeof parseBlock>;
	dark: ReturnType<typeof parseBlock>;
	theme: ReturnType<typeof parseBlock>;
};

function parseLayout(source: string): ParsedLayout {
	return {
		root: parseBlock(source, ":root", /:root\s*\{/),
		dark: parseBlock(source, ".dark", /\.dark\s*\{/),
		theme: parseBlock(source, "@theme inline", /@theme\s+inline\s*\{/),
	};
}

function coreGaps(core: ParsedLayout, parsed: ParsedLayout) {
	const errors: string[] = [];
	const checks: Array<[string, Token[], Token[]]> = [
		[":root", core.root.tokens, parsed.root.tokens],
		[".dark", core.dark.tokens, parsed.dark.tokens],
		["@theme inline", core.theme.tokens, parsed.theme.tokens],
	];
	for (const [scope, required, found] of checks) {
		for (const name of missingNames(required, tokenMap(found))) {
			errors.push(`${scope} missing core token ${name}`);
		}
	}
	return errors;
}

async function specGaps(projectPath: string, parsed: ParsedLayout) {
	const specPath = resolve(dirname(projectPath), "spec.json");
	if (!(await Bun.file(specPath).exists())) return [] as string[];
	const spec = (await Bun.file(specPath).json()) as {
		root?: Record<string, string>;
		dark?: Record<string, string> | null;
		projectPrimitives?: Record<string, string>;
		projectUtilities?: Record<string, string>;
	};
	const errors: string[] = [];
	const match = (
		label: string,
		tokens: Token[],
		entries?: Record<string, string> | null,
	) => {
		if (!entries) return;
		const found = tokenMap(tokens);
		for (const [name, value] of Object.entries(entries)) {
			const token = found.get(name);
			if (!token) {
				errors.push(`spec ${label} ${name} missing from layout.css`);
				continue;
			}
			if (token.normalizedValue !== normalizeValue(value)) {
				errors.push(`spec ${label} ${name} value mismatch`);
			}
		}
	};
	match(":root", parsed.root.tokens, spec.root);
	match(".dark", parsed.dark.tokens, spec.dark);
	match(":root", parsed.root.tokens, spec.projectPrimitives);
	match("@theme inline", parsed.theme.tokens, spec.projectUtilities);
	return errors;
}

function hasColorScheme(block: string | undefined, expected: "light" | "dark") {
	if (!block) return false;
	const match = /color-scheme\s*:\s*([^;]+);/.exec(block);
	return Boolean(match && match[1].trim().split(/\s+/).includes(expected));
}

async function validateFile(
	projectPath: string,
	defaultSource: string,
	core: ParsedLayout,
) {
	const source = await Bun.file(projectPath).text();
	const errors: string[] = [];
	const parsed = parseLayout(source);
	const { root, dark, theme } = parsed;
	const defaultRoot = parseBlock(defaultSource, ":root", /:root\s*\{/);
	const defaultTheme = parseBlock(
		defaultSource,
		"@theme inline",
		/@theme\s+inline\s*\{/,
	);

	if (!root.block) errors.push("missing :root block");
	if (!dark.block) errors.push("missing .dark block");
	if (!theme.block) errors.push("missing @theme inline block");

	if (root.block && !hasColorScheme(root.block.full, "light")) {
		errors.push(":root must set color-scheme including light");
	}
	if (dark.block && !hasColorScheme(dark.block.full, "dark")) {
		errors.push(".dark must set color-scheme including dark");
	}

	const rootText = root.block?.full ?? "";
	const darkText = dark.block?.full ?? "";
	const themeText = theme.block?.full ?? "";
	if (root.block && !MARKERS.rootShadcn.test(rootText)) {
		errors.push(":root missing /* shadcn primitives and project overrides */");
	}
	if (root.block && !MARKERS.rootProject.test(rootText)) {
		errors.push(":root missing /* Project primitives */");
	}
	if (dark.block && !MARKERS.darkShadcn.test(darkText)) {
		errors.push(".dark missing /* shadcn primitives and project overrides */");
	}
	if (theme.block && !MARKERS.themeShadcn.test(themeText)) {
		errors.push(
			"@theme inline missing /* shadcn aliases and project overrides */",
		);
	}
	if (theme.block && !MARKERS.themeProject.test(themeText)) {
		errors.push("@theme inline missing /* Project utilities */");
	}

	const rootByName = tokenMap(root.tokens);
	const darkByName = tokenMap(dark.tokens);
	for (const token of dark.tokens) {
		if (STRUCTURAL.has(token.name)) {
			errors.push(`.dark must not set structural token ${token.name}`);
		}
	}

	const rootBg = rootByName.get("--background")?.normalizedValue;
	const rootCard = rootByName.get("--card")?.normalizedValue;
	const darkBg = darkByName.get("--background")?.normalizedValue;
	const darkCard = darkByName.get("--card")?.normalizedValue;
	if (rootBg && rootCard && rootBg === rootCard) {
		errors.push(":root --background must differ from --card");
	}
	if (darkBg && darkCard && darkBg === darkCard) {
		errors.push(".dark --background must differ from --card");
	}

	const rootMarker = markerLine(source, MARKERS.rootProject);
	const themeMarker = markerLine(source, MARKERS.themeProject);
	const defaultRootMarker = markerLine(defaultSource, MARKERS.rootProject);
	const defaultThemeMarker = markerLine(defaultSource, MARKERS.themeProject);
	const defaultRootNames = new Set(
		defaultRoot.tokens
			.filter(
				(token) =>
					defaultRootMarker === null || token.line < defaultRootMarker,
			)
			.map((token) => token.name),
	);
	const defaultThemeNames = new Set(
		defaultTheme.tokens
			.filter(
				(token) =>
					defaultThemeMarker === null || token.line < defaultThemeMarker,
			)
			.map((token) => token.name),
	);
	for (const token of root.tokens) {
		if (defaultRootNames.has(token.name)) continue;
		if (rootMarker === null || token.line <= rootMarker) {
			errors.push(
				`:root extra ${token.name} must sit after /* Project primitives */`,
			);
		}
	}
	for (const token of theme.tokens) {
		if (defaultThemeNames.has(token.name)) continue;
		if (themeMarker === null || token.line <= themeMarker) {
			errors.push(
				`@theme extra ${token.name} must sit after /* Project utilities */`,
			);
		}
	}
	for (const name of defaultRootNames) {
		if (!rootByName.has(name))
			errors.push(`:root missing shadcn token ${name}`);
	}
	const themeByName = tokenMap(theme.tokens);
	for (const name of defaultThemeNames) {
		if (!themeByName.has(name)) {
			errors.push(`@theme inline missing shadcn token ${name}`);
		}
	}

	if (resolve(projectPath) !== resolve(corePath)) {
		errors.push(...coreGaps(core, parsed));
	}
	errors.push(...(await specGaps(projectPath, parsed)));

	return {
		project: projectPath,
		ok: errors.length === 0,
		errors,
		summary: {
			rootTokens: root.tokens.length,
			darkTokens: dark.tokens.length,
			themeTokens: theme.tokens.length,
		},
	};
}

async function projectPaths() {
	const single = valueFor("--project");
	if (single) return [resolve(single)];
	if (!args.includes("--all")) {
		throw new Error("pass --project <layout.css> or --all");
	}
	const themes = resolve(designDir, "themes");
	const paths: string[] = [corePath];
	for (const entry of await readdir(themes, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
		const layout = resolve(themes, entry.name, "layout.css");
		if (await Bun.file(layout).exists()) paths.push(layout);
	}
	const clientLayout = resolve(
		homedir(),
		"dev/dashboard/apps/client/src/routes/layout.css",
	);
	if (await Bun.file(clientLayout).exists()) paths.push(clientLayout);
	return paths;
}

const defaultSource = await Bun.file(defaultPath).text();
const coreSource = await Bun.file(corePath).text();
const core = parseLayout(coreSource);
const reports: Array<Awaited<ReturnType<typeof validateFile>>> = [];
for (const projectPath of await projectPaths()) {
	reports.push(await validateFile(projectPath, defaultSource, core));
}

const failed = reports.filter((report) => !report.ok);
process.stdout.write(
	`${JSON.stringify({ core: corePath, reports }, null, 2)}\n`,
);
if (failOnError && failed.length > 0) {
	console.error(`${failed.length} layout.css file(s) failed the token scheme`);
	process.exit(1);
}
