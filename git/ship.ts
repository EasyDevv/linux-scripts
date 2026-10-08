#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { canPick, pick } from "./picker.ts";

/* One color switch: only when both output streams are terminals and NO_COLOR is unset. */
const color = Boolean(process.stdout.isTTY && process.stderr.isTTY) && !process.env.NO_COLOR;
const sgr = (code: string) => (color ? `\x1b[${code}m` : "");
const RED = sgr("0;31");
const GREEN = sgr("0;32");
const YELLOW = sgr("1;33");
const BLUE = sgr("0;34");
const CYAN = sgr("0;36");
const BOLD = sgr("1");
const DIM = sgr("2");
const NC = sgr("0");

function help(): string {
	const head = (label: string) => `${sgr("1;36")}${label}${NC}`;
	const flag = (text: string) => `${GREEN}${text}${NC}`;
	const arg = (text: string) => `${DIM}${text}${NC}`;
	/* Flag column is padded on the plain text so ANSI codes do not skew the alignment. */
	const row = (flags: string, args: string, text: string) =>
		`  ${flag(flags)}${args ? ` ${arg(args)}` : ""}${" ".repeat(Math.max(2, 24 - flags.length - (args ? args.length + 1 : 0)))}${text}`;
	const note = (text: string) => `${" ".repeat(26)}${DIM}${text}${NC}`;

	return [
		`${BOLD}ship${NC} — stage, commit, and push in one step`,
		"",
		head("USAGE"),
		`  ship ${arg("[options]")}${" ".repeat(15)}commit every change and push`,
		`  ship repo ${arg("[name] [options]")}   connect or create a GitHub repo, then push`,
		"",
		head("COMMIT"),
		row("-m, --message", "<text>", "commit message"),
		note("default: names of the 5 most-changed files"),
		row("    --no-push", "", "commit only"),
		"",
		head("GITHUB"),
		row("    --repo", "[name]", "no remote → create or connect without asking"),
		note("name defaults to the repository directory"),
		row("    --public", "", "visibility of a new repository"),
		row("    --private", "", "(default)"),
		"",
		head("GENERAL"),
		row("-h, --help", "", "show this help"),
		"",
		head("NOTES"),
		"  On a clean tree, ship pushes commits that no remote has yet.",
		"  With no remote on a terminal, ship asks before creating a repository.",
		`  ${flag("ship repo")} replaces an existing origin; ${flag("ship --repo")} never does.`,
		"",
		head("EXAMPLES"),
		`  ship`,
		`  ship -m "Fix login redirect"`,
		`  ship --no-push`,
		`  ship --repo my-app --public`,
		`  ship repo`,
	].join("\n");
}

type Visibility = "private" | "public";

interface FileChange {
	filename: string;
	total: number;
}

function fail(message: string): never {
	console.error(`${RED}fatal: ${message}${NC}`);
	process.exit(1);
}

function parseCli() {
	return parseArgs({
		args: Bun.argv.slice(2),
		allowPositionals: true,
		options: {
			message: { type: "string", short: "m" },
			"no-push": { type: "boolean" },
			repo: { type: "boolean" },
			public: { type: "boolean" },
			private: { type: "boolean" },
			help: { type: "boolean", short: "h" },
		},
	});
}

let parsed: ReturnType<typeof parseCli>;
try {
	parsed = parseCli();
} catch (error) {
	console.error(`${RED}${(error as Error).message}${NC} ${DIM}(see ship --help)${NC}`);
	process.exit(2);
}
const { values: flags, positionals } = parsed;

if (flags.help) {
	console.log(help());
	process.exit(0);
}
if (flags.public && flags.private) fail("--public and --private are exclusive");

/* `ship repo [name]` takes the name as its second positional; `ship --repo [name]` as its only one. */
const subcommand = positionals[0] === "repo" ? "repo" : "ship";
const nameArg = subcommand === "repo" ? positionals[1] : positionals[0];
if (positionals.length > (subcommand === "repo" ? 2 : flags.repo ? 1 : 0)) {
	fail(`unexpected argument: ${positionals.join(" ")} (see ship --help)`);
}
const flagVisibility: Visibility | undefined = flags.public ? "public" : flags.private ? "private" : undefined;

const cwd = process.cwd();
const interactive = Boolean(process.stdin.isTTY);

function ask(query: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(query, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

const isRepo = await $`git rev-parse --git-dir`
	.cwd(cwd)
	.quiet()
	.then(() => true)
	.catch(() => false);
if (!isRepo) fail("not a git repository");

const gitRoot = (
	await $`git rev-parse --show-toplevel`.cwd(cwd).quiet().text()
).trim();

async function remotes(): Promise<string[]> {
	const out = await $`git remote`.cwd(cwd).quiet().nothrow().text();
	return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function pushUpstream(remote = "origin"): Promise<boolean> {
	const branch = (await $`git rev-parse --abbrev-ref HEAD`.cwd(cwd).quiet().text()).trim();
	console.log(`${CYAN}Pushing ${branch} to ${remote}...${NC}`);
	const result = await $`git push -u ${remote} ${branch}`.cwd(cwd).nothrow();
	return result.exitCode === 0;
}

/* --- GitHub --- */

async function ghLogin(): Promise<string> {
	if (!Bun.which("gh")) fail("GitHub CLI (gh) is not installed: https://cli.github.com/");
	const result = await $`gh api user --jq .login`.quiet().nothrow();
	if (result.exitCode !== 0) fail("gh is not signed in (run: gh auth login)");
	return result.text().trim();
}

async function repoUrl(full: string): Promise<string | null> {
	const result = await $`gh repo view ${full} --json url --jq .url`.quiet().nothrow();
	return result.exitCode === 0 ? result.text().trim() : null;
}

async function connectOrigin(url: string) {
	if (!/^(https?:\/\/github\.com\/|git@github\.com:)/.test(url)) {
		fail("refusing to set origin to a non-GitHub URL");
	}
	const has = await $`git remote get-url origin`.cwd(cwd).quiet().nothrow();
	if (has.exitCode === 0) {
		console.log(`${YELLOW}Updating origin to ${url}${NC}`);
		await $`git remote set-url origin ${url}`.cwd(cwd);
	} else {
		console.log(`${YELLOW}Adding origin ${url}${NC}`);
		await $`git remote add origin ${url}`.cwd(cwd);
	}
}

/** Point origin at <login>/<name>, creating the repository when it does not exist yet.
 *  Prompts on a TTY for whatever the flags left open. Does not push. */
async function setupGithub(name: string | undefined, visibility: Visibility | undefined): Promise<string> {
	const login = await ghLogin();
	let repoName = name ?? basename(gitRoot);
	if (!name && interactive) {
		repoName = (await ask(`${YELLOW}Repository name [${repoName}]: ${NC}`)) || repoName;
	}
	const full = `${login}/${repoName}`;

	console.log(`${CYAN}Checking ${full}...${NC}`);
	const existing = await repoUrl(full);
	if (existing) {
		console.log(`${GREEN}${full} already exists; connecting.${NC}`);
		await connectOrigin(existing);
		return existing;
	}

	let chosen = visibility;
	if (!chosen && canPick()) {
		const options: Visibility[] = ["private", "public"];
		const picked = await pick({
			title: `Visibility of ${full}`,
			items: [{ label: "private", hint: "(default)" }, { label: "public" }],
			color,
		});
		if (picked === null) fail("aborted; no repository was created");
		chosen = options[picked];
	}
	chosen ??= "private";

	console.log(`${CYAN}Creating ${full} (${chosen})...${NC}`);
	const created = await $`gh repo create ${full} --${chosen}`.nothrow();
	if (created.exitCode !== 0) fail("failed to create the repository");
	const url = await repoUrl(full);
	if (!url) fail(`created ${full}, but could not read its URL`);
	await connectOrigin(url);
	return url;
}

async function setupAndPush(): Promise<never> {
	const url = await setupGithub(nameArg, flagVisibility);
	if (!(await pushUpstream())) fail(`origin is ${url}, but pushing failed`);
	console.log(`${GREEN}Pushed.${NC} ${BLUE}${url}${NC}`);
	process.exit(0);
}

if (subcommand === "repo") await setupAndPush();

/* --- ship --- */

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
				fail("db:snapshot failed, aborting commit/push");
			}
			console.log("db:snapshot: ok");
		}
	} catch {
		/* ignore parse errors */
	}
}

async function commit(): Promise<boolean> {
	await $`git add .`.cwd(cwd);

	const numstat = await $`git diff --cached --numstat`.cwd(cwd).quiet().text();
	const fileLines = numstat.trim().split("\n").filter(Boolean);
	if (fileLines.length === 0) {
		console.log("nothing to commit, working tree clean");
		return false;
	}

	let message = flags.message?.trim();
	if (!message) {
		const changes: FileChange[] = [];
		for (const line of fileLines) {
			const parts = line.split("\t");
			if (parts.length < 3) continue;
			const [added, deleted, ...filenameParts] = parts;
			if (added === "-" || deleted === "-") continue;
			changes.push({
				filename: filenameParts.join("\t"),
				total: parseInt(added, 10) + parseInt(deleted, 10),
			});
		}
		if (changes.length === 0) {
			console.log("nothing to commit (only binary files changed)");
			return false;
		}
		changes.sort((a, b) => b.total - a.total);
		const top5 = changes.slice(0, 5).map((c) => c.filename.split("/").pop()!);
		const rest = changes.length - 5;
		message = rest > 0 ? `${top5.join(", ")} and ${rest} other${rest > 1 ? "s" : ""}` : top5.join(", ");
	}

	await $`git commit -m ${message}`.cwd(cwd);
	return true;
}

/** Commits on HEAD that no remote branch has yet. Zero without a remote. */
async function unpushed(): Promise<number> {
	const out = await $`git rev-list --count HEAD --not --remotes`.cwd(cwd).quiet().nothrow();
	return out.exitCode === 0 ? Number(out.text().trim()) || 0 : 0;
}

const committed = await commit();
if (flags["no-push"]) process.exit(0);
const known = await remotes();
/* A clean tree still ships commits made earlier (an agent, a manual commit);
   `--repo` still connects and pushes what is already committed. */
if (!committed && !flags.repo) {
	const ahead = known.length > 0 ? await unpushed() : 0;
	if (ahead === 0) process.exit(0);
	console.log(`${CYAN}${ahead} unpushed commit${ahead === 1 ? "" : "s"}${NC}`);
}

if (known.length === 0) {
	let setup = Boolean(flags.repo);
	if (!setup && interactive) {
		const answer = await ask(`${YELLOW}No remote configured. Create a GitHub repository? [Y/n] ${NC}`);
		setup = answer === "" || answer.toLowerCase().startsWith("y");
	}
	if (!setup) {
		console.error(`${YELLOW}no remote configured; skipping push (run: ship repo)${NC}`);
		process.exit(0);
	}
	await setupAndPush();
}

const pushResult = await $`git push`.cwd(cwd).nothrow();
if (pushResult.exitCode !== 0) {
	const errText = pushResult.stderr.toString();
	if (errText.includes("no upstream branch")) {
		if (!(await pushUpstream(known.includes("origin") ? "origin" : known[0]))) process.exit(1);
	} else {
		console.log(pushResult.stdout.toString());
		console.error(errText);
		process.exit(1);
	}
}
