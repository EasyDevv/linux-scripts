import { basename, dirname, resolve } from "node:path";

export type DraftMeta = {
	route: string;
	title: string;
	file: string;
	href: string;
};

const skipped = /(^|\/)(index\.html|preview\.html|archive\/)/;

export function isRouteDraft(rel: string) {
	return !skipped.test(rel) && dirname(rel) !== ".";
}

export function parseDraftMeta(source: string): Partial<DraftMeta> {
	const comment = source.match(/<!--\s*draft-meta:\s*(\{[\s\S]*?\})\s*-->/);
	if (comment) {
		try {
			return JSON.parse(comment[1]) as Partial<DraftMeta>;
		} catch {
			// fall through to title
		}
	}
	const title = source.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
	return title ? { title } : {};
}

export function routeFromPath(rel: string) {
	const folder = dirname(rel);
	return folder === "." ? "misc" : folder.split("/")[0];
}

export async function listDrafts(draftsRoot: string): Promise<DraftMeta[]> {
	const htmlGlob = new Bun.Glob("**/*.html");
	const drafts: DraftMeta[] = [];
	for await (const rel of htmlGlob.scan({ cwd: draftsRoot, onlyFiles: true })) {
		if (!isRouteDraft(rel)) continue;
		const text = await Bun.file(resolve(draftsRoot, rel)).text();
		const parsed = parseDraftMeta(text);
		drafts.push({
			route: parsed.route ?? routeFromPath(rel),
			title: parsed.title ?? basename(rel, ".html"),
			file: rel,
			href: `./${rel}`,
		});
	}
	drafts.sort((left, right) => left.file.localeCompare(right.file, "en"));
	return drafts;
}
