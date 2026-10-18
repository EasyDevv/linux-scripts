/**
 * `bun cache-report.ts [--days N] [--dir ~/.pi/agent/sessions]`: prompt-cache health of recent pi
 * sessions, from the `usage` pi records on every assistant message.
 *
 * A request is a break when its cached read falls below the previous request's whole prompt
 * (the prefix it could have reused) by more than `--slack` tokens: something before the new
 * messages changed (system prompt, tool set, model). Its excess is what the uncached part cost
 * over the cached price, at that request's own rates. A request on a different model than the
 * one before it is a switch, counted apart: its whole uncached input is the price of moving.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface Usage {
	input: number;
	cacheRead: number;
	cacheWrite: number;
	cost?: { input?: number; cacheRead?: number; total?: number };
}

interface Request {
	session: string;
	model: string;
	usage: Usage;
}

function arg(name: string, fallback: string): string {
	const at = process.argv.indexOf(`--${name}`);
	return at > 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

function files(dir: string, since: number): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, name.name);
		if (name.isDirectory()) out.push(...files(path, since));
		else if (name.name.endsWith(".jsonl") && statSync(path).mtimeMs >= since) out.push(path);
	}
	return out;
}

function requests(path: string): Request[] {
	const out: Request[] = [];
	let model = "?";
	for (const line of readFileSync(path, "utf8").split("\n")) {
		if (!line) continue;
		let e: Record<string, unknown>;
		try {
			e = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (e.type === "model_change") model = `${e.provider}/${e.modelId}`;
		const m = e.message as { role?: string; usage?: Usage } | undefined;
		if (m?.role === "assistant" && m.usage && typeof m.usage.input === "number") {
			out.push({ session: path, model, usage: m.usage });
		}
	}
	return out;
}

const days = Number(arg("days", "7"));
const slack = Number(arg("slack", "4096"));
const dir = arg("dir", join(homedir(), ".pi/agent/sessions"));
const all = files(dir, Date.now() - days * 86_400_000);

let total = 0;
let cached = 0;
let cost = 0;
let breaks = 0;
let excess = 0;
let switches = 0;
let switchExcess = 0;
const byModel = new Map<string, { breaks: number; excess: number }>();
for (const file of all) {
	const list = requests(file);
	for (let i = 0; i < list.length; i++) {
		const { usage: u, model } = list[i] as Request;
		const prompt = u.input + u.cacheRead + u.cacheWrite;
		total += prompt;
		cached += u.cacheRead;
		cost += u.cost?.total ?? 0;
		const prev = list[i - 1]?.usage;
		if (!prev) continue;
		if (list[i - 1]?.model !== model) {
			const perIn = u.input > 0 ? (u.cost?.input ?? 0) / u.input : 0;
			switches += 1;
			switchExcess += u.input * perIn * 0.98;
			continue;
		}
		const reusable = prev.input + prev.cacheRead + prev.cacheWrite;
		const lost = reusable - u.cacheRead;
		if (lost <= slack || u.input <= 0) continue;
		const perIn = (u.cost?.input ?? 0) / u.input;
		const perCached = u.cacheRead > 0 ? (u.cost?.cacheRead ?? 0) / u.cacheRead : perIn * 0.02;
		const waste = lost * Math.max(0, perIn - perCached);
		breaks += 1;
		excess += waste;
		const row = byModel.get(model) ?? { breaks: 0, excess: 0 };
		row.breaks += 1;
		row.excess += waste;
		byModel.set(model, row);
	}
}

console.log(`sessions ${all.length} · last ${days}d · ${dir}`);
console.log(`prompt tokens ${total} · cached ${total ? ((cached / total) * 100).toFixed(1) : "0"}%`);
console.log(
	`cost $${cost.toFixed(4)} · breaks ${breaks} · break excess $${excess.toFixed(4)} (${cost ? ((excess / cost) * 100).toFixed(1) : "0"}%)`,
);
console.log(`model switches ${switches} · switch excess ~$${switchExcess.toFixed(4)}`);
for (const [model, row] of [...byModel].sort((a, b) => b[1].excess - a[1].excess)) {
	console.log(`  ${model}: ${row.breaks} breaks, $${row.excess.toFixed(4)}`);
}
