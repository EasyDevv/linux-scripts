import { dirname, resolve } from "node:path";
import { compileLayoutCss } from "./compile-layout-css.ts";

const designDir = resolve(import.meta.dir, "..");
const markerStart = "<!-- draft-chrome -->";
const markerEnd = "<!-- /draft-chrome -->";

type Style = { slug: string; label: string; scheme?: string };

export async function injectDraftChromeInto(draftsRoot: string) {
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
	for (const style of styles) {
		const css = await compileLayoutCss(style.slug, targets);
		if (!css) continue;
		listed.push(style);
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

	let count = 0;
	for (const abs of targets) {
		let html = await Bun.file(abs).text();
		html = html
			.replace(/\s*<link[^>]*id="draft-style"[^>]*>/g, "")
			.replace(/\s*<link rel="stylesheet" href="[^"]*switch\.css"\s*\/?>/g, "");
		const useLayout = /data-layout-css/.test(html);
		const snippet = `${markerStart}
${useLayout ? `${sheets.join("\n")}\n` : ""}${switcher}
${markerEnd}`;
		if (html.includes(markerStart) && html.includes(markerEnd)) {
			html = html.replace(
				new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`),
				snippet,
			);
		} else {
			html = html.replace(/\s*<\/body>/, `\n  ${snippet}\n</body>`);
		}
		await Bun.write(abs, html);
		count += 1;
	}
	return count;
}

if (import.meta.main) {
	const root = resolve(
		Bun.argv.includes("--root")
			? Bun.argv[Bun.argv.indexOf("--root") + 1]
			: ".",
	);
	const count = await injectDraftChromeInto(resolve(root, ".drafts"));
	process.stdout.write(`injected chrome into ${count} drafts\n`);
}
