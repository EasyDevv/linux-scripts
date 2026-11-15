// bun real-run.ts <reps> [taskIds|all] [arms] — real-task bench (261115). Each (task, rep) cell starts all
// arms together on fresh copies of the fixture; order rotates per rep. Grading: the task's test command
// passes and its test files are unchanged; lookups: exact set match against lookup-truth.json.
import { $ } from "bun";
import { readFileSync, existsSync, appendFileSync } from "fs";

const W = import.meta.dir;
const tasks: any[] = JSON.parse(
	(await $`python3 -c ${"import json,tasks;print(json.dumps([{k:(str(v) if k=='repo' else v) for k,v in t.items()} for t in tasks.TASKS]))"}`.cwd(W).quiet()).stdout.toString(),
);
const truth = existsSync(`${W}/lookup-truth.json`) ? JSON.parse(readFileSync(`${W}/lookup-truth.json`, "utf8")) : {};
const COMMON =
	"Think concisely. Keep internal reasoning brief and focused on the immediate step.\nOutput tool calls directly without conversational filler.";
const ARMS: Record<string, { model: string; think: string }> = {
	emberLow: { model: "openrouter/meta/muse-ember", think: "low" },
	emberMedium: { model: "openrouter/meta/muse-ember", think: "medium" },
	emberHigh: { model: "openrouter/meta/muse-ember", think: "high" },
	dsLow: { model: "opencode-go/deepseek-v4.1-flash", think: "low" },
	dsHigh: { model: "opencode-go/deepseek-v4.1-flash", think: "high" },
	grokHigh: { model: "xai/grok-4.7", think: "high" },
};
const [reps = "2", only = "all", armList = Object.keys(ARMS).join(",")] = process.argv.slice(2);
const out = process.env.BENCH_OUT ?? `${W}/results.jsonl`;
// Runs live outside every repo, and bwrap hides the user's sources and this bench (its fix/ copies are the
// answers): round 1 (results-leaky.jsonl) showed models reading the live repo and fixtures/<id>/fix.
const RUNS = process.env.RUNS ?? `/tmp/real-bench-runs`;
const HOME = process.env.HOME!;
const HIDE = ["dev", "chat", ".claude", ".agents", ".ref", ".local/share/scripts", ".pi/agent/extensions", ".pi/agent/docs",
	".pi/agent/.git", ".pi/agent/.worktrees", ".pi/agent/.archive", ".pi/agent/drafts"].map((p) => `${HOME}/${p}`);
const KEEP = ["dev/dashboard/node_modules", "dev/private/android-macro/node_modules", "dev/private/quant/node_modules",
	"dev/private/quant/apps/client/node_modules"].map((p) => `${HOME}/${p}`);
const sandbox = (work: string) => [
	"bwrap", "--dev-bind", "/", "/",
	...HIDE.flatMap((p) => (existsSync(p) ? ["--tmpfs", p] : [])),
	...KEEP.flatMap((p) => (existsSync(p) ? ["--ro-bind", p, p] : [])),
	"--bind", work, work, "--chdir", work, "--",
];
const done = new Set(
	existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).key) : [],
);
const chosen = tasks.filter((t) => only === "all" || only.split(",").includes(t.id));
const brief = (t: any) =>
	t.kind === "lookup"
		? t.brief
		: `Run \`${t.cmd}\`: the tests in ${t.tests.join(", ")} fail. Change the source code so that they pass. Do not edit the test files. Run the tests to confirm. End with one line: ANSWER: done`;

async function one(t: any, arm: string, rep: number) {
	const key = `${t.id}|${arm}|${rep}`;
	if (done.has(key)) return;
	// `provider/model@effort` runs a model that has no named arm (a candidate under admission).
	const a = ARMS[arm] ?? { model: arm.split("@")[0]!, think: arm.split("@")[1] ?? "low" };
	const dir = `${RUNS}/${t.id}-${arm.replace(/[/@]/g, "_")}-${rep}-${Date.now().toString(36)}`;
	await $`mkdir -p ${dir}/state && cp -a ${W}/fixtures/${t.id}/base ${dir}/work`.quiet();
	const args = ["-p", "-ne", "--no-skills", "-nc", "--no-mcp", "-np", "--no-session", "--model", a.model, "--thinking", a.think,
		"--mode", "json", "--append-system-prompt", COMMON, brief(t)];
	const t0 = Date.now();
	const p = Bun.spawn([...sandbox(`${dir}`), "timeout", "1200", "pi", ...args], {
		cwd: `${dir}/work`, stdin: "ignore",
		stdout: Bun.file(`${dir}/out.jsonl`), stderr: Bun.file(`${dir}/err.txt`),
		env: { ...process.env, XDG_STATE_HOME: `${dir}/state` },
	});
	const code = await p.exited;
	const ms = Date.now() - t0;
	const lines = readFileSync(`${dir}/out.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
	const asst = lines.filter((e) => e.type === "message_end" && e.message?.role === "assistant").map((e) => e.message);
	const cost = asst.reduce((x, m) => x + (m.usage?.cost?.total ?? 0), 0);
	const outTok = asst.reduce((x, m) => x + (m.usage?.output ?? 0), 0);
	const tools = lines.filter((e) => e.type === "tool_execution_end").length;
	const text = asst.flatMap((m) => m.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
	const errors = asst.filter((m) => m.stopReason === "error").map((m) => String(m.errorMessage ?? "").slice(0, 120));
	let ok: boolean, detail: string;
	if (t.kind === "lookup") {
		const got = (text.match(/ANSWER:\s*(.*)$/m)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean).sort();
		const want: string[] = truth[t.id] ?? [];
		const hit = want.filter((x) => got.includes(x)), wrong = got.filter((x) => !want.includes(x)), missed = want.filter((x) => !got.includes(x));
		ok = wrong.length === 0 && missed.length === 0;
		detail = `hit=${hit.length} wrong=${wrong.join(" ")} missed=${missed.join(" ")}`;
	} else {
		const touched = (await $`git -C ${dir}/work status --porcelain -- ${t.tests}`.nothrow().quiet()).stdout.toString().trim();
		const r = await $`sh -c ${t.cmd}`.cwd(`${dir}/work`).nothrow().quiet();
		const tail = (r.stdout.toString() + r.stderr.toString()).match(/(\d+) pass[\s\S]*?(\d+) fail/);
		ok = r.exitCode === 0 && !touched;
		detail = `${touched ? "TESTS EDITED " : ""}exit=${r.exitCode}${tail ? ` pass=${tail[1]} fail=${tail[2]}` : ""}`;
	}
	const leaked = lines
		.filter((e) => e.type === "tool_execution_start")
		.flatMap((e) => JSON.stringify(e.args ?? {}).match(/\/home\/easydev\/(dev|chat|\.claude|\.agents|\.local\/share\/scripts|\.pi\/agent\/extensions)[^"\s]*/g) ?? [])
		.filter((p) => !p.includes("node_modules"));
	const row = { leaked: leaked.slice(0, 3), key, id: t.id, tier: t.tier, arm, model: a.model, think: a.think, rep, code, ms, cost, outTok, tools, turns: asst.length, ok, detail, errors };
	appendFileSync(out, JSON.stringify(row) + "\n");
	console.log(JSON.stringify(row));
}

const CELLS = Number(process.env.CELLS ?? 2);
const cells: Array<[any, number]> = [];
for (let r = 0; r < Number(reps); r++) for (const t of chosen) cells.push([t, r]);
let cursor = 0;
await Promise.all(
	Array.from({ length: CELLS }, async () => {
		while (cursor < cells.length) {
			const [t, r] = cells[cursor++]!;
			let arms = armList.split(",");
			arms = [...arms.slice(r % arms.length), ...arms.slice(0, r % arms.length)];
			await Promise.all(arms.map(async (arm, k) => { await Bun.sleep(k * 300); await one(t, arm, r); }));
		}
	}),
);
console.log("done");
