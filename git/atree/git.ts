import { $ } from "bun";
import {
	existsSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	readdirSync,
	openSync,
	closeSync,
	unlinkSync,
} from "node:fs";
import { join, relative, resolve, isAbsolute, normalize } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

// ── Types ──

export interface Cfg {
	version: number;
	symlinks: string[];
	copies: string[];
}

export interface Flags {
	positional: string[];
	symlinks: string[];
	copies: string[];
	branch?: string;
	dryRun: boolean;
	force: boolean;
	noPrompt: boolean;
	patch: boolean;
	json: boolean;
	squash: boolean;
	rstSrc: boolean;
	rmSrc: boolean;
}

// ── Paths ──

export function cfgPath(root: string) {
	return join(root, ".worktree", "config.json");
}
export function wtDir(root: string) {
	return join(root, ".worktree");
}
export function slotPath(root: string, n: number) {
	return join(root, ".worktree", String(n));
}

export function nextSlot(root: string): number {
	const d = wtDir(root);
	if (!existsSync(d)) return 1;
	const nums = readdirSync(d)
		.filter((e) => /^\d+$/.test(e))
		.map(Number)
		.sort((a, b) => a - b);
	return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

export function normPath(input: string, root: string): string {
	let p = input.trim();
	if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
	else if (p === "~") p = homedir();
	const resolved = isAbsolute(p) ? resolve(p) : resolve(root, p);
	const rel = relative(root, resolved);
	if (rel.startsWith("..") || isAbsolute(rel))
		throw new Error(`Path "${input}" is outside repository root`);
	return normalize(rel);
}

export function listSlots(root: string): number[] {
	const d = wtDir(root);
	if (!existsSync(d)) return [];
	return readdirSync(d)
		.filter((e) => /^\d+$/.test(e))
		.map(Number)
		.sort((a, b) => a - b);
}

// ── Config ──

function defaultCfg(): Cfg {
	return { version: 1, symlinks: [], copies: [] };
}

export function readCfg(root: string): Cfg {
	const p = cfgPath(root);
	if (!existsSync(p)) return defaultCfg();
	try {
		const d = JSON.parse(readFileSync(p, "utf-8"));
		return {
			version: d.version ?? 1,
			symlinks: d.symlinks ?? [],
			copies: d.copies ?? [],
		};
	} catch {
		console.warn("  ⚠ Corrupt config.json, using defaults");
		return defaultCfg();
	}
}

export function writeCfg(root: string, c: Cfg): void {
	mkdirSync(cfgPath(root).replace(/\/[^/]+$/, ""), { recursive: true });
	writeFileSync(cfgPath(root), JSON.stringify(c, null, 2) + "\n");
}

const ATREE_MARK = "# atree-managed";

export function ensureGitignore(root: string): void {
	const gi = join(root, ".gitignore");
	let content = existsSync(gi) ? readFileSync(gi, "utf-8") : "";

	const lines = content.split("\n").map((l) => l.trim());
	const hasAll = lines.some(
		(l) => l === ".worktree" || l === ".worktree/*" || l === ".worktree/**",
	);
	const hasCfg = lines.some((l) => l === "!.worktree/config.json");
	const hasMark = lines.some((l) => l === ATREE_MARK);
	if (hasAll && hasCfg) return;

	if (content.length > 0 && !content.endsWith("\n")) content += "\n";

	if (!hasMark) content += `\n${ATREE_MARK}\n`;
	if (!hasAll) content += ".worktree/*\n";
	if (!hasCfg) content += "!.worktree/config.json\n";

	writeFileSync(gi, content);
}

// ── Prompts ──

export function ask(query: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((r) =>
		rl.question(query, (a) => {
			rl.close();
			r(a);
		}),
	);
}

export async function interactivePaths(root: string, cfg: Cfg): Promise<void> {
	console.log("\nPaths to share via symlink (empty when done):");
	while (true) {
		const inp = await ask("  symlink> ");
		if (!inp.trim()) break;
		try {
			const n = normPath(inp, root);
			if (!cfg.symlinks.includes(n)) cfg.symlinks.push(n);
		} catch (e: any) {
			console.error(`  ${e.message}`);
		}
	}
	console.log("Paths to copy (empty when done):");
	while (true) {
		const inp = await ask("  copy> ");
		if (!inp.trim()) break;
		try {
			const n = normPath(inp, root);
			if (!cfg.copies.includes(n)) cfg.copies.push(n);
		} catch (e: any) {
			console.error(`  ${e.message}`);
		}
	}
}

// ── Git ──

export async function getMainRoot(): Promise<string> {
	try {
		const r = await $`git worktree list --porcelain`.quiet().nothrow();
		if (r.exitCode !== 0 || !r.stdout.toString().trim())
			throw new Error("not inside a git repository");
		const line = r.stdout.toString().trim().split("\n")[0];
		if (!line.startsWith("worktree "))
			throw new Error("unexpected git worktree output");
		return line.slice("worktree ".length);
	} catch (e: any) {
		throw new Error(e.message || "not inside a git repository");
	}
}

export async function getBranchName(path: string): Promise<string | null> {
	try {
		const r = await $`git -C ${path} rev-parse --abbrev-ref HEAD`
			.quiet()
			.nothrow();
		return r.exitCode === 0 ? r.stdout.toString().trim() : null;
	} catch {
		return null;
	}
}

export async function getSlotBranch(
	root: string,
	slot: number,
): Promise<string | null> {
	return getBranchName(slotPath(root, slot));
}

export interface SlotInfo {
	slot: number;
	branch: string | null;
	path: string;
}

export async function listSlotInfo(root: string): Promise<SlotInfo[]> {
	const result: SlotInfo[] = [];
	for (const s of listSlots(root)) {
		const sp = slotPath(root, s);
		if (!existsSync(sp)) continue;
		result.push({ slot: s, branch: await getBranchName(sp), path: sp });
	}
	return result;
}

export async function createWorktree(
	root: string,
	slot: number,
	opts: { dryRun: boolean; force: boolean; branch?: string },
): Promise<void> {
	const sp = slotPath(root, slot);
	const branch = opts.branch || `atree/${slot}`;
	if (!opts.dryRun && existsSync(sp))
		throw new Error(`Worktree ./.worktree/${slot}/ already exists`);
	console.log(`Creating ./.worktree/${slot}/ (branch: ${branch})`);
	if (opts.dryRun) {
		console.log(
			`  git worktree add ${opts.force ? "-B" : "-b"} ${branch} ${sp}`,
		);
		return;
	}
	const flag = opts.force ? "-B" : "-b";
	const r = await $`git worktree add ${flag} ${branch} ${sp}`
		.cwd(root)
		.nothrow()
		.quiet();
	if (r.exitCode !== 0)
		throw new Error(`git worktree add failed: ${r.stderr.toString().trim()}`);
	console.log("  ✓ Created");
}

export async function commitConfigChanges(
	root: string,
	message: string,
): Promise<boolean> {
	const status =
		await $`git status --porcelain .gitignore .worktree/config.json`
			.cwd(root)
			.quiet()
			.nothrow();
	const changes = status.stdout.toString().trim();
	if (!changes) return false;
	const add = await $`git add .gitignore .worktree/config.json`
		.cwd(root)
		.quiet()
		.nothrow();
	if (add.exitCode !== 0) return false;
	const commit = await $`git commit -m ${message}`.cwd(root).quiet().nothrow();
	return commit.exitCode === 0;
}

export async function pruneWorktrees(root: string): Promise<void> {
	await $`git worktree prune`.cwd(root).quiet().nothrow();
}

// ── Sessions / Locks ──

export interface SlotLock {
	pid: number;
	command: string;
	branch: string;
	startedAt: string;
}

export interface Sessions {
	version: number;
	locks: Record<string, SlotLock>;
}

function sessionsPath(root: string) {
	return join(root, ".worktree", "sessions.json");
}
function sessionsLockPath(root: string) {
	return join(root, ".worktree", ".sessions.lock");
}

function defaultSessions(): Sessions {
	return { version: 1, locks: {} };
}

export function readSessions(root: string): Sessions {
	const p = sessionsPath(root);
	if (!existsSync(p)) return defaultSessions();
	try {
		const d = JSON.parse(readFileSync(p, "utf-8"));
		return {
			version: d.version ?? 1,
			locks: d.locks ?? {},
		};
	} catch {
		console.warn("  ⚠ Corrupt sessions.json, resetting");
		return defaultSessions();
	}
}

function writeSessions(root: string, s: Sessions): void {
	mkdirSync(wtDir(root), { recursive: true });
	writeFileSync(sessionsPath(root), JSON.stringify(s, null, 2) + "\n");
}

async function withSessionsLock<T>(
	root: string,
	fn: () => Promise<T> | T,
): Promise<T> {
	const lock = sessionsLockPath(root);
	mkdirSync(wtDir(root), { recursive: true });
	let fd: number | null = null;
	for (let i = 0; i < 50; i++) {
		try {
			fd = openSync(lock, "wx");
			break;
		} catch {
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	if (fd === null) throw new Error("Could not acquire sessions.json lock");
	try {
		return await fn();
	} finally {
		closeSync(fd);
		try {
			unlinkSync(lock);
		} catch {}
	}
}

async function isPidAlive(pid: number): Promise<boolean> {
	if (pid <= 0) return false;
	const r = await $`kill -0 ${pid}`.quiet().nothrow();
	return r.exitCode === 0;
}

export async function cleanStaleLocks(root: string): Promise<string[]> {
	return withSessionsLock(root, async () => {
		const s = readSessions(root);
		const removed: string[] = [];
		for (const [slot, lock] of Object.entries(s.locks)) {
			if (!(await isPidAlive(lock.pid))) {
				delete s.locks[slot];
				removed.push(slot);
			}
		}
		if (removed.length > 0) writeSessions(root, s);
		return removed;
	});
}

export async function acquireLock(
	root: string,
	slot: number,
	command: string,
	branch: string,
	opts: { mustNotExist?: boolean } = {},
): Promise<void> {
	const slotKey = String(slot);
	const sp = slotPath(root, slot);
	return withSessionsLock(root, async () => {
		if (opts.mustNotExist && existsSync(sp)) {
			throw new Error(
				`Slot ${slot} already exists at ${sp} (worktree present, lock refused)`,
			);
		}
		const s = readSessions(root);
		const existing = s.locks[slotKey];
		if (existing) {
			if (await isPidAlive(existing.pid)) {
				throw new Error(
					`Slot ${slot} is locked by pid ${existing.pid} (${existing.command} on ${existing.branch}, started ${existing.startedAt})`,
				);
			}
			console.warn(
				`  ⚠ Stale lock for slot ${slot} (pid ${existing.pid} no longer alive), stealing`,
			);
			delete s.locks[slotKey];
		}
		s.locks[slotKey] = {
			pid: process.pid,
			command,
			branch,
			startedAt: new Date().toISOString(),
		};
		writeSessions(root, s);
	});
}

export async function releaseLock(root: string, slot: number): Promise<void> {
	const slotKey = String(slot);
	await withSessionsLock(root, async () => {
		const s = readSessions(root);
		if (s.locks[slotKey]?.pid === process.pid) {
			delete s.locks[slotKey];
			writeSessions(root, s);
		}
	});
}

export async function listLocks(
	root: string,
): Promise<Record<string, SlotLock>> {
	await cleanStaleLocks(root);
	return readSessions(root).locks;
}

export async function isWorktreeDirty(path: string): Promise<boolean> {
	const r = await $`git -C ${path} status --porcelain`.quiet().nothrow();
	return r.stdout.toString().trim().length > 0;
}

export async function mergeBranch(
	root: string,
	branch: string,
	squash: boolean,
) {
	const r = squash
		? await $`git merge --squash ${branch}`.cwd(root).nothrow()
		: await $`git merge --no-ff ${branch} -m "Merge branch '${branch}' into main"`
				.cwd(root)
				.nothrow();
	const output = (r.stdout.toString() + r.stderr.toString()).trim();
	return { ok: r.exitCode === 0, output, conflict: r.exitCode !== 0 };
}

export async function removeWorktree(
	root: string,
	path: string,
): Promise<boolean> {
	return (
		(await $`git worktree remove --force ${path}`.cwd(root).nothrow())
			.exitCode === 0
	);
}

export async function deleteBranch(
	root: string,
	branch: string,
): Promise<boolean> {
	return (await $`git branch -D ${branch}`.cwd(root).nothrow()).exitCode === 0;
}

export async function isBranchMerged(
	root: string,
	branch: string,
): Promise<boolean> {
	const r = await $`git branch --merged main --list ${branch}`
		.cwd(root)
		.quiet()
		.nothrow();
	return r.stdout.toString().trim().includes(branch);
}

export async function resetWorktree(
	path: string,
	target: string,
): Promise<boolean> {
	if ((await $`git -C ${path} reset --hard ${target}`.nothrow()).exitCode !== 0)
		return false;
	return (await $`git -C ${path} clean -fd`.nothrow()).exitCode === 0;
}
