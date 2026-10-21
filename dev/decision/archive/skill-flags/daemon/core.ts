/**
 * Skill-exposure policy, harness-agnostic: every `SKILL.md` a harness scans carries
 * `disable-model-invocation: true`, so no skill description reaches the model's catalog. The
 * decision daemon's find_skill names the skill a prompt needs instead, and `/skill:name` (pi) or
 * `/name` (Claude Code) still runs any of them by hand. `_manual/` only marks skills find_skill
 * never recommends; it is no longer a frontmatter distinction.
 *
 * Roots, in order:
 * - user: `~/.agents/skills`, `~/.agents/skills-optional`
 * - the current project's `.agents/skills`
 * - every `.agents/skills` under the configured project roots (`~/.config/decision/skill-flags.json`,
 *   default `~/dev`), so a skill made in another repo is already hidden when that repo is opened.
 *
 * This file holds only node builtins and no harness types: the pi extension (`index.ts`) and the
 * Claude Code SessionStart hook (`sync.ts`) both call `syncSkillFlags`.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export const FLAG_KEY = "disable-model-invocation";
const FLAG_LINE = `${FLAG_KEY}: true`;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const FLAG_LINE_RE = new RegExp(`^${FLAG_KEY}:\\s*(\\S+)\\s*$`, "m");
const SKILL_FILE = "SKILL.md";

export const CONFIG_PATH = join(
	process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
	"decision",
	"skill-flags.json",
);

/** Directories a project scan never descends into (the `.agents` lookup is explicit). */
const SKIPPED_DIRS = new Set(["node_modules", "target", "dist", "build", "coverage", "vendor", "venv", "__pycache__"]);

export interface SkillFlagConfig {
	/** Trees scanned whole for `<project>/.agents/skills`; `~` is expanded. */
	projectRoots: string[];
	/** How many directory levels under each project root are walked. */
	maxDepth: number;
}

export interface SkillFlagChange {
	path: string;
	name: string;
}

export interface SyncSkillFlagsResult {
	roots: string[];
	scanned: number;
	changed: SkillFlagChange[];
}

export interface SyncSkillFlagsOptions {
	roots?: string[];
	apply?: boolean;
}

export interface SkillRootsOptions {
	cwd?: string;
	agentsDir?: string;
	config?: SkillFlagConfig;
}

export interface WatchTargets {
	/** `group`: a directory that may gain a skill; `skill`: a skill directory itself. */
	kind: "group" | "skill";
}

/** `~/dev/<category>/<project>` is two levels; a deeper layout raises `maxDepth` in the config file. */
const DEFAULT_CONFIG: SkillFlagConfig = { projectRoots: [join(homedir(), "dev")], maxDepth: 2 };

function expandHome(path: string): string {
	if (path === "~") return homedir();
	return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

export function readSkillFlagConfig(path = CONFIG_PATH): SkillFlagConfig {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return { ...DEFAULT_CONFIG, projectRoots: [...DEFAULT_CONFIG.projectRoots] };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ...DEFAULT_CONFIG, projectRoots: [...DEFAULT_CONFIG.projectRoots] };
	}
	const record = (parsed ?? {}) as { projectRoots?: unknown; maxDepth?: unknown };
	const projectRoots = Array.isArray(record.projectRoots)
		? record.projectRoots.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
		: [];
	const maxDepth =
		typeof record.maxDepth === "number" && record.maxDepth >= 0 ? record.maxDepth : DEFAULT_CONFIG.maxDepth;
	return {
		projectRoots: (projectRoots.length > 0 ? projectRoots : DEFAULT_CONFIG.projectRoots).map(expandHome),
		maxDepth,
	};
}

function realPathOr(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function listImmediateSubdirs(dir: string): string[] {
	if (!existsSync(dir)) return [];
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const dirs: string[] = [];
	for (const entry of entries) {
		if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) continue;
		const fullPath = join(dir, entry.name);
		const isDir = entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(fullPath));
		if (isDir) dirs.push(fullPath);
	}
	return dirs;
}

/** The nearest ancestor of `cwd` that owns a `.git` or `.agents` directory. */
export function projectRootFor(cwd: string): string {
	let dir = resolve(cwd);
	while (true) {
		if (existsSync(join(dir, ".git")) || existsSync(join(dir, ".agents"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return resolve(cwd);
		dir = parent;
	}
}

/** Every `<dir>/.agents/skills` at or under `base`, `maxDepth` levels deep. */
export function discoverProjectSkillRoots(base: string, maxDepth: number): string[] {
	const root = expandHome(base);
	if (!isDirectory(root)) return [];
	const found: string[] = [];
	const visited = new Set<string>();

	const walk = (dir: string, depth: number) => {
		const real = realPathOr(dir);
		if (visited.has(real)) return;
		visited.add(real);

		const skills = join(dir, ".agents", "skills");
		if (isDirectory(skills)) found.push(skills);
		if (depth <= 0) return;
		for (const child of listImmediateSubdirs(dir)) walk(child, depth - 1);
	};

	walk(root, maxDepth);
	return found;
}

/** User roots, then the current project, then every configured project root. Real paths, deduped. */
export function skillRoots(options: SkillRootsOptions = {}): string[] {
	const agentsDir = options.agentsDir ?? join(homedir(), ".agents");
	const config = options.config ?? readSkillFlagConfig();
	const candidates = [
		join(agentsDir, "skills"),
		join(agentsDir, "skills-optional"),
		join(projectRootFor(options.cwd ?? process.cwd()), ".agents", "skills"),
	];

	for (const base of config.projectRoots) candidates.push(...discoverProjectSkillRoots(base, config.maxDepth));

	const roots: string[] = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
		if (!isDirectory(candidate)) continue;
		const real = realPathOr(candidate);
		if (seen.has(real)) continue;
		seen.add(real);
		roots.push(resolve(candidate));
	}
	return roots;
}

/** Group dirs (may gain a skill) and skill dirs (own a `SKILL.md`), for watching. */
export function watchTargets(roots: readonly string[]): Map<string, "group" | "skill"> {
	const targets = new Map<string, "group" | "skill">();
	const stack = roots.map((root) => resolve(root));

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current || !existsSync(current) || targets.has(current)) continue;
		if (existsSync(join(current, SKILL_FILE))) {
			targets.set(current, "skill");
			continue;
		}
		targets.set(current, "group");
		stack.push(...listImmediateSubdirs(current));
	}

	return targets;
}

/** Real `SKILL.md` files under `root`: stop at the first one per directory, dedupe by real path. */
export function listSkillFiles(root: string, seen: Set<string> = new Set()): string[] {
	if (!existsSync(root)) return [];
	const files: string[] = [];
	const stack = [root];

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;

		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}

		const skillFile = entries.find((entry) => entry.name === SKILL_FILE);
		if (skillFile) {
			const fullPath = join(current, skillFile.name);
			const isFile = skillFile.isFile() || (skillFile.isSymbolicLink() && existsSync(fullPath));
			if (isFile) {
				const canonical = realPathOr(fullPath);
				if (!seen.has(canonical)) {
					seen.add(canonical);
					files.push(canonical);
				}
			}
			continue;
		}

		for (const entry of entries) {
			if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) continue;
			const fullPath = join(current, entry.name);
			const isDir = entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(fullPath));
			if (isDir) stack.push(fullPath);
		}
	}

	return files;
}

function skillNameFrom(filePath: string, frontmatter: string): string {
	const match = /^name:\s*(.+)\s*$/m.exec(frontmatter);
	if (match) return match[1].trim();
	return basename(dirname(filePath));
}

function flagIsTrue(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value
		.trim()
		.replace(/^['"]|['"]$/g, "")
		.toLowerCase();
	return normalized === "true";
}

/** The content with the flag set to true, or null when it already is (or there is no frontmatter). */
export function applyHiddenFlag(content: string): string | null {
	const match = FRONTMATTER_RE.exec(content);
	if (!match) return null;

	const frontmatter = match[1];
	const flagMatch = FLAG_LINE_RE.exec(frontmatter);
	if (flagIsTrue(flagMatch?.[1])) return null;

	const nextFrontmatter = flagMatch
		? frontmatter.replace(FLAG_LINE_RE, FLAG_LINE)
		: `${frontmatter.replace(/\s*$/, "")}\n${FLAG_LINE}`;
	return content.replace(FRONTMATTER_RE, `---\n${nextFrontmatter}\n---`);
}

export function syncSkillFlags(options: SyncSkillFlagsOptions = {}): SyncSkillFlagsResult {
	const roots = (options.roots ?? skillRoots()).map((root) => resolve(root));
	const apply = options.apply !== false;
	const changed: SkillFlagChange[] = [];
	const seen = new Set<string>();
	const files = roots.flatMap((root) => listSkillFiles(root, seen));

	for (const filePath of files) {
		let content: string;
		try {
			content = readFileSync(filePath, "utf8");
		} catch {
			continue;
		}

		const match = FRONTMATTER_RE.exec(content);
		if (!match) continue;

		const next = applyHiddenFlag(content);
		if (next === null || next === content) continue;

		if (apply) writeFileSync(filePath, next);
		changed.push({ path: filePath, name: skillNameFrom(filePath, match[1]) });
	}

	return { roots, scanned: files.length, changed };
}

export function formatSyncResult(result: SyncSkillFlagsResult, staleHint = false): string {
	if (result.changed.length === 0) {
		return `Hidden skills: ${result.scanned} scanned across ${result.roots.length} roots, no flag changes.`;
	}
	const parts = [`Hidden skills: hid ${result.changed.map((change) => change.name).join(", ")}.`];
	if (staleHint) parts.push("Run /reload or /sync-hidden-skills to refresh the skill list.");
	return parts.join(" ");
}
