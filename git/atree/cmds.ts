import {
	existsSync,
	lstatSync,
	readlinkSync,
	rmSync,
	mkdirSync,
	symlinkSync,
	cpSync,
	readdirSync as fsReaddirSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { $ } from "bun";
import type { Cfg, Flags } from "./git";

export class ExitError extends Error {
	code: number;
	constructor(code: number) {
		super(`exit ${code}`);
		this.code = code;
	}
}
import {
	cfgPath,
	slotPath,
	wtDir,
	nextSlot,
	normPath,
	listSlots,
	readCfg,
	writeCfg,
	ensureGitignore,
	createWorktree,
	getSlotBranch,
	listSlotInfo,
	isWorktreeDirty,
	mergeBranch,
	removeWorktree,
	deleteBranch,
	resetWorktree,
	ask,
	interactivePaths,
	pruneWorktrees,
	commitConfigChanges,
	acquireLock,
	releaseLock,
	listLocks,
	cleanStaleLocks,
	isBranchMerged,
} from "./git";

import { collectSlotChanges, formatDiffTable } from "./diff";

// ── Apply helpers ──

function applySymlinks(
	root: string,
	slotR: string,
	paths: string[],
	dry: boolean,
	force: boolean,
) {
	for (const p of paths) {
		const src = resolve(root, p);
		const dst = resolve(slotR, p);
		if (!existsSync(src)) {
			console.warn(`  ⚠ Source not found: ${p}`);
			continue;
		}
		let existingTarget: string | null = null;
		try {
			const lst = lstatSync(dst);
			if (lst.isSymbolicLink()) {
				existingTarget = readlinkSync(dst);
			} else {
				existingTarget = "(not a symlink)";
			}
		} catch {}
		if (existingTarget !== null) {
			if (existingTarget === src) {
				console.log(`  · ${p} already linked (${existingTarget})`);
				continue;
			}
			if (!force) {
				console.error(
					`  ✗ ${p} conflict: existing symlink → ${existingTarget}, would overwrite → ${src} (use --force)`,
				);
				continue;
			}
			console.warn(`  ⚠ ${p} conflict: replacing ${existingTarget} → ${src}`);
			if (dry) {
				console.log(`  → Would remove and re-link ${p}`);
				continue;
			}
			rmSync(dst, { recursive: true, force: true });
		}
		if (dry) {
			console.log(`  → ln -s ${src} ${dst}`);
			continue;
		}
		mkdirSync(dirname(dst), { recursive: true });
		symlinkSync(src, dst);
		console.log(`  ✓ Symlinked ${p} → ${src}`);
	}
}

function applyCopies(
	root: string,
	slotR: string,
	paths: string[],
	dry: boolean,
	force: boolean,
) {
	for (const p of paths) {
		const src = resolve(root, p);
		const dst = resolve(slotR, p);
		if (!existsSync(src)) {
			console.error(`  ✗ Source not found: ${p}`);
			continue;
		}
		let exists = false;
		try {
			lstatSync(dst);
			exists = true;
		} catch {}
		if (exists) {
			if (!force) {
				console.error(`  ✗ ${p} exists, use --force`);
				continue;
			}
			if (dry) {
				console.log(`  → Would remove ${p} and copy`);
				continue;
			}
			rmSync(dst, { recursive: true, force: true });
		}
		if (dry) {
			console.log(`  → cp ${p}`);
			continue;
		}
		mkdirSync(dirname(dst), { recursive: true });
		cpSync(src, dst, { recursive: true, force: true });
		console.log(`  ✓ Copied ${p}`);
	}
}

// ── new ──

export async function cmdNew(root: string, flags: Flags): Promise<void> {
	let slot: number;
	if (flags.positional[1]) {
		slot = parseInt(flags.positional[1], 10);
		if (isNaN(slot) || slot < 1) {
			console.error(
				`Invalid slot: ${flags.positional[1]} (expected positive integer, e.g. 1, 2, 3)`,
			);
			throw new ExitError(1);
		}
	} else {
		slot = nextSlot(root);
	}

	let cfg = readCfg(root);
	const cfgExisted = existsSync(cfgPath(root));

	const isTTY = process.stdin.isTTY && process.stdout.isTTY;
	const interactive = !flags.noPrompt && isTTY;

	for (const s of flags.symlinks) {
		try {
			const n = normPath(s, root);
			if (!cfg.symlinks.includes(n)) cfg.symlinks.push(n);
		} catch (e: any) {
			console.error(e.message);
		}
	}
	for (const c of flags.copies) {
		try {
			const n = normPath(c, root);
			if (!cfg.copies.includes(n)) cfg.copies.push(n);
		} catch (e: any) {
			console.error(e.message);
		}
	}

	const branch = flags.branch || `atree/${slot}`;
	let locked = false;

	try {
		if (interactive && cfgExisted) {
			const sp = slotPath(root, slot);
			if (existsSync(sp)) {
				console.log(`\nExisting config (slot ${slot}):`);
			} else {
				console.log(`\nExisting config from previous slots:`);
			}
			if (cfg.symlinks.length > 0)
				console.log(`  symlinks: ${cfg.symlinks.join(", ")}`);
			if (cfg.copies.length > 0)
				console.log(`  copies: ${cfg.copies.join(", ")}`);
			if (
				(await ask("\nAdd more paths? [y/N] ")).toLowerCase().startsWith("y")
			) {
				await interactivePaths(root, cfg);
			}
		} else if (interactive) {
			await interactivePaths(root, cfg);
		}

		if (!flags.dryRun) {
			try {
				await acquireLock(root, slot, "new", branch, { mustNotExist: true });
				locked = true;
			} catch (e: any) {
				console.error(e.message);
				throw new ExitError(1);
			}
		}

		if (!flags.dryRun) {
			writeCfg(root, cfg);
			ensureGitignore(root);
		} else {
			console.log(`  → Would write ${cfgPath(root)}`);
			console.log(`  → Would update .gitignore (atree-managed block)`);
		}

		await createWorktree(root, slot, flags);
		console.log(`\nWorktree ./.worktree/${slot}/ created.`);

		const sp = slotPath(root, slot);
		if (cfg.symlinks.length > 0) {
			console.log("");
			applySymlinks(root, sp, cfg.symlinks, flags.dryRun, flags.force);
		}
		if (cfg.copies.length > 0) {
			console.log("");
			applyCopies(root, sp, cfg.copies, flags.dryRun, flags.force);
		}

		if (!flags.dryRun) {
			const committed = await commitConfigChanges(
				root,
				`chore: atree config (slot ${slot})`,
			);
			if (committed) console.log("  ✓ Config committed");
		}
	} finally {
		if (locked) await releaseLock(root, slot);
	}
}

// ── ls ──

export async function cmdList(root: string, _flags: Flags): Promise<void> {
	await pruneWorktrees(root);
	const slots = await listSlotInfo(root);
	if (slots.length === 0) {
		console.log("No worktree slots found.");
		return;
	}
	console.log("Slot\tBranch\tPath");
	for (const s of slots)
		console.log(`${s.slot}\t${s.branch || "(unknown)"}\t${s.path}`);
}

// ── status ──

export async function cmdStatus(root: string, flags: Flags): Promise<void> {
	await pruneWorktrees(root);
	const slots = await listSlotInfo(root);
	const locks = await listLocks(root);
	const lockSlots = new Set(Object.keys(locks));

	if (flags.json) {
		const result = slots.map((s) => ({
			slot: s.slot,
			branch: s.branch,
			path: s.path,
			locked: lockSlots.has(String(s.slot)),
			lock: locks[String(s.slot)] || null,
		}));
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	if (slots.length === 0 && Object.keys(locks).length === 0) {
		console.log("No worktree slots found.");
		return;
	}

	console.log("Slot\tBranch\tState\tLock");
	for (const s of slots) {
		const state = (await isWorktreeDirty(s.path)) ? "dirty" : "clean";
		const lockInfo = locks[String(s.slot)];
		const lock = lockInfo
			? `${lockInfo.command}@${lockInfo.pid} since ${lockInfo.startedAt.slice(11, 19)}`
			: "-";
		console.log(`${s.slot}\t${s.branch || "(unknown)"}\t${state}\t${lock}`);
	}
}

// ── apply ──

export async function cmdApply(root: string, flags: Flags): Promise<void> {
	const cfg = readCfg(root);
	if (!existsSync(cfgPath(root))) {
		console.error("No config found at .worktree/config.json");
		throw new ExitError(1);
	}

	for (const s of flags.symlinks) {
		try {
			const n = normPath(s, root);
			if (!cfg.symlinks.includes(n)) cfg.symlinks.push(n);
		} catch (e: any) {
			console.error(e.message);
		}
	}
	for (const c of flags.copies) {
		try {
			const n = normPath(c, root);
			if (!cfg.copies.includes(n)) cfg.copies.push(n);
		} catch (e: any) {
			console.error(e.message);
		}
	}
	writeCfg(root, cfg);

	const d = wtDir(root);
	if (!existsSync(d)) {
		console.log("No worktrees to apply to.");
		return;
	}

	let slots: number[];
	if (flags.positional[1]) {
		const s = parseInt(flags.positional[1], 10);
		if (isNaN(s)) {
			console.error(
				`Invalid slot: ${flags.positional[1]} (expected positive integer, e.g. 1, 2, 3)`,
			);
			throw new ExitError(1);
		}
		slots = [s];
	} else {
		slots = fsReaddirSync(d)
			.filter((e) => /^\d+$/.test(e))
			.map(Number)
			.sort((a, b) => a - b);
	}
	if (slots.length === 0) {
		console.log("No worktree slots found.");
		return;
	}

	for (const s of slots) {
		const sp = slotPath(root, s);
		if (!existsSync(sp)) {
			console.warn(`  Slot ${s} does not exist, skipping.`);
			continue;
		}
		const slotBranch = (await getSlotBranch(root, s)) || `atree/${s}`;
		if (!flags.dryRun) {
			try {
				await acquireLock(root, s, "apply", slotBranch);
			} catch (e: any) {
				console.warn(`  ${e.message}, skipping.`);
				continue;
			}
		}
		try {
			console.log(`\nApplying to ./.worktree/${s}/:`);
			if (cfg.symlinks.length > 0)
				applySymlinks(root, sp, cfg.symlinks, flags.dryRun, flags.force);
			if (cfg.copies.length > 0)
				applyCopies(root, sp, cfg.copies, flags.dryRun, flags.force);
		} finally {
			if (!flags.dryRun) await releaseLock(root, s);
		}
	}
}

// ── merge ──

export async function cmdMerge(root: string, flags: Flags): Promise<void> {
	const slotStr = flags.positional[1];
	if (!slotStr) {
		console.error("Usage: atree merge <slot>");
		throw new ExitError(1);
	}
	const slot = parseInt(slotStr, 10);
	if (isNaN(slot) || slot < 1) {
		console.error(
			`Invalid slot: ${slotStr} (expected positive integer, e.g. 1, 2, 3)`,
		);
		throw new ExitError(1);
	}

	const sp = slotPath(root, slot);
	if (!existsSync(sp)) {
		console.error(`Slot ${slot} does not exist at ${sp}`);
		throw new ExitError(1);
	}

	const branch = await getSlotBranch(root, slot);
	if (!branch) {
		console.error(`Cannot determine branch for slot ${slot}`);
		throw new ExitError(1);
	}

	if (flags.dryRun) {
		console.log(
			`Would merge ${branch} into main\n  git merge --no-ff ${branch}`,
		);
		return;
	}

	try {
		await acquireLock(root, slot, "merge", branch);
	} catch (e: any) {
		console.error(e.message);
		throw new ExitError(1);
	}

	if (await isWorktreeDirty(sp)) {
		if (!flags.force) {
			console.error(
				`Slot ${slot} has uncommitted changes. Commit/stash or use --force.`,
			);
			throw new ExitError(1);
		}
		console.warn(
			`  ⚠ Slot ${slot} has uncommitted changes, proceeding with --force`,
		);
	}

	try {
		let stashed = false;
		if (await isWorktreeDirty(root)) {
			console.warn("  ⚠ Main dirty — auto-stashing (will pop on success)");
			const stash = await $`git stash push -u -m atree-autostash`
				.cwd(root)
				.quiet()
				.nothrow();
			if (stash.exitCode !== 0) {
				console.error("Auto-stash failed. Commit/stash manually and retry.");
				throw new ExitError(1);
			}
			stashed = true;
		}

		console.log(`Merging ${branch} into main...`);
		const result = await mergeBranch(root, branch, flags.squash);

		if (result.conflict) {
			if (stashed) {
				console.error(
					"  ⚠ Conflict detected. Run `git stash pop` after resolving to restore your changes.",
				);
			} else {
				console.error(
					`Merge conflict! Resolve conflicts in main, then commit.`,
				);
			}
			throw new ExitError(1);
		}
		if (!result.ok) {
			console.error(`Merge failed: ${result.output}`);
			throw new ExitError(1);
		}

		if (stashed) {
			const pop = await $`git stash pop`.cwd(root).quiet().nothrow();
			if (pop.exitCode === 0) console.log("  ✓ Stash restored");
			else
				console.warn(
					"  ⚠ Stash pop failed — your changes are still in the stash list.",
				);
		}

		if (flags.squash)
			console.log(
				"  ✓ Squash merge complete. Changes staged. Run 'git commit' to finish.",
			);
		else console.log("  ✓ Merged (--no-ff). Merge commit created.");

		if (flags.rmSrc) {
			console.log(`Removing worktree slot ${slot}...`);
			if (await removeWorktree(root, sp)) {
				console.log("  ✓ Worktree removed");
				if (branch !== "main" && branch !== "HEAD") {
					await deleteBranch(root, branch);
					console.log(`  ✓ Branch ${branch} deleted`);
				}
			} else console.error("  ✗ Failed to remove worktree");
		} else if (flags.rstSrc) {
			console.log(`Resetting slot ${slot} to main...`);
			if (await resetWorktree(sp, "main"))
				console.log("  ✓ Slot synced to main (git reset --hard, clean -fd)");
			else console.error("  ✗ Failed to reset slot");
		}
	} finally {
		await releaseLock(root, slot);
	}
}

// ── rm ──

export async function cmdRm(root: string, flags: Flags): Promise<void> {
	const slotStr = flags.positional[1];
	if (!slotStr) {
		console.error("Usage: atree rm <slot>");
		throw new ExitError(1);
	}
	const slot = parseInt(slotStr, 10);
	if (isNaN(slot) || slot < 1) {
		console.error(
			`Invalid slot: ${slotStr} (expected positive integer, e.g. 1, 2, 3)`,
		);
		throw new ExitError(1);
	}

	const sp = slotPath(root, slot);
	if (!existsSync(sp)) {
		console.error(`Slot ${slot} does not exist at ${sp}`);
		throw new ExitError(1);
	}

	const branch = await getSlotBranch(root, slot);
	if (!branch) {
		console.error(`Cannot determine branch for slot ${slot}`);
		throw new ExitError(1);
	}

	try {
		await acquireLock(root, slot, "rm", branch);
	} catch (e: any) {
		console.error(e.message);
		throw new ExitError(1);
	}

	try {
		console.log(`\n=== Changes in slot ${slot} (${branch}) ===`);
		const changes = await collectSlotChanges(root, slot, branch, sp);
		console.log(formatDiffTable(changes));

		const dirty = changes.some(
			(c) => c.type === "working" || c.type === "untracked",
		);
		if (dirty) {
			if (!flags.force) {
				console.error(
					`\n✗ Slot ${slot} has uncommitted changes. Commit/stash or use --force.`,
				);
				throw new ExitError(1);
			}
			console.warn(`\n  ⚠ Uncommitted changes will be lost (--force)`);
		}

		const merged = await isBranchMerged(root, branch);
		if (!merged && !flags.dryRun) {
			if (!flags.force) {
				console.error(
					`\n✗ Branch ${branch} is not merged into main. Use --force to delete anyway.`,
				);
				throw new ExitError(1);
			}
			console.warn(`\n  ⚠ Branch ${branch} not merged, will be force-deleted`);
		}

		if (flags.dryRun) {
			console.log("\nWould remove slot (dry-run)");
			return;
		}

		if (!flags.noPrompt) {
			const ans = await ask(
				`\nDelete slot ${slot} (worktree + branch "${branch}")? [y/N] `,
			);
			if (!ans.toLowerCase().startsWith("y")) {
				console.log("Cancelled.");
				return;
			}
		}

		console.log(`\nRemoving worktree slot ${slot}...`);
		if (await removeWorktree(root, sp)) {
			console.log("  ✓ Worktree removed");
		} else {
			console.error("  ✗ Failed to remove worktree");
			throw new ExitError(1);
		}

		if (!flags.keepBranch) {
			if (await deleteBranch(root, branch)) {
				console.log(`  ✓ Branch ${branch} deleted`);
			}
		} else {
			console.log(`  · Branch ${branch} kept (--keep-branch)`);
		}
	} finally {
		await releaseLock(root, slot);
	}
}
