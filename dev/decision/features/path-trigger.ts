/**
 * The script half of find_skill: `paths:` globs on skills and routed rules, matched against the
 * paths a prompt names and the files a harness touched. No model is asked; a match is a fact.
 */

import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import type { CatalogEntry } from "../catalog.ts";

/** ASCII path characters: a Korean particle glued to a path (`docs/plan에`) ends it. */
const PATH_RUN = /[\w.~@*+-]+(?:\/[\w.~@*+-]*)*/g;
const EXTENSION = /\.[A-Za-z][\w]{0,7}$/;

function looksLikePath(token: string): boolean {
	if (token.includes("/")) return /[A-Za-z]/.test(token);
	return EXTENSION.test(token);
}

/**
 * Project-relative paths named in `prompt` plus `touched`. A path outside `root` is dropped:
 * `paths:` globs are project-relative.
 */
export function mentionedPaths(prompt: string, root: string, cwd = root, touched: readonly string[] = []): string[] {
	const home = homedir();
	const found = new Set<string>();
	const add = (raw: string) => {
		let token = raw.replace(/[.,:;]+$/, "");
		if (!token || !looksLikePath(token)) return;
		if (token === "~" || token.startsWith("~/")) token = home + token.slice(1);
		const abs = isAbsolute(token) ? token : resolve(cwd, token);
		const rel = relative(root, abs);
		if (!rel || rel.startsWith("..") || isAbsolute(rel)) return;
		found.add(rel);
	};
	for (const line of prompt.split("\n")) {
		if (line.includes("://")) {
			for (const word of line.split(/\s+/))
				if (!word.includes("://")) for (const m of word.match(PATH_RUN) ?? []) add(m);
			continue;
		}
		for (const m of line.match(PATH_RUN) ?? []) add(m);
	}
	for (const path of touched) add(path);
	return [...found];
}

/** The glob's leading segments before the first wildcard (`docs/**\/*.md` → `docs`). */
function staticPrefix(glob: string): string {
	const segments: string[] = [];
	for (const segment of glob.split("/")) {
		if (/[*?[{]/.test(segment)) break;
		segments.push(segment);
	}
	return segments.join("/");
}

/** A file matches its glob; a directory (no extension) matches a glob rooted at or above it. */
export function matchesGlob(glob: string, path: string): boolean {
	if (new Bun.Glob(glob).match(path)) return true;
	if (EXTENSION.test(path)) return false;
	const prefix = staticPrefix(glob);
	return prefix !== "" && prefix !== glob && `${path}/`.startsWith(`${prefix}/`);
}

export interface PathHit {
	entry: CatalogEntry;
	/** The path that matched. */
	via: string;
}

export function pathHits(entries: readonly CatalogEntry[], paths: readonly string[]): PathHit[] {
	const hits: PathHit[] = [];
	if (paths.length === 0) return hits;
	for (const entry of entries) {
		const via = paths.find((path) => entry.paths.some((glob) => matchesGlob(glob, path)));
		if (via !== undefined) hits.push({ entry, via });
	}
	return hits;
}
