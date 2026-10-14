import { readdir, readFile, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";

import type { Tab } from "./cdp.ts";
import { globalProfileDir } from "./chrome-instance.ts";
import { classifyKey, colorOn, interactive, paint, Term } from "./ui.ts";

export type Engine = "chromium" | "obscura";

export type BrowserRow = {
	engine: Engine;
	pid: number;
	port: number | null;
	/** chromium: profile label · obscura: serve / fetch / scrape / mcp */
	kind: string;
	userDataDir: string | null;
	/** systemd unit that owns it (chrome.service); closing stops the unit */
	unit: string | null;
	/** obscura: --storage-dir session name, or the fetch URL */
	note: string | null;
	tabs: Array<Pick<Tab, "title" | "url">>;
};

export type Proc = { pid: number; argv: string[]; cgroup: string; cwd: string | null };

async function readProcs(): Promise<Proc[]> {
	const procs: Proc[] = [];
	for (const entry of await readdir("/proc")) {
		if (!/^\d+$/.test(entry)) continue;
		const pid = Number(entry);
		try {
			const raw = await readFile(`/proc/${pid}/cmdline`, "utf8");
			if (!raw) continue;
			let argv = raw.replace(/\0+$/, "").split("\0");
			// Chromium rewrites its cmdline as one space-joined string.
			if (argv.length === 1) argv = argv[0].split(" ");
			const cgroup = await readFile(`/proc/${pid}/cgroup`, "utf8").catch(() => "");
			const cwd = await readlink(`/proc/${pid}/cwd`).catch(() => null);
			procs.push({ pid, argv, cgroup, cwd });
		} catch {
			// Process exited mid-scan.
		}
	}
	return procs;
}

function flag(argv: string[], name: string): string | null {
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === name) return argv[i + 1] ?? null;
		if (argv[i].startsWith(`${name}=`)) return argv[i].slice(name.length + 1);
	}
	return null;
}

/** The user unit a process runs in, when it is a `.service` (not a scope or user@). */
export function serviceUnit(cgroup: string): string | null {
	const leaf = cgroup.trim().split("/").pop() ?? "";
	return leaf.endsWith(".service") && !leaf.startsWith("user@") ? leaf : null;
}

function tilde(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function profileLabel(port: number, dir: string | null): string {
	if (!dir) return "unknown profile";
	if (dir === globalProfileDir(port)) return "global profile";
	if (/\/browser-clean-/.test(dir)) return "clean profile";
	return tilde(dir);
}

const OBSCURA_COMMANDS = new Set(["serve", "fetch", "scrape", "mcp"]);

export function rowsFromProcs(procs: Proc[]): Omit<BrowserRow, "tabs">[] {
	const others: Omit<BrowserRow, "tabs">[] = [];
	const chromium = new Map<number, Omit<BrowserRow, "tabs">>();
	const units = new Map<number, string>();

	for (const p of procs) {
		if (basename(p.argv[0] ?? "") === "obscura") {
			const cmd = p.argv.slice(1).find((a) => OBSCURA_COMMANDS.has(a));
			if (!cmd) continue;
			const storage = flag(p.argv, "--storage-dir");
			const url = cmd === "fetch" ? (p.argv[p.argv.indexOf("fetch") + 1] ?? null) : null;
			others.push({
				engine: "obscura",
				pid: p.pid,
				port: cmd === "serve" ? Number(flag(p.argv, "--port") ?? 9222) : null,
				kind: cmd,
				userDataDir: null,
				unit: serviceUnit(p.cgroup),
				note: storage ? `session ${basename(storage)}` : url,
			});
			continue;
		}
		const port = Number(flag(p.argv, "--remote-debugging-port"));
		if (!port) continue;
		// Chromium moves its main process into a scope; the unit shows on its children.
		const unit = serviceUnit(p.cgroup);
		if (unit) units.set(port, unit);
		if (p.argv.some((a) => a.startsWith("--type=")) || chromium.has(port)) continue;
		const dir = flag(p.argv, "--user-data-dir");
		const userDataDir = dir ? resolve(p.cwd ?? "/", dir) : null;
		chromium.set(port, {
			engine: "chromium",
			pid: p.pid,
			port,
			kind: profileLabel(port, userDataDir),
			userDataDir,
			unit: null,
			note: null,
		});
	}
	for (const [port, row] of chromium) row.unit = units.get(port) ?? null;
	const order = (r: Omit<BrowserRow, "tabs">) =>
		(r.engine === "chromium" ? 0 : 1e6) + (r.port ?? 99_999);
	return [...chromium.values(), ...others].sort((a, b) => order(a) - order(b));
}

async function pageTabs(port: number | null): Promise<BrowserRow["tabs"]> {
	if (!port) return [];
	try {
		const all = (await (
			await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
		).json()) as Tab[];
		return all.filter((t) => t.type === "page").map(({ title, url }) => ({ title, url }));
	} catch {
		return []; // still starting, or no /json/list
	}
}

export async function scanBrowsers(): Promise<BrowserRow[]> {
	const base = rowsFromProcs(await readProcs());
	return await Promise.all(base.map(async (r) => ({ ...r, tabs: await pageTabs(r.port) })));
}

// ── render ──────────────────────────────────────────────────────────

const ENGINE_COLOR = { chromium: "blue", obscura: "magenta" } as const;

function cells(r: BrowserRow): { port: string; what: string; tabs: string } {
	const what = [r.unit, r.kind, r.note].filter(Boolean).join(" · ");
	const first = r.tabs[0];
	const label = first ? first.title || first.url : r.engine === "chromium" ? "(no tabs)" : "";
	const more = r.tabs.length > 1 ? `  +${r.tabs.length - 1}` : "";
	return { port: r.port ? `:${r.port}` : "—", what, tabs: `${label}${more}` };
}

function clip(text: string, width: number): string {
	return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

/** `engine  :port  what  first-tab +N`, columns aligned across rows. */
export function plainLines(rows: BrowserRow[], on = colorOn(), engineColumn = true): string[] {
	const what = Math.max(...rows.map((r) => cells(r).what.length));
	return rows.map((r) => {
		const c = cells(r);
		return [
			...(engineColumn ? [paint(r.engine.padEnd(8), [ENGINE_COLOR[r.engine]], on)] : []),
			paint(c.port.padEnd(6), ["bold"], on),
			c.what.padEnd(what),
			paint(c.tabs, ["dim"], on),
		].join("  ");
	});
}

function frame(rows: BrowserRow[], cursor: number, status: string): string[] {
	const on = colorOn(process.stderr);
	const width = (process.stderr.columns || 100) - 3;
	const lines = plainLines(rows, false, false);
	const out: string[] = [];
	for (const engine of ["chromium", "obscura"] as const) {
		const idx = rows.flatMap((r, i) => (r.engine === engine ? [i] : []));
		if (!idx.length) continue;
		out.push(paint(`${engine === "chromium" ? "Chromium" : "obscura"} (${idx.length})`, ["bold", ENGINE_COLOR[engine]], on));
		for (const i of idx) {
			const text = clip(lines[i], width);
			out.push(i === cursor ? `${paint(">", ["bold"], on)} ${paint(text, ["bold"], on)}` : `  ${text}`);
		}
	}
	if (status) out.push(status);
	out.push(paint("↑/↓ j/k move  x close  enter tabs  q quit", ["dim"], on));
	return out;
}

// ── close ───────────────────────────────────────────────────────────

export function describe(r: BrowserRow): string {
	return `${r.engine} ${r.port ? `:${r.port}` : `pid ${r.pid}`}${r.unit ? ` (${r.unit})` : ""}`;
}

async function waitGone(pid: number, ms: number): Promise<boolean> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		try {
			process.kill(pid, 0);
		} catch {
			return true;
		}
		await Bun.sleep(100);
	}
	return false;
}

/** Close one row. Service-owned rows stop their unit so systemd does not respawn them. */
export async function closeRow(r: BrowserRow): Promise<string> {
	if (r.unit) {
		const p = Bun.spawnSync(["systemctl", "--user", "stop", r.unit]);
		const why = `${p.stderr}`.trim().split("\n")[0];
		return p.exitCode === 0 ? `✓ stopped ${r.unit}` : `✗ systemctl --user stop ${r.unit}: ${why}`;
	}
	if (r.engine === "chromium" && r.port) {
		// `browser close` saves a global profile's session and removes a --clean profile.
		// No --pid: the launch record in the profile dir carries the --clean flag.
		const args = ["close", "--port", String(r.port)];
		if (r.userDataDir) args.push("--user-data", r.userDataDir);
		const p = Bun.spawnSync([process.execPath, `${import.meta.dir}/main.ts`, ...args], {
			env: { ...process.env, NO_COLOR: "1" },
		});
		const first = `${p.stdout}${p.stderr}`.trim().split("\n")[0] ?? "";
		return first || (p.exitCode === 0 ? `✓ closed ${describe(r)}` : "✗ close failed");
	}
	try {
		process.kill(r.pid, "SIGTERM");
	} catch {
		return `✓ ${describe(r)} already gone`;
	}
	if (!(await waitGone(r.pid, 3000))) process.kill(r.pid, "SIGKILL");
	return `✓ stopped ${describe(r)}`;
}

// ── picker ──────────────────────────────────────────────────────────

/** Two rows, default No; destructive Yes is red. Abort equals No. */
async function confirm(term: Term, base: string[], question: string): Promise<boolean> {
	const on = colorOn(process.stderr);
	let yes = false;
	for (;;) {
		term.draw([
			...base,
			paint(question, ["bold"], on),
			`${yes ? " " : paint(">", ["bold"], on)} ${paint("No", yes ? [] : ["bold"], on)}`,
			`${yes ? paint(">", ["bold"], on) : " "} ${paint("Yes, close it", yes ? ["bold", "red"] : ["red"], on)}`,
		]);
		const k = classifyKey(await term.key());
		if (k === "up" || k === "first") yes = false;
		else if (k === "down" || k === "last") yes = true;
		else if (k === "enter") return yes;
		else if (k === "abort") return false;
		else if (typeof k === "object" && k?.char === "y") return true;
		else if (typeof k === "object" && k?.char === "n") return false;
	}
}

async function pick(initial: BrowserRow[]): Promise<void> {
	let rows = initial;
	let cursor = 0;
	let status = "";
	const on = colorOn(process.stderr);
	const term = new Term();
	term.open();
	try {
		for (;;) {
			if (!rows.length) {
				term.draw([...(status ? [status] : []), paint("no browsers left", ["dim"], on)]);
				return;
			}
			cursor = Math.min(cursor, rows.length - 1);
			const base = frame(rows, cursor, status);
			term.draw(base);
			const k = classifyKey(await term.key());
			if (k === "abort") return;
			if (k === "up") cursor = Math.max(0, cursor - 1);
			else if (k === "down") cursor = Math.min(rows.length - 1, cursor + 1);
			else if (k === "first") cursor = 0;
			else if (k === "last") cursor = rows.length - 1;
			else if (k === "enter") {
				term.close();
				const r = rows[cursor];
				console.log(describe(r));
				for (const t of r.tabs) console.log(`  ${t.title || "(untitled)"}\n    ${t.url}`);
				return;
			} else if (typeof k === "object" && k && (k.char === "x" || k.char === "d")) {
				const r = rows[cursor];
				const body = base.slice(0, -1);
				const question = r.unit ? `Stop ${r.unit} (${r.engine} :${r.port})?` : `Close ${describe(r)}?`;
				if (await confirm(term, body, question)) {
					term.draw([...body, paint(`closing ${describe(r)}…`, ["dim"], on)]);
					status = await closeRow(r);
					rows = await scanBrowsers();
				} else status = "";
			}
		}
	} finally {
		term.close();
	}
}

export async function main(argv: string[]): Promise<void> {
	const rows = await scanBrowsers();
	if (argv.includes("--json")) {
		console.log(JSON.stringify(rows, null, 2));
		return;
	}
	if (!rows.length) {
		console.log("no browsers (obscura or Chromium)");
		return;
	}
	if (argv.includes("--plain") || !interactive()) {
		for (const line of plainLines(rows)) console.log(line);
		return;
	}
	await pick(rows);
}
