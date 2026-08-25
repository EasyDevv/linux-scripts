import { relative, resolve } from "node:path";

type Occurrence = {
	file: string;
	line: number;
	className: string;
	utility: string;
	value: string;
	category: string;
	tokenizable: boolean;
};

const args = Bun.argv.slice(2);
const valueFor = (flag: string) => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};

const root = resolve(valueFor("--root") ?? ".");
const layoutPath = resolve(
	root,
	valueFor("--layout") ?? "src/routes/layout.css",
);
const output = valueFor("--out");
const minimumOccurrences = Number(valueFor("--min-occurrences") ?? 2);
const failOnCandidates = args.includes("--fail-on-candidates");

const sourceGlob = new Bun.Glob("**/*.{svelte,ts,js,tsx,jsx,html}");
const ignored =
	/(^|\/)(node_modules|\.svelte-kit|dist|build|coverage|\.archive)(\/|$)/;
const arbitraryPattern =
	/(?<![\w-])((?:[\w-]+:)*!?-?[\w-]+)-\[((?:\\.|[^\]])+)\]/g;

function categoryFor(utility: string, value: string) {
	const base = utility.replace(/^(?:[\w-]+:)*/, "").replace(/^!/, "");
	if (
		base === "bg" ||
		base.startsWith("from") ||
		base.startsWith("via") ||
		base.startsWith("to")
	)
		return value.includes("gradient") || value.includes("url(")
			? "image"
			: "color";
	if (
		["border", "ring", "outline", "decoration", "fill", "stroke"].includes(base)
	)
		return "color";
	if (base === "text")
		return /^(#|rgb|hsl|oklch|lab|lch|color\(|var\(--.*color)/.test(value)
			? "color"
			: "typography";
	if (base === "rounded") return "radius";
	if (base === "shadow") return "shadow";
	if (base === "font") return "font";
	if (base === "leading") return "line-height";
	if (base === "tracking") return "letter-spacing";
	if (/^(m[trblxy]?|p[trblxy]?|gap|space-[xy])$/.test(base)) return "spacing";
	if (
		/^(w|min-w|max-w|h|min-h|max-h|size|basis|inset|top|right|bottom|left)$/.test(
			base,
		)
	)
		return "size";
	return "structure";
}

function tokenPattern(category: string) {
	const patterns: Record<string, string> = {
		color: "--color-<semantic-role>",
		radius: "--radius-<scale>",
		shadow: "--shadow-<scale>",
		font: "--font-<role>",
		typography: "--text-<scale>",
		"line-height": "--leading-<scale>",
		"letter-spacing": "--tracking-<scale>",
		spacing: "--spacing-<scale>",
		size: "--size-<scale>",
	};
	return patterns[category] ?? null;
}

function categoryForToken(name: string) {
	if (name.endsWith("--line-height") || name.startsWith("--leading-"))
		return "line-height";
	if (name.endsWith("--letter-spacing") || name.startsWith("--tracking-"))
		return "letter-spacing";
	if (name.startsWith("--color-")) return "color";
	if (name.startsWith("--radius-")) return "radius";
	if (name.startsWith("--shadow-") || name.includes("shadow")) return "shadow";
	if (name.startsWith("--font-")) return "font";
	if (name.startsWith("--text-")) return "typography";
	if (name.startsWith("--spacing-")) return "spacing";
	if (name.startsWith("--size-")) return "size";
	return null;
}

const layoutText = await Bun.file(layoutPath)
	.text()
	.catch(() => "");
const existingTokens = [
	...layoutText.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g),
].map((match) => ({
	name: match[1],
	value: match[2].trim(),
}));
const contextSpecificName =
	/(?:^|-)(landing|marketing|auth|login|register|pricing|contact|publish|account|hero|footer|header|cta|form|button)(?:-|$)/;
const nonUniversalTokens = existingTokens.filter((token) =>
	contextSpecificName.test(token.name),
);
const tokenByCategoryValue = new Map<string, string[]>();
for (const token of existingTokens) {
	const category = categoryForToken(token.name);
	if (!category) continue;
	const key = `${category}\0${token.value}`;
	const names = tokenByCategoryValue.get(key) ?? [];
	names.push(token.name);
	tokenByCategoryValue.set(key, names);
}

const occurrences: Occurrence[] = [];
for await (const path of sourceGlob.scan({
	cwd: root,
	absolute: true,
	onlyFiles: true,
})) {
	const file = relative(root, path);
	if (ignored.test(file)) continue;
	const source = await Bun.file(path).text();
	for (const match of source.matchAll(arbitraryPattern)) {
		const className = match[0];
		const utility = match[1];
		const value = match[2].replaceAll("\\_", " ").trim();
		const category = categoryFor(utility, value);
		occurrences.push({
			file,
			line: source.slice(0, match.index).split("\n").length,
			className,
			utility,
			value,
			category,
			tokenizable: category !== "structure" && category !== "image",
		});
	}
}

const grouped = new Map<string, Occurrence[]>();
for (const occurrence of occurrences) {
	const key = `${occurrence.category}\0${occurrence.value}`;
	const values = grouped.get(key) ?? [];
	values.push(occurrence);
	grouped.set(key, values);
}

const groups = [...grouped.values()]
	.map((items) => {
		const { category, value, tokenizable } = items[0];
		const existing = tokenByCategoryValue.get(`${category}\0${value}`) ?? [];
		const promotable = tokenizable && items.length >= minimumOccurrences;
		return {
			category,
			value,
			count: items.length,
			existingTokens: existing,
			promotable,
			suggestedToken: existing[0] ?? null,
			tokenPattern:
				promotable && existing.length === 0 ? tokenPattern(category) : null,
			occurrences: items.map(({ file, line, className, utility }) => ({
				file,
				line,
				className,
				utility,
			})),
		};
	})
	.sort(
		(a, b) =>
			Number(b.promotable) - Number(a.promotable) ||
			b.count - a.count ||
			a.value.localeCompare(b.value),
	);

const report = {
	root,
	layout: relative(root, layoutPath),
	minimumOccurrences,
	summary: {
		occurrences: occurrences.length,
		uniqueValues: groups.length,
		promotable: groups.filter((group) => group.promotable).length,
		matchedExistingToken: groups.filter(
			(group) => group.existingTokens.length > 0,
		).length,
		nonUniversalTokens: nonUniversalTokens.length,
	},
	namingPolicy: {
		allowedPatterns: [
			"--color-<semantic-role>",
			"--size-<scale>",
			"--spacing-<scale>",
			"--radius-<scale>",
			"--text-<scale>",
			"--font-<role>",
			"--shadow-<scale>",
			"--leading-<scale>",
			"--tracking-<scale>",
		],
		forbiddenContextTerms: [
			"landing",
			"marketing",
			"auth",
			"login",
			"register",
			"pricing",
			"contact",
			"publish",
			"account",
			"hero",
			"footer",
			"header",
			"cta",
			"form",
			"button",
		],
	},
	nonUniversalTokens,
	groups,
};

const json = `${JSON.stringify(report, null, 2)}\n`;
if (output) await Bun.write(resolve(output), json);
else process.stdout.write(json);

if (
	failOnCandidates &&
	(report.summary.promotable > 0 || report.summary.nonUniversalTokens > 0)
) {
	console.error(
		`${report.summary.promotable} promotable arbitrary-value group(s) and ${report.summary.nonUniversalTokens} context-specific token name(s) remain`,
	);
	process.exit(1);
}
