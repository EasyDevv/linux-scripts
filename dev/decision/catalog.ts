/**
 * Skill and routed-rule catalog for find_skill.
 *
 * Skills: `SKILL.md` one directory down in `~/.agents/skills` and `{projectRoot}/.agents/skills` (never
 * `_manual/`). Rules: `~/.agents/rules-routed/*.md` and `{projectRoot}/.agents/rules-routed/*.md`.
 * A project entry replaces a global one of the same kind and name. Each file is parsed once and
 * re-parsed only when its mtime or size changes; the directory listings are read on every call,
 * so a new or deleted skill shows up on the next prompt without a restart.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface CatalogEntry {
	kind: "skill" | "rule";
	name: string;
	/** Absolute path of `SKILL.md` or the rule file. */
	path: string;
	scope: "global" | "project";
	description: string;
	/** Rules only: skills that pull this rule in when selected. */
	skills: string[];
	/** `paths:` globs, project-relative: a prompt that names or a harness that touches a match triggers it. */
	paths: string[];
	/** Rules only: the text without frontmatter. */
	body?: string;
}

interface Frontmatter {
	meta: Record<string, string | string[]>;
	body: string;
}

/** Nearest ancestor of `cwd` holding `.git` (a directory or a worktree file), else `cwd`. */
export function projectRoot(cwd: string, exists: (path: string) => boolean = existsSync): string {
	const start = resolve(cwd);
	for (let dir = start; ; dir = dirname(dir)) {
		if (exists(join(dir, ".git"))) return dir;
		if (dirname(dir) === dir) return start;
	}
}

function unquote(value: string): string {
	const v = value.trim();
	if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
		try {
			return JSON.parse(v) as string;
		} catch {
			return v.slice(1, -1);
		}
	}
	if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replaceAll("''", "'");
	return v;
}

function inlineList(value: string): string[] {
	const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
	// Commas inside quotes or a glob's `{a,b}` do not split.
	const items: string[] = [];
	let depth = 0;
	let quote = "";
	let start = 0;
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (quote) {
			if (ch === quote) quote = "";
		} else if (ch === '"' || ch === "'") quote = ch;
		else if (ch === "{") depth++;
		else if (ch === "}") depth = Math.max(0, depth - 1);
		else if (ch === "," && depth === 0) {
			items.push(inner.slice(start, i));
			start = i + 1;
		}
	}
	items.push(inner.slice(start));
	return items.map((item) => unquote(item)).filter(Boolean);
}

/**
 * Tolerant frontmatter reader. Skill files in the wild are not always valid YAML (an unquoted
 * `: ` in a description), so this reads only what the catalog needs: top-level `key: value`
 * lines, quoted or plain scalars with indented continuation, `>`/`|` block scalars, and lists
 * written inline (`[a, b]`) or as `- item` lines.
 */
export function parseFrontmatter(text: string): Frontmatter {
	const normalized = text.replace(/^\uFEFF/u, "").replaceAll("\r\n", "\n");
	const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized);
	if (!match) return { meta: {}, body: normalized };
	const meta: Record<string, string | string[]> = {};
	const lines = (match[1] ?? "").split("\n");
	for (let i = 0; i < lines.length; i++) {
		const head = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(lines[i] ?? "");
		if (!head) continue;
		const key = head[1] ?? "";
		const first = head[2] ?? "";
		const rest: string[] = [];
		while (i + 1 < lines.length && /^[ \t]+\S|^[ \t]*$/.test(lines[i + 1] ?? "")) rest.push((lines[++i] ?? "").trim());
		const items = rest.filter((line) => line.startsWith("- "));
		if (first === "" && items.length > 0) {
			meta[key] = items.map((line) => unquote(line.slice(2)));
		} else if (/^[>|][+-]?$/.test(first)) {
			meta[key] = rest.filter(Boolean).join(" ");
		} else if (first.startsWith("[")) {
			meta[key] = inlineList([first, ...rest].join(" "));
		} else {
			meta[key] = unquote([first, ...rest.filter(Boolean)].join(" "));
		}
	}
	return { meta, body: normalized.slice(match[0].length).replace(/^\n+/, "") };
}

function scalar(value: string | string[] | undefined): string {
	return (Array.isArray(value) ? value.join(" ") : (value ?? "")).replace(/\s+/g, " ").trim();
}

/** A rule without a `description:` yet is described by its title and first bullet. */
function fallbackDescription(body: string): string {
	const title = /^#\s+(.+)$/m.exec(body)?.[1] ?? "";
	const bullet = /^[-*]\s+(.+)$/m.exec(body)?.[1] ?? "";
	return `${title}. ${bullet}`.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function listOf(value: string | string[] | undefined): string[] {
	return Array.isArray(value) ? value : value ? inlineList(value) : [];
}

function parseSkill(path: string, dirName: string, scope: CatalogEntry["scope"]): CatalogEntry | undefined {
	const { meta } = parseFrontmatter(readFileSync(path, "utf8"));
	const description = scalar(meta.description);
	if (!description) return undefined;
	return {
		kind: "skill",
		name: scalar(meta.name) || dirName,
		path,
		scope,
		description,
		skills: [],
		paths: listOf(meta.paths),
	};
}

function parseRule(path: string, name: string, scope: CatalogEntry["scope"]): CatalogEntry | undefined {
	const { meta, body } = parseFrontmatter(readFileSync(path, "utf8"));
	const text = body.trim();
	if (!text) return undefined;
	return {
		kind: "rule",
		name,
		path,
		scope,
		description: scalar(meta.description) || fallbackDescription(text),
		skills: listOf(meta.skills),
		paths: listOf(meta.paths),
		body: text,
	};
}

export class CatalogReader {
	private readonly files = new Map<string, { sig: string; entry: CatalogEntry | undefined }>();

	constructor(private readonly home: string = homedir()) {}

	/** Every skill and routed rule visible from `cwd`; a project entry wins over a global one. */
	read(cwd?: string): CatalogEntry[] {
		const roots: { base: string; scope: CatalogEntry["scope"] }[] = [
			{ base: join(this.home, ".agents"), scope: "global" },
		];
		if (cwd) {
			const base = join(projectRoot(cwd), ".agents");
			if (base !== roots[0]?.base) roots.push({ base, scope: "project" });
		}
		const merged = new Map<string, CatalogEntry>();
		for (const { base, scope } of roots) {
			for (const entry of [
				...this.scanSkills(join(base, "skills"), scope),
				...this.scanRules(join(base, "rules-routed"), scope),
			]) {
				merged.set(`${entry.kind}:${entry.name}`, entry);
			}
		}
		return [...merged.values()];
	}

	private list(dir: string): string[] {
		try {
			return readdirSync(dir).sort();
		} catch {
			return [];
		}
	}

	private scanSkills(dir: string, scope: CatalogEntry["scope"]): CatalogEntry[] {
		const found: CatalogEntry[] = [];
		for (const name of this.list(dir)) {
			if (name.startsWith(".") || name === "_manual") continue;
			const file = join(dir, name, "SKILL.md");
			const entry = this.cached(file, () => parseSkill(file, name, scope));
			if (entry) found.push(entry);
		}
		return found;
	}

	private scanRules(dir: string, scope: CatalogEntry["scope"]): CatalogEntry[] {
		const found: CatalogEntry[] = [];
		for (const file of this.list(dir)) {
			if (file.startsWith(".") || !file.endsWith(".md")) continue;
			const path = join(dir, file);
			const entry = this.cached(path, () => parseRule(path, file.slice(0, -3), scope));
			if (entry) found.push(entry);
		}
		return found;
	}

	private cached(path: string, parse: () => CatalogEntry | undefined): CatalogEntry | undefined {
		let sig: string;
		try {
			const stat = statSync(path);
			if (!stat.isFile()) return undefined;
			sig = `${stat.mtimeMs}:${stat.size}`;
		} catch {
			this.files.delete(path);
			return undefined;
		}
		const hit = this.files.get(path);
		if (hit?.sig === sig) return hit.entry;
		let entry: CatalogEntry | undefined;
		try {
			entry = parse();
		} catch {
			entry = undefined;
		}
		this.files.set(path, { sig, entry });
		return entry;
	}
}
