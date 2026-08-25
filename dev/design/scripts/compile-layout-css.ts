import { homedir } from "node:os";
import { join, resolve } from "node:path";

const designDir = resolve(import.meta.dir, "..");

function compileRoot() {
	if (process.env.DESIGN_COMPILE_ROOT) return resolve(process.env.DESIGN_COMPILE_ROOT);
	return resolve(homedir(), "dev/product/postdock/apps/web");
}

export async function compileLayoutCss(slug: string, sourcePaths: string[]) {
	const layoutPath = resolve(designDir, "templates", slug, "layout.css");
	if (!(await Bun.file(layoutPath).exists())) return null;
	const webRoot = compileRoot();
	const cacheDir = join(webRoot, "node_modules/.cache/draft-design");
	await Bun.write(join(cacheDir, ".keep"), "");
	const inputPath = join(cacheDir, `${slug}.css`);
	const outputPath = join(cacheDir, `${slug}.built.css`);
	const sources = sourcePaths
		.map((path) => `@source ${JSON.stringify(path)};`)
		.join("\n");
	const layout = await Bun.file(layoutPath).text();
	await Bun.write(inputPath, `${layout}\n${sources}\n`);
	const proc = Bun.spawn(
		[
			"bunx",
			"--bun",
			"@tailwindcss/cli",
			"-i",
			inputPath,
			"-o",
			outputPath,
			"--minify",
		],
		{ cwd: webRoot, stdout: "pipe", stderr: "pipe" },
	);
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(`tailwind compile failed for ${slug}: ${stderr.trim()}`);
	}
	return Bun.file(outputPath).text();
}

if (import.meta.main) {
	const slug = Bun.argv[2];
	const files = Bun.argv.slice(3);
	if (!slug || files.length === 0) {
		throw new Error("usage: compile-layout-css.ts <slug> <html...>");
	}
	const css = await compileLayoutCss(slug, files);
	if (!css) throw new Error(`no layout.css for ${slug}`);
	process.stdout.write(css);
}
