#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const cwd = process.cwd();
const gitDir = join(cwd, ".git");

function ask(query: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(query, (answer) => {
			rl.close();
			resolve(answer);
		});
	});
}

if (existsSync(gitDir)) {
	const answer = await ask(
		".git directory already exists. Delete and reinitialize? [y/N] ",
	);
	if (!answer.toLowerCase().startsWith("y")) {
		console.log("Aborted.");
		process.exit(0);
	}
	await $`rm -rf ${gitDir}`;
	console.log("Removed existing .git directory.");
}

const init = await $`git init`.cwd(cwd).nothrow();
if (init.exitCode !== 0) {
	console.error(init.stderr.toString().trim());
	process.exit(1);
}

const add = await $`git add .`.cwd(cwd).nothrow();
if (add.exitCode !== 0) {
	console.error(add.stderr.toString().trim());
	process.exit(1);
}

const diff = await $`git diff --cached --quiet`.cwd(cwd).nothrow();
if (diff.exitCode === 0) {
	console.log("nothing to add; skipping commit");
	process.exit(0);
}

await $`git commit -m "Initial commit"`.cwd(cwd);
