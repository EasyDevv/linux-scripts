/**
 * path_resolve: a model names a path that does not exist, most often a skill file under another
 * `.agents/skills-*` folder than the one the skill lives in (skills move between `skills-routed`,
 * `skills-optional` and `skills-archive`; a project copy is re-based onto `~/.agents`). Three
 * sessions in three days lost 2-3 turns each to `ENOENT`/`Path not found` before a `find` located it.
 *
 * Code only, no Jev, filesystem only. The answer is one of:
 * - `rewrite`: the same skill (or the same file name inside that skill) exists exactly once elsewhere;
 *   the client runs the call with that path, so the failure never happens.
 * - `hint`: nothing safe to rewrite; the failed result gets the nearest existing directory's entries
 *   and same-name files below it, so the model does not spend a step on `ls`/`find`.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

const SKIP = new Set([".git", "node_modules", "target", "dist", "build", ".venv", "__pycache__", ".cache"]);
const SKILL_DEPTH = 3;
const SCAN_DEPTH = 4;
const SCAN_LIMIT = 4_000;
const LIST_LIMIT = 12;
const MATCH_LIMIT = 5;
const INDEX_TTL_MS = 10_000;

export interface Context {
	home: string;
	cwd?: string;
}

export type Resolution =
	| { kind: "rewrite"; path: string; from: string; why: string }
	| { kind: "hint"; path: string; nearest: string; entries: string[]; more: number; matches: string[] };

/** `~`, `$HOME` and relative paths as an absolute path without a trailing slash. */
export function absolute(p: string, ctx: Context): string | undefined {
	const expanded = p.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/u, ctx.home.replace(/\/+$/u, ""));
	if (!isAbsolute(expanded) && ctx.cwd === undefined) return undefined;
	const abs = resolve(ctx.cwd ?? "/", expanded);
	return abs.length > 1 ? abs.replace(/\/+$/u, "") : abs;
}

function ancestors(path: string): string[] {
	const out: string[] = [];
	for (let d = path; ; d = dirname(d)) {
		out.push(d);
		if (d === dirname(d)) return out;
	}
}

function subdirs(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((e) => e.isDirectory() && !SKIP.has(e.name))
			.map((e) => join(dir, e.name));
	} catch {
		return [];
	}
}

// ── skill index ─────────────────────────────────────────────────────────────────────────────

const indexes = new Map<string, { at: number; byName: Map<string, string[]> }>();

/** Every skill directory (one holding a `SKILL.md`) under the `.agents/skills*` folders that apply. */
function skillIndex(roots: string[]): Map<string, string[]> {
	const key = roots.join("\0");
	const hit = indexes.get(key);
	if (hit && Date.now() - hit.at < INDEX_TTL_MS) return hit.byName;
	const byName = new Map<string, string[]>();
	const walk = (dir: string, depth: number) => {
		if (existsSync(join(dir, "SKILL.md"))) {
			const name = dir.slice(dir.lastIndexOf(sep) + 1);
			byName.set(name, [...(byName.get(name) ?? []), dir]);
			return;
		}
		if (depth < SKILL_DEPTH) for (const sub of subdirs(dir)) walk(sub, depth + 1);
	};
	for (const root of roots)
		for (const skills of subdirs(root).filter((d) => /\/skills[^/]*$/u.test(d))) walk(skills, 1);
	indexes.set(key, { at: Date.now(), byName });
	return byName;
}

function agentRoots(abs: string, ctx: Context): string[] {
	const dirs = [ctx.home, ...(ctx.cwd ? ancestors(ctx.cwd) : []), ...ancestors(dirname(abs))];
	return [...new Set(dirs.map((d) => join(d, ".agents")))].filter((d) => existsSync(d));
}

/** Files named `name` below `dir`, shallowest first; bounded in depth and in entries scanned. */
function findNamed(dir: string, name: string, depth = SCAN_DEPTH): string[] {
	const found: string[] = [];
	let scanned = 0;
	let level = [dir];
	for (let d = 0; d < depth && level.length > 0 && scanned < SCAN_LIMIT; d++) {
		const next: string[] = [];
		for (const current of level) {
			let entries: import("node:fs").Dirent[];
			try {
				entries = readdirSync(current, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const e of entries) {
				if (++scanned > SCAN_LIMIT) return found;
				if (e.name === name) found.push(join(current, e.name));
				if (e.isDirectory() && !SKIP.has(e.name)) next.push(join(current, e.name));
			}
		}
		level = next;
	}
	return found;
}

/**
 * The path in another skill folder: the skill name is a component of `abs`, the tail after it (or,
 * failing that, the tail's file name) exists exactly once in the skill's directory; when several
 * skills match, the one under the cwd wins. Undefined when there is no such skill or it is ambiguous.
 */
function moved(abs: string, ctx: Context): { path: string; why: string } | undefined {
	if (!abs.includes(`${sep}.agents${sep}`)) return undefined;
	const index = skillIndex(agentRoots(abs, ctx));
	const parts = abs.split(sep);
	const exact = new Set<string>();
	const loose = new Set<string>();
	parts.forEach((name, i) => {
		for (const dir of index.get(name) ?? []) {
			const tail = parts.slice(i + 1);
			const same = join(dir, ...tail);
			if (existsSync(same)) exact.add(same);
			else if (tail.length > 0) for (const m of findNamed(dir, tail[tail.length - 1] ?? "", 3)) loose.add(m);
		}
	});
	let pick = exact.size > 0 ? [...exact] : [...loose];
	// A project's own copy is what find_skill pointed at: it wins over a global one.
	const local = ctx.cwd ? pick.filter((p) => p.startsWith(`${ctx.cwd}${sep}`)) : [];
	if (pick.length > 1 && local.length === 1) pick = local;
	if (pick.length !== 1) return undefined;
	return { path: pick[0] ?? "", why: exact.size > 0 ? "the skill moved" : "the file moved inside the skill" };
}

// ── resolution ──────────────────────────────────────────────────────────────────────────────

/** Undefined when the path exists (or cannot be made absolute): nothing to resolve. */
export function resolveMissing(raw: string, ctx: Context): Resolution | undefined {
	const abs = absolute(raw, ctx);
	if (abs === undefined || existsSync(abs)) return undefined;
	const swapped = moved(abs, ctx);
	if (swapped) return { kind: "rewrite", path: swapped.path, from: abs, why: swapped.why };

	let nearest = dirname(abs);
	while (nearest !== dirname(nearest) && !isDir(nearest)) nearest = dirname(nearest);
	let names: string[] = [];
	try {
		names = readdirSync(nearest, { withFileTypes: true })
			.map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
			.sort();
	} catch {
		// unreadable: no listing
	}
	const wide = nearest === "/" || nearest === ctx.home.replace(/\/+$/u, "");
	const base = abs.slice(abs.lastIndexOf(sep) + 1);
	const matches = wide ? [] : findNamed(nearest, base).slice(0, MATCH_LIMIT);
	return {
		kind: "hint",
		path: abs,
		nearest,
		entries: names.slice(0, LIST_LIMIT),
		more: Math.max(0, names.length - LIST_LIMIT),
		matches,
	};
}

function isDir(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

/** The model-facing line for a failed call whose path is missing. */
export function describeMissing(r: Extract<Resolution, { kind: "hint" }>): string {
	const list = r.entries.length > 0 ? `${r.entries.join(" ")}${r.more > 0 ? ` … +${r.more}` : ""}` : "(empty)";
	const same = r.matches.length > 0 ? ` Same name elsewhere below it: ${r.matches.join(", ")}.` : "";
	return `\`${r.path}\` does not exist. Nearest existing directory \`${r.nearest}\` holds: ${list}.${same}`;
}
