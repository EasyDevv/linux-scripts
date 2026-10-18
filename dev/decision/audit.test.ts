import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	deriveSignals,
	efficiency,
	manualModelChanges,
	parseClaudeTranscript,
	parseLogLines,
	parsePiTranscript,
	parseSince,
	renderAudit,
	runAudit,
	similarPrompts,
	skillsUsed,
	tally,
	toolMatches,
	turnsOf,
	writeCandidates,
	type LogData,
	type TEvent,
	type Transcript,
} from "./audit.ts";
import { clip, maskSecrets } from "./mask.ts";

const T0 = Date.parse("2026-10-18T02:00:00.000Z");
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();

function logOf(lines: Record<string, unknown>[]): LogData {
	return parseLogLines(
		lines.map((l) => JSON.stringify(l)),
		0,
	);
}

function result(sec: number, extra: Record<string, unknown>) {
	return { ts: at(sec), type: "result", status: "routed", harness: "pi", sessionId: "S1", ...extra };
}

const locateWith = (t: Transcript | undefined) => () => t;
const pi = (events: TEvent[]): Transcript => ({ harness: "pi", sessionId: "S1", cwd: "/work", events });
const user = (sec: number, text: string): TEvent => ({ kind: "user", ts: T0 + sec * 1000, text });
const assistant = (sec: number, text: string): TEvent => ({ kind: "assistant", ts: T0 + sec * 1000, text });
const tool = (sec: number, name: string, input: unknown): TEvent => ({
	kind: "tool",
	ts: T0 + sec * 1000,
	name,
	input,
});
const change = (sec: number, model: string): TEvent => ({ kind: "model_change", ts: T0 + sec * 1000, model });
const route = (sec: number, decisionId: string, model?: string): TEvent => ({
	kind: "route",
	ts: T0 + sec * 1000,
	decisionId,
	model,
});

describe("log parsing", () => {
	test("classifies lines, drops old and broken ones, and infers a feature for bare outcomes", () => {
		const data = parseLogLines(
			[
				JSON.stringify({
					ts: at(0),
					type: "decide",
					feature: "model_route",
					harness: "pi",
					status: "ok",
					costUsd: 0.01,
					latencyMs: 300,
					cached: false,
					backend: "jev",
					decisionId: "d1",
				}),
				JSON.stringify(result(1, { feature: "model_route", decisionId: "d1", tier: "quick", currentModel: "a/b" })),
				JSON.stringify({ ts: at(2), type: "outcome", decisionId: "d1", signal: "applied", detail: { tier: "quick" } }),
				JSON.stringify({ ts: "2020-01-01T00:00:00Z", type: "result", feature: "x" }),
				"not json",
				"",
			],
			T0,
		);
		expect(data.decides).toHaveLength(1);
		expect(data.results[0]).toMatchObject({
			feature: "model_route",
			decisionId: "d1",
			sessionId: "S1",
			currentModel: "a/b",
		});
		expect(data.outcomes[0]).toMatchObject({ feature: "model_route", signal: "applied" });
	});

	test("parseSince reads relative windows and dates", () => {
		expect(parseSince("2d", 10 * 86_400_000)).toBe(8 * 86_400_000);
		expect(parseSince("12h", 86_400_000)).toBe(86_400_000 - 12 * 3_600_000);
		expect(parseSince("2026-10-01")).toBe(Date.parse("2026-10-01"));
		expect(() => parseSince("soon")).toThrow("--since");
	});
});

describe("transcript parsing", () => {
	test("pi: user, assistant text and toolCalls, model_change, decision-route", () => {
		const t = parsePiTranscript("S1", [
			{ type: "session", cwd: "/work", timestamp: at(0) },
			{ type: "model_change", provider: "opencode-go", modelId: "flash", timestamp: at(1) },
			{
				type: "custom",
				customType: "decision-route",
				data: { decisionId: "d1", model: "opencode-go/flash", tier: "quick" },
				timestamp: at(2),
			},
			{ type: "message", message: { role: "user", content: [{ type: "text", text: "hello" }] }, timestamp: at(3) },
			{
				type: "message",
				message: {
					role: "assistant",
					provider: "opencode-go",
					model: "flash",
					content: [
						{ type: "text", text: "hi" },
						{ type: "toolCall", name: "read", arguments: { path: "/x" } },
					],
				},
				timestamp: at(4),
			},
			{ type: "message", message: { role: "system", content: "" }, timestamp: at(5) },
		]);
		expect(t.cwd).toBe("/work");
		expect(t.events.map((e) => e.kind)).toEqual(["model_change", "route", "user", "assistant", "tool"]);
		expect(t.events[0]).toMatchObject({ model: "opencode-go/flash" });
		expect(t.events[1]).toMatchObject({ decisionId: "d1", model: "opencode-go/flash" });
	});

	test("claude: skips meta, sidechain, reminders and tool results; synthesizes model switches", () => {
		const t = parseClaudeTranscript("S2", [
			{
				type: "user",
				cwd: "/p",
				timestamp: at(0),
				message: { role: "user", content: "<system-reminder>x</system-reminder>\nfix the bug" },
			},
			{ type: "user", isMeta: true, timestamp: at(1), message: { role: "user", content: "caveat" } },
			{
				type: "user",
				timestamp: at(1),
				message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] },
			},
			{
				type: "assistant",
				timestamp: at(2),
				message: {
					model: "claude-a",
					content: [{ type: "tool_use", name: "Skill", input: { skill: "write-a-rule" } }],
				},
			},
			{
				type: "assistant",
				isSidechain: true,
				timestamp: at(3),
				message: { model: "claude-z", content: [{ type: "text", text: "side" }] },
			},
			{ type: "user", timestamp: at(4), message: { role: "user", content: [{ type: "text", text: "next" }] } },
			{
				type: "assistant",
				timestamp: at(5),
				message: { model: "claude-b", content: [{ type: "text", text: "done" }] },
			},
		]);
		expect(t.cwd).toBe("/p");
		expect(t.events.filter((e) => e.kind === "user").map((e) => (e as { text: string }).text)).toEqual([
			"fix the bug",
			"next",
		]);
		expect(t.events.filter((e) => e.kind === "model_change")).toHaveLength(1);
		expect(t.events.some((e) => e.kind === "tool" && e.name === "Skill")).toBe(true);
	});
});

describe("building blocks", () => {
	test("similarPrompts catches repeats but not short or different prompts", () => {
		expect(similarPrompts("Fix the failing test please", "fix the failing test, please!")).toBe(true);
		expect(similarPrompts("fix the failing auth test in server", "fix the failing auth test in the server")).toBe(true);
		expect(similarPrompts("ok", "ok")).toBe(true);
		expect(similarPrompts("fix the failing test", "write a poem about the sea")).toBe(false);
		expect(similarPrompts("go on", "go now")).toBe(false);
	});

	test("manualModelChanges ignores the route's own change and no-op repeats", () => {
		const events: TEvent[] = [
			change(0, "m/initial"),
			user(1, "first"),
			change(2, "m/flash"),
			route(3, "d1", "m/flash"),
			change(3.1, "m/flash"),
			assistant(4, "x"),
			change(5, "m/big"),
			user(9, "second"),
		];
		const turns = turnsOf(events);
		expect(turns).toHaveLength(2);
		expect(manualModelChanges(events, turns[0].start, turns[0].end)).toEqual([
			{ ts: T0 + 5000, from: "m/flash", to: "m/big" },
		]);
		expect(manualModelChanges(events, 0, 2)).toEqual([]);
	});

	test("skillsUsed sees SKILL.md reads, shell cats, and Skill calls, but not edits", () => {
		const used = skillsUsed([
			tool(1, "read", { path: "/home/u/.agents/skills/build-frontend/SKILL.md" }),
			tool(2, "Read", { file_path: "/home/u/.claude/skills/write-a-rule/SKILL.md" }),
			tool(3, "bash", { command: "cat ~/.agents/skills/improve-skill/SKILL.md | head" }),
			tool(4, "Skill", { skill: "plug:learn" }),
			tool(5, "edit", { path: "/home/u/.agents/skills/browser/SKILL.md" }),
			tool(6, "bash", { command: "ls ~/.agents/skills/*/SKILL.md" }),
		]);
		expect([...used].sort()).toEqual(["build-frontend", "improve-skill", "learn", "write-a-rule"]);
	});

	test("toolMatches handles MCP prefixes", () => {
		expect(toolMatches("mcp__serena__find_symbol", "find_symbol")).toBe(true);
		expect(toolMatches("Bash", "bash")).toBe(true);
		expect(toolMatches("find_symbol_x", "find_symbol")).toBe(false);
	});
});

describe("model_route signals", () => {
	const base = [
		change(0, "m/start"),
		change(2, "m/flash"),
		route(3, "d1", "m/flash"),
		user(3.1, "refactor the parser module to split lexing out"),
	];

	test("a quiet turn is ok and yields no candidate", () => {
		const log = logOf([result(2.5, { feature: "model_route", decisionId: "d1", tier: "standard" })]);
		const d = deriveSignals(log, locateWith(pi([...base, assistant(5, "a".repeat(900)), tool(6, "read", {})])), [
			"model_route",
		]);
		expect(d.judged).toEqual([expect.objectContaining({ joined: true, wrong: false })]);
		expect(d.findings).toEqual([]);
		expect(d.candidates).toEqual([]);
	});

	test("manual change after the route, a repeat, and premium for a short answer", () => {
		const log = logOf([
			result(2.5, { feature: "model_route", decisionId: "d1", tier: "premium", currentModel: "m/start" }),
		]);
		const events = [
			...base,
			assistant(5, "Done."),
			change(6, "m/big"),
			user(40, "refactor the parser module to split lexing out!"),
		];
		const d = deriveSignals(log, locateWith(pi(events)), ["model_route"]);
		expect(d.findings.map((f) => f.signal).sort()).toEqual(["manual_model_change", "premium_short", "repeat_request"]);
		expect(d.candidates).toHaveLength(1);
		expect(d.candidates[0].case).toMatchObject({
			input: { prompt: "refactor the parser module to split lexing out", cwd: "/work", currentModel: "m/start" },
			expected: "high",
			source: "S1",
		});
		expect(d.candidates[0].case.note).toContain("premium_short");
	});

	test("premium with tool use is not a short answer; an unlabelled wrong case gets a null label", () => {
		const log = logOf([result(2.5, { feature: "model_route", decisionId: "d1", tier: "premium" })]);
		const events = [...base, assistant(5, "ok"), tool(5, "bash", {}), change(7, "m/other")];
		const d = deriveSignals(log, locateWith(pi(events)), ["model_route"]);
		expect(d.findings.map((f) => f.signal)).toEqual(["manual_model_change"]);
		expect(d.candidates[0].case.expected).toBeNull();
		expect(d.candidates[0].case.note).toContain("label needed");
	});

	test("a decision with no transcript is counted as unjoined, with no verdict", () => {
		const log = logOf([result(2.5, { feature: "model_route", decisionId: "d1", tier: "quick" })]);
		const d = deriveSignals(log, locateWith(undefined), ["model_route"]);
		expect(d.judged).toEqual([expect.objectContaining({ joined: false, wrong: false })]);
	});

	test("claude decisions join by time and use model switches synthesized from the assistant", () => {
		const events = [
			user(0, "explain the build"),
			{ ...assistant(2, "claude-a answer"), model: "claude-a" } as TEvent,
			change(10, "claude-b"),
			user(30, "next thing"),
		];
		const log = logOf([
			result(0.5, { feature: "model_route", decisionId: "c1", tier: "quick", harness: "claude", sessionId: "S2" }),
		]);
		const t: Transcript = { harness: "claude", sessionId: "S2", events };
		const d = deriveSignals(log, locateWith(t), ["model_route"]);
		expect(d.findings.map((f) => f.signal)).toEqual(["manual_model_change"]);
	});
});

describe("find_skill signals", () => {
	test("recommended and used, noise, and missed", () => {
		const log = logOf([
			result(1, {
				feature: "find_skill",
				decisionId: "s1",
				skills: [
					{ name: "build-frontend", p: 0.9 },
					{ name: "browser", p: 0.6 },
				],
				rules: [],
			}),
			{ ts: at(3), type: "outcome", decisionId: "s1", signal: "used", detail: { name: "build-frontend" } },
		]);
		const events = [
			user(1, "make the dashboard card prettier"),
			tool(4, "read", { path: "/h/.agents/skills/write-a-rule/SKILL.md" }),
			assistant(8, "done"),
		];
		const d = deriveSignals(log, locateWith(pi(events)), ["find_skill"]);
		const by = Object.fromEntries(d.findings.map((f) => [f.signal + ":" + f.detail.split(" ")[0], f.verdict]));
		expect(by).toEqual({ "used:build-frontend": "ok", "noise:browser": "wrong", "missed:write-a-rule": "wrong" });
		expect(d.candidates[0].case.expected).toEqual({ skills: ["build-frontend", "write-a-rule"], rules: [] });
	});

	test("the skill read counts as use when the harness reports no outcome", () => {
		const log = logOf([result(1, { feature: "find_skill", decisionId: "s1", skills: [{ name: "browser" }] })]);
		const events = [user(1, "open the site"), tool(3, "Read", { file_path: "/h/.claude/skills/browser/SKILL.md" })];
		const d = deriveSignals(log, locateWith(pi(events)), ["find_skill"]);
		expect(d.findings).toEqual([expect.objectContaining({ signal: "used", verdict: "ok" })]);
		expect(d.candidates).toEqual([]);
	});
});

describe("find_tool and orchestrator signals", () => {
	test("activated tools are called or unused, judged inside the containing turn", () => {
		const log = logOf([
			result(5, {
				feature: "find_tool",
				decisionId: "t1",
				activate: [{ name: "find_symbol" }, { name: "web_search" }],
			}),
		]);
		const events = [
			user(1, "first"),
			assistant(2, "a"),
			user(4, "look up the symbol"),
			tool(6, "mcp__serena__find_symbol", {}),
			user(20, "later"),
		];
		const d = deriveSignals(log, locateWith(pi(events)), ["find_tool"]);
		expect(d.findings.map((f) => `${f.signal}`).sort()).toEqual(["called", "unused"]);
		expect(d.candidates[0].case.expected).toEqual(["find_symbol"]);
		expect(d.candidates[0].case.input).toMatchObject({ userRequest: "look up the symbol" });
	});

	test("orchestrator: plan vs spawned subagents", () => {
		const events = [user(1, "split this into parallel work"), tool(3, "subagent", {}), tool(3, "subagent", {})];
		const single = deriveSignals(
			logOf([result(1, { feature: "orchestrator", plan: "single" })]),
			locateWith(pi(events)),
			["orchestrator"],
		);
		expect(single.findings[0].signal).toBe("under_planned");
		const fan = deriveSignals(
			logOf([result(1, { feature: "orchestrator", plan: "fanout" })]),
			locateWith(pi([user(1, "do it")])),
			["orchestrator"],
		);
		expect(fan.findings[0].signal).toBe("unfollowed");
		const ok = deriveSignals(logOf([result(1, { feature: "orchestrator", plan: "fanout" })]), locateWith(pi(events)), [
			"orchestrator",
		]);
		expect(ok.findings[0].signal).toBe("followed");
	});
});

describe("efficiency, tally, and report", () => {
	const log = logOf([
		{
			ts: at(0),
			type: "decide",
			feature: "model_route",
			harness: "pi",
			status: "ok",
			costUsd: 0.01,
			latencyMs: 300,
			cached: false,
			backend: "jev",
		},
		{
			ts: at(1),
			type: "decide",
			feature: "model_route",
			harness: "pi",
			status: "ok",
			costUsd: 0,
			latencyMs: 900,
			cached: false,
			backend: "jev",
		},
		{
			ts: at(2),
			type: "decide",
			feature: "model_route",
			harness: "pi",
			status: "ok",
			costUsd: 0,
			latencyMs: 0,
			cached: true,
		},
		result(0, { feature: "model_route", tier: "quick" }),
		result(1, { feature: "model_route", status: "skipped" }),
		result(2, { feature: "model_route", status: "unavailable" }),
	]);

	test("per feature and harness: counts, cost, latency percentiles, cache exclusion", () => {
		const [row] = efficiency(log);
		expect(row).toMatchObject({
			feature: "model_route",
			harness: "pi",
			decisions: 3,
			routed: 1,
			skipped: 1,
			unavailable: 1,
			cached: 1,
		});
		expect(row.costUsd).toBeCloseTo(0.01);
		expect(row.p50).toBe(300);
		expect(row.p95).toBe(900);
		expect(row.backends).toEqual({ jev: 2 });
	});

	test("tally and render include joined counts and the candidates note", () => {
		const derived = deriveSignals(
			logOf([result(2.5, { feature: "model_route", decisionId: "d1", tier: "premium" })]),
			locateWith(pi([user(3, "q"), assistant(4, "short"), change(5, "m/x")])),
			["model_route"],
		);
		const rows = tally(derived);
		expect(rows[0]).toMatchObject({ decisions: 1, joined: 1, wrong: 1 });
		const md = renderAudit({
			generatedAt: "now",
			since: "then",
			harness: "all",
			logRecords: { results: 1, decides: 0, outcomes: 0 },
			efficiency: efficiency(log),
			signals: rows,
			wrong: derived.findings.filter((f) => f.verdict === "wrong"),
			candidates: [{ feature: "model_route", count: 1, path: "candidates/model_route.jsonl" }],
		});
		expect(md).toContain("## Efficiency");
		expect(md).toContain("premium_short");
		expect(md).toContain("Move a line into `evals/");
	});
});

describe("files", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "decision-audit-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	test("candidates are appended once per source and input", () => {
		const c = { feature: "model_route", case: { input: { prompt: "p" }, expected: null, source: "S1", note: "n" } };
		expect(writeCandidates([c, c], dir)[0].count).toBe(1);
		expect(writeCandidates([c], dir)[0].count).toBe(0);
		writeCandidates([{ ...c, case: { ...c.case, source: "S2" } }], dir);
		const lines = readFileSync(join(dir, "model_route.jsonl"), "utf8").trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0])).toEqual(c.case);
	});

	test("runAudit end to end over a log dir writes the report and candidates, filtered by harness", () => {
		const logDir = join(dir, "state");
		const day = new Date(T0);
		const stamp = `${String(day.getFullYear() % 100).padStart(2, "0")}${String(day.getMonth() + 1).padStart(2, "0")}${String(day.getDate()).padStart(2, "0")}`;
		Bun.write(
			join(logDir, `log-${stamp}.jsonl`),
			[
				result(2.5, { feature: "model_route", decisionId: "d1", tier: "premium" }),
				result(2.6, { feature: "model_route", decisionId: "d2", tier: "quick", harness: "cli", sessionId: undefined }),
			]
				.map((l) => JSON.stringify(l))
				.join("\n"),
		);
		const transcript = pi([user(3, "q"), assistant(4, "short answer"), change(5, "m/x")]);
		const run = (harness: "pi" | "all") =>
			runAudit({
				sinceMs: T0 - 1000,
				sinceLabel: "t",
				harness,
				logDir,
				locate: locateWith(transcript),
				docsDir: join(dir, "docs"),
				candidatesDir: join(dir, "cand"),
			});
		const piOnly = run("pi");
		expect(piOnly.report.efficiency).toHaveLength(1);
		expect(piOnly.report.candidates[0]).toMatchObject({ feature: "model_route", count: 1 });
		expect(readFileSync(piOnly.file as string, "utf8")).toContain("decision audit");
		expect(run("all").report.efficiency).toHaveLength(2);
	});
});

describe("masking", () => {
	test("keys, bearer tokens, assignments, and JWTs are masked before clipping", () => {
		const text =
			"OPENCODE_API_KEY=abcd1234efgh5678 Authorization: Bearer abc.def-ghi_jkl sk-proj-abcdefghijklmnop12345 eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4 ok";
		const out = maskSecrets(text);
		for (const secret of ["abcd1234efgh5678", "abc.def-ghi_jkl", "sk-proj-abcdefghijklmnop12345", "SflKxwRJSMeKKF2QT4"])
			expect(out).not.toContain(secret);
		expect(out).toContain("ok");
	});

	test("clip collapses whitespace and caps at 300 characters including the ellipsis", () => {
		const out = clip(`a\n\n  b ${"word ".repeat(100)}`);
		expect(out.startsWith("a b ")).toBe(true);
		expect(out.length).toBe(300);
		expect(out.endsWith("…")).toBe(true);
		expect(clip("short")).toBe("short");
	});

	test("plain paths and prose are left alone", () => {
		const text = "edit /home/user/projects/decision/features/model-route.ts and run bun test";
		expect(maskSecrets(text)).toBe(text);
	});
});
