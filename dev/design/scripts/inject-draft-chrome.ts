import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { compileLayoutCss } from "./compile-layout-css.ts";

const designDir = resolve(import.meta.dir, "..");
export const draftSheetDir = resolve(designDir, ".cache/sheets");
const markerStart = "<!-- draft-chrome -->";
const markerEnd = "<!-- /draft-chrome -->";

type Style = { slug: string; label: string; scheme?: string };

export type InjectChromeOptions = {
	force?: boolean;
};

export type InjectChromeResult = {
	written: number;
	skipped: number;
};

export function draftSheetPath(slug: string) {
	return resolve(draftSheetDir, `${slug}.css`);
}

function withoutCompiledSheets(html: string) {
	return html.replace(
		/(<style\b[^>]*\bdata-draft-style\b[^>]*>)[\s\S]*?(<\/style>)/gi,
		"$1</style>",
	);
}

function applyChrome(html: string, snippet: string) {
	const next = html
		.replace(/\s*<link[^>]*id="draft-style"[^>]*>/g, "")
		.replace(/\s*<link rel="stylesheet" href="[^"]*switch\.css"\s*\/?>/g, "");
	if (next.includes(markerStart) && next.includes(markerEnd)) {
		return next.replace(
			new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`),
			snippet,
		);
	}
	return next.replace(/\s*<\/body>/, `\n  ${snippet}\n</body>`);
}

export async function overlayDraftSheets(html: string) {
	if (!html.includes("data-draft-style")) return html;
	const styles = (await Bun.file(
		resolve(designDir, "js/draft-styles.json"),
	).json()) as Style[];
	let next = html;
	for (const style of styles) {
		const sheet = Bun.file(draftSheetPath(style.slug));
		if (!(await sheet.exists())) continue;
		const css = (await sheet.text()).trim();
		const pattern = new RegExp(
			`(<style\\b[^>]*\\bdata-draft-style="${style.slug}"[^>]*>)[\\s\\S]*?(</style>)`,
		);
		if (!pattern.test(next)) continue;
		next = next.replace(pattern, `$1\n${css}\n$2`);
	}
	return next;
}

export async function injectDraftChromeInto(
	draftsRoot: string,
	options: InjectChromeOptions = {},
): Promise<InjectChromeResult> {
	const force = options.force === true;
	const [switchCss, schemeJs, switchJs, styles] = await Promise.all([
		Bun.file(resolve(designDir, "css/switch.css")).text(),
		Bun.file(resolve(designDir, "js/color-scheme.js")).text(),
		Bun.file(resolve(designDir, "js/switch-style.js")).text(),
		Bun.file(resolve(designDir, "js/draft-styles.json")).json() as Promise<
			Style[]
		>,
	]);

	const htmlGlob = new Bun.Glob("**/*.html");
	const skipped = /(^|\/)(index\.html|preview\.html|archive\/)/;
	const targets: string[] = [];
	for await (const rel of htmlGlob.scan({ cwd: draftsRoot, onlyFiles: true })) {
		if (skipped.test(rel) || dirname(rel) === ".") continue;
		targets.push(resolve(draftsRoot, rel));
	}

	const listed: Style[] = [];
	const sheets: string[] = [];
	await mkdir(draftSheetDir, { recursive: true });
	for (const style of styles) {
		const css = await compileLayoutCss(style.slug, targets);
		if (!css) continue;
		listed.push(style);
		await Bun.write(draftSheetPath(style.slug), `${css.trim()}\n`);
		sheets.push(
			`<style data-draft-style="${style.slug}" data-draft-src="~/.local/share/scripts/dev/design/templates/${style.slug}/layout.css">\n${css.trim()}\n</style>`,
		);
	}

	const switcher = `<style id="draft-switch-css">
${switchCss.trim()}
</style>
<script>
window.DRAFT_STYLES = ${JSON.stringify(listed)};
${schemeJs.trim()}
${switchJs.trim()}
</script>`;

	let written = 0;
	let skippedCount = 0;
	for (const abs of targets) {
		const prev = await Bun.file(abs).text();
		const useLayout = /data-layout-css/.test(prev);
		const snippet = `${markerStart}
${useLayout ? `${sheets.join("\n")}\n` : ""}${switcher}
${markerEnd}`;
		const next = applyChrome(prev, snippet);
		const cssOnly =
			next !== prev &&
			withoutCompiledSheets(prev) === withoutCompiledSheets(next);
		if (!force && (next === prev || cssOnly)) {
			skippedCount += 1;
			continue;
		}
		await Bun.write(abs, next);
		written += 1;
	}
	return { written, skipped: skippedCount };
}

if (import.meta.main) {
	const args = Bun.argv.slice(2);
	const root = resolve(
		args.includes("--root") ? args[args.indexOf("--root") + 1] : ".",
	);
	const { written, skipped } = await injectDraftChromeInto(
		resolve(root, ".draft"),
		{ force: args.includes("--force") },
	);
	process.stdout.write(
		`injected chrome into ${written} drafts (${skipped} unchanged)\n`,
	);
}
