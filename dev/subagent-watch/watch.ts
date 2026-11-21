#!/usr/bin/env bun
/**
 * subagent-watch: a Claude Code PreToolUse hook on Agent (async, asyncRewake) that checks the subagent every
 * SUBAGENT_WATCH_INTERVAL_S seconds (default 900 = 15 min). Each check builds a digest of the
 * subagent's transcript (time, tool mix, errors, denials, re-reads, edits, recent narration), flags
 * the patterns that wasted time before, and asks a separate judge (claude -p, sonnet) whether the
 * parent should let it continue, redirect it, split the work, or take it over. Anything but
 * "continue" exits 2: Claude Code wakes the parent with the verdict, and the parent can SendMessage
 * the agent id, TaskStop it, or do the rest itself. A finished agent ends the watch.
 *
 * Why: session dbaba518 (261121): a deletion subagent ran 45 min while the parent sat idle; it spent
 * 7 min working around classifier denials, loosened a test assertion, and drifted into redesigning a
 * page, all points where a check-in would have changed course.
 *
 *   hook:    stdin = PreToolUse input of an Agent call  (settings.json > hooks.PreToolUse, matcher Agent)
 *   replay:  bun watch.ts --replay <agent.jsonl> --at <minutes|ISO> [--no-judge]
 *
 * Env: SUBAGENT_WATCH_INTERVAL_S, SUBAGENT_WATCH_MAX_CHECKS (8), SUBAGENT_WATCH_MODEL (sonnet),
 * SUBAGENT_WATCH_OFF=1 disables; SUBAGENT_WATCH_JUDGE=1 marks the judge's own session (no watch);
 * SUBAGENT_WATCH_TEST_VERDICT=<verdict> skips the judge (to test the wake path).
 * Log: ~/.local/state/subagent-watch/log.jsonl (one line per check).
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const INTERVAL_S = Number(process.env.SUBAGENT_WATCH_INTERVAL_S ?? 900);
const MAX_CHECKS = Number(process.env.SUBAGENT_WATCH_MAX_CHECKS ?? 8);
const MODEL = process.env.SUBAGENT_WATCH_MODEL ?? "sonnet";
const STATE = join(homedir(), ".local/state/subagent-watch");

type Row = Record<string, any>;
export interface Digest {
	agentId: string;
	prompt: string;
	startedAt: string;
	at: string;
	minutes: number;
	idleMinutes: number;
	finished: boolean;
	calls: number;
	tools: Record<string, number>;
	errors: number;
	errorSamples: string[];
	denials: string[];
	rereads: [string, number][];
	repeated: [string, number][];
	written: string[];
	weakenedTests: string[];
	narration: string[];
	perBucket: Record<string, number>;
	flags: string[];
}

const ts = (r: Row) => (typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
const one = (s: string) => s.replace(/\s+/g, " ").trim();
const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((b) => (typeof b === "string" ? b : b?.type === "text" ? b.text : "")).join(" ");
}

export function digest(path: string, untilMs = Date.now()): Digest {
	const rows: Row[] = [];
	for (const line of readFileSync(path, "utf8").split("\n")) {
		if (!line) continue;
		try {
			const r = JSON.parse(line);
			if (!Number.isNaN(ts(r)) && ts(r) > untilMs) break;
			rows.push(r);
		} catch {}
	}
	const timed = rows.filter((r) => !Number.isNaN(ts(r)));
	const start = timed.length ? ts(timed[0] as Row) : untilMs;
	const last = timed.length ? ts(timed[timed.length - 1] as Row) : untilMs;
	const firstUser = rows.find((r) => r.type === "user");
	const prompt = one(textOf(firstUser?.message?.content));
	const tools: Record<string, number> = {};
	const callKey = new Map<string, number>();
	const reads = new Map<string, number>();
	const written = new Set<string>();
	const weakened: string[] = [];
	const errorSamples: string[] = [];
	const denials: string[] = [];
	const narration: string[] = [];
	const perBucket: Record<string, number> = {};
	let calls = 0;
	let errors = 0;
	let finished = false;
	for (const r of rows) {
		const c = r.message?.content;
		const min = Math.floor((ts(r) - start) / 60000);
		const at = "+" + min + "m ";
		if (r.type === "assistant" && Array.isArray(c)) {
			for (const b of c) {
				if (b.type === "text" && b.text?.trim()) narration.push(at + clip(one(b.text), 220));
				if (b.type !== "tool_use") continue;
				calls++;
				tools[b.name] = (tools[b.name] ?? 0) + 1;
				const bucket = String(Math.floor(min / 5) * 5).padStart(3, "0") + "m";
				perBucket[bucket] = (perBucket[bucket] ?? 0) + 1;
				const input = b.input ?? {};
				const key = b.name + " " + JSON.stringify(input).slice(0, 400);
				if (b.name !== "Poll") callKey.set(key, (callKey.get(key) ?? 0) + 1);
				const fp: string | undefined = input.file_path ?? input.path;
				if (b.name === "Read" && fp) reads.set(fp, (reads.get(fp) ?? 0) + 1);
				if ((b.name === "Edit" || b.name === "Write" || b.name === "MultiEdit") && fp) written.add(fp);
				const oldS = String(input.old_string ?? "");
				const newS = String(input.new_string ?? "");
				const checks = /assert|expect\(/g;
				if (fp && /test|spec/i.test(fp) && count(newS, checks) < count(oldS, checks)) weakened.push(at + basename(fp));
				const code = String(input.code ?? input.command ?? "");
				for (const m of code.matchAll(/\b(?:write|edit)\(\s*['"]([^'"]+)['"]/g)) written.add(m[1] as string);
			}
			finished = r.message?.stop_reason === "end_turn" && !c.some((b: Row) => b.type === "tool_use");
		}
		if (r.type === "user" && Array.isArray(c)) {
			for (const b of c) {
				if (b.type === "text" && /Request interrupted/.test(b.text ?? "")) finished = true;
				if (b.type !== "tool_result" || !b.is_error) continue;
				errors++;
				const t = one(textOf(b.content) || String(b.content ?? ""));
				if (/denied|classifier|doesn't want to proceed|hook error|refused/i.test(t)) denials.push(at + clip(t, 160));
				else if (errorSamples.length < 8) errorSamples.push(at + clip(t, 140));
			}
		}
	}
	const minutes = (untilMs - start) / 60000;
	const idleMinutes = (untilMs - last) / 60000;
	const rereads = [...reads].filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]).slice(0, 8);
	const repeated = [...callKey]
		.filter(([, n]) => n >= 3)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([k, n]) => [clip(k, 160), n] as [string, number]);
	const flags: string[] = [];
	if (denials.length >= 3)
		flags.push(denials.length + " permission/classifier/hook denials: is it working around a block instead of reporting it?");
	if (rereads.length)
		flags.push("re-reading files (" + rereads.map(([f, n]) => basename(f) + " x" + n).join(", ") + "): lost track, or the task needs a map first");
	if (repeated.length) flags.push("identical calls repeated (" + (repeated[0] as [string, number])[1] + "x)");
	if (weakened.length) flags.push("test assertions removed or loosened (" + weakened.join(", ") + ")");
	if (calls > 0 && errors / calls > 0.15) flags.push("error rate " + Math.round((100 * errors) / calls) + "%");
	if (idleMinutes > 10 && !finished) flags.push("no transcript activity for " + Math.round(idleMinutes) + " min: stalled or waiting on a long command");
	if (written.size > 25) flags.push(written.size + " files written: the task may be several tasks");
	return {
		agentId: basename(path).replace(/^agent-|\.jsonl$/g, ""),
		prompt: clip(prompt, 3000),
		startedAt: new Date(start).toISOString(),
		at: new Date(untilMs).toISOString(),
		minutes: Math.round(minutes * 10) / 10,
		idleMinutes: Math.round(idleMinutes * 10) / 10,
		finished,
		calls,
		tools,
		errors,
		errorSamples,
		denials: denials.slice(-8),
		rereads,
		repeated,
		written: [...written].slice(0, 40),
		weakenedTests: weakened,
		narration: narration.slice(-14),
		perBucket,
		flags,
	};
}

export interface Verdict {
	verdict: "continue" | "redirect" | "split" | "take_over" | "stop";
	reason: string;
	message_to_agent?: string;
	plan?: string;
}
const VERDICTS = ["continue", "redirect", "split", "take_over", "stop"];

const JUDGE = [
	"You review a Claude Code subagent that is still running, for the parent agent that launched it. Decide one verdict:",
	"- continue: it is making steady progress on what was asked, and the time fits the task's size.",
	"- redirect: it is off course (scope drift beyond the task, working around a block instead of reporting it, weakening tests or checks, looping, re-deriving what it already has); one message would fix it.",
	"- split: the remaining work is several independent parts that would finish sooner as parallel agents.",
	"- take_over: what remains is small, or blocked on something only the parent or user can do (a permission, a decision, a deletion); the parent should stop it and finish.",
	"- stop: it is doing something harmful or clearly against the task; stop now.",
	"Judge from the evidence only. Elapsed time alone is not a reason: a big task may need it. Prefer continue when unsure.",
	'Answer with one JSON object and nothing else: {"verdict":"continue|redirect|split|take_over|stop","reason":"<=2 sentences, cite evidence","message_to_agent":"for redirect: the exact course correction to send, else empty","plan":"for split/take_over: who does what next, else empty"}',
].join("\n");

export async function judge(d: Digest): Promise<Verdict | { error: string }> {
	mkdirSync(STATE, { recursive: true });
	const body = JUDGE + "\n\nDIGEST\n" + JSON.stringify(d, null, 1);
	const proc = Bun.spawn(
		["claude", "-p", "--model", MODEL, "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--output-format", "json"],
		{ stdin: new Blob([body]), stdout: "pipe", stderr: "pipe", env: { ...process.env, SUBAGENT_WATCH_JUDGE: "1" }, cwd: STATE },
	);
	const timer = setTimeout(() => proc.kill(), 180_000);
	const out = await new Response(proc.stdout).text();
	clearTimeout(timer);
	await proc.exited;
	try {
		const res = String(JSON.parse(out).result ?? "");
		const v = JSON.parse(res.match(/\{[\s\S]*\}/)?.[0] ?? "") as Verdict;
		if (!VERDICTS.includes(v.verdict)) throw new Error("bad verdict");
		return v;
	} catch {
		const err = out || (await new Response(proc.stderr).text());
		return { error: "judge failed (exit " + proc.exitCode + "): " + clip(err, 300) };
	}
}

export function wakeText(d: Digest, v: Verdict, agentType: string): string {
	const task = d.prompt.replace(/^\[[^\]]*\][^|]*\|\s*/, "");
	const lines = [
		"[subagent-watch] " + agentType + " subagent " + d.agentId + " has run " + Math.round(d.minutes) + " min (" + d.calls +
			" tool calls, " + d.errors + " errors). Judge (" + MODEL + ", separate context): " + v.verdict.toUpperCase() + " - " + v.reason,
		"Task: " + clip(task, 300),
	];
	if (d.flags.length) lines.push("Signals: " + d.flags.join("; "));
	if (v.message_to_agent) lines.push("Course correction to send: " + v.message_to_agent);
	if (v.plan) lines.push("Plan: " + v.plan);
	lines.push(
		'Decide now, then tell the user in one line what you chose: redirect -> SendMessage({to: "' + d.agentId +
			'", message}); split or take_over -> TaskStop the agent, then launch the parts in parallel or finish it yourself; stop -> TaskStop. If the evidence says otherwise, let it run and say why. The watch ends with this message.',
	);
	return lines.join("\n");
}

function log(row: Row) {
	try {
		mkdirSync(STATE, { recursive: true });
		appendFileSync(join(STATE, "log.jsonl"), JSON.stringify({ t: new Date().toISOString(), ...row }) + "\n");
	} catch {}
}

/** The subagent a parent Agent call started: its meta.json names the call's tool_use_id. */
function findAgent(dir: string, toolUseId: string): { path: string; meta: Row } | undefined {
	if (!existsSync(dir)) return undefined;
	for (const f of readdirSync(dir)) {
		if (!f.endsWith(".meta.json")) continue;
		try {
			const meta = JSON.parse(readFileSync(join(dir, f), "utf8"));
			if (meta.toolUseId === toolUseId) return { path: join(dir, f.replace(/\.meta\.json$/, ".jsonl")), meta };
		} catch {}
	}
	return undefined;
}

/**
 * PreToolUse hook on the parent's Agent call (async + asyncRewake). Not SubagentStart: Claude Code
 * writes a subagent's transcript only after its SubagentStart hooks exit, so a hook that stays up
 * there would hide the very transcript it reads (seen 261121: files born 0.1 s after the hook quit).
 */
async function hook(): Promise<number> {
	if (process.env.SUBAGENT_WATCH_OFF === "1" || process.env.SUBAGENT_WATCH_JUDGE === "1") return 0;
	const input = JSON.parse(await Bun.stdin.text()) as Row;
	if (input.agent_id) return 0; // an Agent call made inside a subagent: watch top-level work only
	const toolUseId = String(input.tool_use_id ?? "");
	const parent = String(input.transcript_path ?? "");
	if (!toolUseId || !parent) return 0;
	const type = String(input.tool_input?.subagent_type ?? "general-purpose");
	const dir = join(parent.replace(/\.jsonl$/, ""), "subagents");
	log({
		event: "start",
		toolUseId,
		type,
		description: input.tool_input?.description,
		background: input.tool_input?.run_in_background === true,
		parent,
		intervalS: INTERVAL_S,
	});
	let missing = 0;
	for (let check = 1; check <= MAX_CHECKS; check++) {
		await Bun.sleep(INTERVAL_S * 1000);
		const found = findAgent(dir, toolUseId);
		if (found === undefined || !existsSync(found.path)) {
			log({ event: "no-agent", toolUseId, check });
			if (++missing >= 3) return 0; // the call was refused, or the agent never started
			check--;
			continue;
		}
		const d = digest(found.path);
		const m = findAgent(dir, toolUseId)?.meta ?? found.meta;
		if (typeof m.description === "string") d.prompt = "(" + m.description + ") " + d.prompt;
		if (d.finished || m.finished === true) {
			log({ event: "finished", toolUseId, agentId: d.agentId, minutes: d.minutes });
			return 0;
		}
		const forced = process.env.SUBAGENT_WATCH_TEST_VERDICT as Verdict["verdict"] | undefined; // live wake test only
		const v = forced
			? { verdict: forced, reason: "forced by SUBAGENT_WATCH_TEST_VERDICT", message_to_agent: "Stop the loop now and reply DONE." }
			: await judge(d);
		log({ event: "check", toolUseId, agentId: d.agentId, check, minutes: d.minutes, flags: d.flags, verdict: v });
		if ("error" in v || v.verdict === "continue") continue; // fail-open: look again next interval
		process.stderr.write(wakeText(d, v, type) + "\n");
		return 2;
	}
	return 0;
}

async function replay(args: string[]): Promise<number> {
	const path = args[args.indexOf("--replay") + 1] as string;
	const atArg = args.includes("--at") ? (args[args.indexOf("--at") + 1] as string) : "";
	let until = Date.now();
	if (/^\d+(\.\d+)?$/.test(atArg)) {
		const first = readFileSync(path, "utf8")
			.split("\n")
			.map((l) => {
				try {
					return JSON.parse(l);
				} catch {
					return {};
				}
			})
			.find((r) => typeof r.timestamp === "string");
		until = Date.parse(first.timestamp) + Number(atArg) * 60000;
	} else if (atArg) until = Date.parse(atArg);
	const d = digest(path, until);
	const out: Row = { digest: { ...d, prompt: clip(d.prompt, 300) } };
	if (!args.includes("--no-judge")) {
		const v = await judge(d);
		out.verdict = v;
		if (!("error" in v)) out.wake = v.verdict === "continue" ? null : wakeText(d, v, "replay");
	}
	console.log(JSON.stringify(out, null, 1));
	return 0;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	process.exit(args.includes("--replay") ? await replay(args) : await hook());
}
