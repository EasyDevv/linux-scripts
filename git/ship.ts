#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";

interface FileChange {
	filename: string;
	total: number;
}

const cwd = process.cwd();

const isRepo = await $`git rev-parse --git-dir`
	.cwd(cwd)
	.quiet()
	.then(() => true)
	.catch(() => false);
if (!isRepo) {
	console.error("fatal: not a git repository");
	process.exit(1);
}

const gitRoot = (
	await $`git rev-parse --show-toplevel`.cwd(cwd).quiet().text()
).trim();

const pkgPath = join(gitRoot, "package.json");
if (existsSync(pkgPath)) {
	try {
		const pkg = JSON.parse(await Bun.file(pkgPath).text());
		if (pkg?.scripts?.["db:snapshot"]) {
			console.log("db:snapshot: running...");
			const result = await $`bun run db:snapshot`.cwd(gitRoot).nothrow();
			if (result.exitCode !== 0) {
				const err = result.stderr.toString();
				if (err) console.error(err);
				console.error("fatal: db:snapshot failed, aborting commit/push");
				process.exit(1);
			}
			console.log("db:snapshot: ok");
		}
	} catch {
		/* ignore parse errors */
	}
}

await $`git add .`.cwd(cwd);

const numstat = await $`git diff --cached --numstat`.cwd(cwd).quiet().text();
const fileLines = numstat.trim().split("\n").filter(Boolean);

if (fileLines.length === 0) {
	console.log("nothing to commit, working tree clean");
	process.exit(0);
}

const changes: FileChange[] = [];

for (const line of fileLines) {
	const parts = line.split("\t");
	if (parts.length < 3) continue;

	const [added, deleted, ...filenameParts] = parts;
	const filename = filenameParts.join("\t");

	if (added === "-" || deleted === "-") continue;

	changes.push({
		filename,
		total: parseInt(added, 10) + parseInt(deleted, 10),
	});
}

if (changes.length === 0) {
	console.log("nothing to commit (only binary files changed)");
	process.exit(0);
}

changes.sort((a, b) => b.total - a.total);

const totalCount = changes.length;
const top5 = changes.slice(0, 5).map((c) => c.filename.split("/").pop()!);

let message: string;
if (totalCount <= 5) {
	message = top5.join(", ");
} else {
	message = `${top5.join(", ")} and ${totalCount - 5} other${totalCount - 5 > 1 ? "s" : ""}`;
}

await $`git commit -m ${message}`.cwd(cwd);

const pushResult = await $`git push`.cwd(cwd).nothrow();
if (pushResult.exitCode !== 0) {
	const errText = pushResult.stderr.toString();
	if (errText.includes("No configured push destination")) {
		console.error("fatal: no remote configured; skipping push");
	} else if (errText.includes("no upstream branch")) {
		const branch = await $`git rev-parse --abbrev-ref HEAD`
			.cwd(cwd)
			.quiet()
			.text();
		const retry = await $`git push --set-upstream origin ${branch.trim()}`
			.cwd(cwd)
			.nothrow();
		if (retry.exitCode !== 0) {
			console.error(retry.stderr.toString());
		}
	} else {
		const outText = pushResult.stdout.toString();
		console.log(outText);
		console.error(errText);
	}
}
