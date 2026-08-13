import { $ } from "bun";
import type { Flags } from "./main";
import { listSlotInfo } from "./git";

export interface ChangeEntry {
	slot: number;
	branch: string | null;
	file: string;
	added: number;
	deleted: number;
	hunks: string;
	type: "working" | "committed" | "untracked";
}

function parseHunks(diff: string): string[] {
	const ranges: string[] = [];
	const re = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(diff)) !== null) {
		const start = parseInt(m[1], 10);
		const count = m[2] ? parseInt(m[2], 10) : 1;
		if (count === 1) ranges.push(`@${start}`);
		else ranges.push(`@${start}-${start + count - 1}`);
	}
	return ranges;
}

export async function collectSlotChanges(
	root: string,
	slot: number,
	branch: string | null,
	path: string,
): Promise<ChangeEntry[]> {
	const entries: ChangeEntry[] = [];

	if (branch && branch !== "main" && branch !== "HEAD") {
		const branchDiff = await $`git diff main...${branch} --numstat`
			.cwd(root)
			.quiet()
			.nothrow();
		if (branchDiff.stdout.toString().trim()) {
			for (const line of branchDiff.stdout.toString().trim().split("\n")) {
				const parts = line.split("\t");
				if (parts.length < 3) continue;
				const added = parseInt(parts[0], 10) || 0;
				const deleted = parseInt(parts[1], 10) || 0;
				const file = parts.slice(2).join("\t");
				const patch = await $`git diff main...${branch} --unified=0 -- ${file}`
					.cwd(root)
					.quiet()
					.nothrow();
				const hunks = parseHunks(patch.stdout.toString()).join(",");
				entries.push({
					slot,
					branch: branch || "(unknown)",
					file,
					added,
					deleted,
					hunks,
					type: "committed",
				});
			}
		}
	}

	const numstat = await $`git -C ${path} diff --numstat HEAD`.quiet().nothrow();
	if (numstat.stdout.toString().trim()) {
		for (const line of numstat.stdout.toString().trim().split("\n")) {
			const parts = line.split("\t");
			if (parts.length < 3) continue;
			const added = parseInt(parts[0], 10) || 0;
			const deleted = parseInt(parts[1], 10) || 0;
			const file = parts.slice(2).join("\t");
			const patch = await $`git -C ${path} diff --unified=0 HEAD -- ${file}`
				.quiet()
				.nothrow();
			const hunks = parseHunks(patch.stdout.toString()).join(",");
			entries.push({
				slot,
				branch: branch || "(unknown)",
				file,
				added,
				deleted,
				hunks,
				type: "working",
			});
		}
	}

	const untracked = await $`git -C ${path} status --short`.quiet().nothrow();
	if (untracked.stdout.toString().trim()) {
		for (const line of untracked.stdout.toString().trim().split("\n")) {
			const code = line.slice(0, 2);
			const file = line.slice(3).trim();
			if (code === "??") {
				entries.push({
					slot,
					branch: branch || "(unknown)",
					file,
					added: 0,
					deleted: 0,
					hunks: "(untracked)",
					type: "untracked",
				});
			}
		}
	}

	return entries;
}

export async function cmdDiff(root: string, flags: Flags): Promise<void> {
	let slots = await listSlotInfo(root);
	if (slots.length === 0) {
		console.log("No worktree slots with changes.");
		return;
	}

	if (flags.positional[1]) {
		const slotNum = parseInt(flags.positional[1], 10);
		if (!isNaN(slotNum)) slots = slots.filter((s) => s.slot === slotNum);
	}

	let allChanges: ChangeEntry[] = [];
	for (const s of slots) {
		const changes = await collectSlotChanges(root, s.slot, s.branch, s.path);
		allChanges = allChanges.concat(changes);
	}

	if (allChanges.length === 0) {
		console.log("No changes found across worktrees.");
		return;
	}

	if (flags.json) {
		console.log(JSON.stringify(allChanges, null, 2));
		return;
	}

	if (flags.patch) {
		for (const s of slots) {
			if (s.branch && s.branch !== "main" && s.branch !== "HEAD") {
				const branchPatch = await $`git diff main...${s.branch}`
					.cwd(root)
					.quiet()
					.nothrow();
				if (branchPatch.stdout.toString().trim()) {
					console.log(`\n=== Slot ${s.slot} (${s.branch}) committed ===`);
					console.log(branchPatch.stdout.toString().trimEnd());
				}
			}
			const patch = await $`git -C ${s.path} diff HEAD`.quiet().nothrow();
			if (patch.stdout.toString().trim()) {
				console.log(`\n=== Slot ${s.slot} (${s.branch}) working ===`);
				console.log(patch.stdout.toString().trimEnd());
			}
		}
		return;
	}

	console.log(formatDiffTable(allChanges));
}

export function formatDiffTable(changes: ChangeEntry[]): string {
	if (changes.length === 0) return "  (no changes)";
	const slotWidth = 4;
	const branchWidth = Math.max(
		8,
		...changes.map((c) => (c.branch || "").length),
	);
	const fileWidth = Math.max(10, ...changes.map((c) => c.file.length));
	const lines: string[] = [];
	lines.push(
		`${"Slot".padEnd(slotWidth)} ${"Branch".padEnd(branchWidth)} ${"File".padEnd(fileWidth)} ${"  +".padStart(4)} ${"  -".padStart(4)}  Hunks`,
	);
	lines.push("-".repeat(slotWidth + branchWidth + fileWidth + 24));
	for (const c of changes) {
		const marker =
			c.type === "committed" ? "C" : c.type === "untracked" ? "U" : "W";
		lines.push(
			`${String(c.slot).padEnd(slotWidth)} ${(c.branch || "").padEnd(branchWidth)} ${marker}  ${c.file.padEnd(fileWidth)} ${String(c.added).padStart(4)} ${String(c.deleted).padStart(4)}  ${c.hunks}`,
		);
	}
	return lines.join("\n");
}
