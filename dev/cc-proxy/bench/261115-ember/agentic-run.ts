// bun run.ts <runs> [scenarios] [arms]  — launches all arms of one (scenario, run) cell together.
import { $ } from "bun";
import { readFileSync, existsSync } from "fs";
const B = `${process.env.HOME}/.pi/agent/docs/provider/thinking-bench`; const W = import.meta.dir;
if (!existsSync(`${B}/fixtures`)) await $`tar xzf ${B}/fixtures.tgz -C ${B}`.quiet();
const truth = JSON.parse(readFileSync(`${B}/fixtures/truth.json`, "utf8"));
const NUDGE =
	"Reasoning budget: keep internal thinking short. Gather facts with tools instead of deliberating, verify once, then answer and stop.";
/** The "Execution Rules" block from a community AGENTS.md recipe, verbatim. */
const RULES = [
	"## Execution Rules",
	"- Think concisely. Keep internal reasoning brief and strictly focused on the immediate step.",
	"- Do NOT explore unrelated files. Only inspect files explicitly mentioned in the prompt.",
	"- Do NOT over-engineer or consider edge cases unless explicitly requested.",
	"- Output tool calls directly without conversational filler.",
].join("\n");
/** The two lines easy-harness ships as `sources/common.md`. */
const COMMON =
	"Think concisely. Keep internal reasoning brief and focused on the immediate step.\nOutput tool calls directly without conversational filler.";
const ARMS: Record<
	string,
	{
		think: string;
		off?: string;
		nudge?: boolean;
		rules?: boolean;
		step?: boolean;
		model?: string;
		common?: boolean;
	}
> = {
	max: { think: "max" },
	high: { think: "high" },
	low: { think: "low" },
	offStock: { think: "off" },
	offDisabled: { think: "off", off: "disabled" },
	offCommon: { think: "off", off: "disabled", common: true },
	highNudge: { think: "high", nudge: true },
	lowNudge: { think: "low", nudge: true },
	maxNudge: { think: "max", nudge: true },
	highRules: { think: "high", rules: true },
	lowRules: { think: "low", rules: true },
	highStep: { think: "high", off: "disabled", step: true },
	lowStep: { think: "low", off: "disabled", step: true },
	emberLow: { think: "low", model: "openrouter/meta/muse-ember", common: true },
	emberMedium: { think: "medium", model: "openrouter/meta/muse-ember", common: true },
	emberHigh: { think: "high", model: "openrouter/meta/muse-ember", common: true },
	emberOff: { think: "off", model: "openrouter/meta/muse-ember", common: true },
	emberMediumBare: { think: "medium", model: "openrouter/meta/muse-ember" },
	emberHighBare: { think: "high", model: "openrouter/meta/muse-ember" },
	grokHigh: { think: "high", model: "xai/grok-4.7" },
	dsLow: { think: "low", model: "opencode-go/deepseek-v4.1-flash", common: true },
	dsHigh: { think: "high", model: "opencode-go/deepseek-v4.1-flash", common: true },
	grokHighCommon: { think: "high", model: "xai/grok-4.7", common: true },
};
const BRIEF: Record<string, string> = {
	env: "List every environment variable whose name starts with APP_ that the application code under src/ reads at runtime (any depth). Ignore tests, comments, docs, JSON and dynamically built names. Do not change any files. End with one line: ANSWER: NAME1,NAME2,... sorted alphabetically.",
	graph:
		"services/ (any depth) holds YAML service definitions with depends_on lists. Which services depend on the service named cache, directly or transitively? Ignore comments. Do not change any files. End with one line: ANSWER: name1,name2,... sorted alphabetically.",
	multi:
		"Several tests in src/all.test.ts fail. Fix the source files under src/ so that `bun test` passes. Do not edit the test file. Run the tests to confirm. End with one line: ANSWER: done",
	sched:
		"Fix src/sched.ts so that `bun test` passes. Do not edit the test file. Run the tests to confirm. End with one line: ANSWER: done",
	bug: "Fix src/money.ts so that `bun test` passes. Do not edit the test file. Run the tests to confirm. End with one line: ANSWER: done",
};
const [runs = "3", scen = "env,graph,bug", armList = Object.keys(ARMS).join(",")] = process.argv.slice(2);
const out = process.env.BENCH_OUT ?? `${B}/results.jsonl`;
for (let r = 0; r < Number(runs); r++)
	for (const s of scen.split(",")) {
		let arms = armList.split(",");
		arms = [...arms.slice(r % arms.length), ...arms.slice(0, r % arms.length)];
		await Promise.all(
			arms.map(async (arm, k) => {
				await Bun.sleep(k * 300);
				const id = `${s}-${arm}-${Date.now().toString(36)}${k}`;
				const dir = `${W}/runs/${id}`;
				await $`mkdir -p ${dir}/state && cp -r ${B}/fixtures/${s} ${dir}/work`.quiet();
				const a = ARMS[arm];
				const args = [
					"-p",
					"-ne",
					"-e",
					`${B}/probe-ext.ts`,
					"--no-skills",
					"-nc",
					"--no-mcp",
					"-np",
					"--no-session",
					"--model",
					a.model ?? "ocgp/deepseek-v4.1-flash",
					"--thinking",
					a.think,
					"--mode",
					"json",
					...(a.nudge ? ["--append-system-prompt", NUDGE] : []),
					...(a.rules ? ["--append-system-prompt", RULES] : []),
					...(a.common ? ["--append-system-prompt", COMMON] : []),
					BRIEF[s],
				];
				const t0 = Date.now();
				const p = Bun.spawn(["timeout", "900", "pi", ...args], {
					cwd: `${dir}/work`,
					stdin: "ignore",
					stdout: Bun.file(`${dir}/out.jsonl`),
					stderr: Bun.file(`${dir}/err.txt`),
					env: {
						...process.env,
						BENCH_RUN: id,
						BENCH_OFF: a.off ?? "stock",
						BENCH_STEP: a.step ? "1" : "",
						XDG_STATE_HOME: `${dir}/state`,
					},
				});
				const code = await p.exited;
				const ms = Date.now() - t0;
				const lines = readFileSync(`${dir}/out.jsonl`, "utf8")
					.split("\n")
					.filter(Boolean)
					.map((l) => {
						try {
							return JSON.parse(l);
						} catch {
							return {};
						}
					});
				const asst = lines
					.filter((e) => e.type === "message_end" && e.message?.role === "assistant")
					.map((e) => e.message);
				const cost = asst.reduce((x, m) => x + (m.usage?.cost?.total ?? 0), 0);
				const outTok = asst.reduce((x, m) => x + (m.usage?.output ?? 0), 0);
				const tools = lines.filter((e) => e.type === "tool_execution_end").length;
				const text = asst
					.flatMap((m) => m.content ?? [])
					.filter((c: { type: string; text?: string }) => c.type === "text")
					.map((c: { text?: string }) => c.text)
					.join("\n");
				let ok: boolean, detail: string;
				if (["bug", "sched", "multi"].includes(s)) {
					const tf = s === "bug" ? "src/money.test.ts" : s === "sched" ? "src/sched.test.ts" : "src/all.test.ts";
					const t = await $`cd ${dir}/work && bun test 2>&1`.nothrow().quiet();
					const same = (await $`cmp ${dir}/work/${tf} ${B}/fixtures/${s}/${tf}`.nothrow().quiet()).exitCode === 0;
					ok = t.exitCode === 0 && same;
					detail = `tests=${t.exitCode === 0} testUnchanged=${same}`;
				} else {
					const m = [...text.matchAll(/ANSWER:\s*(.*)/g)].pop()?.[1] ?? "";
					const got = m
						.split(",")
						.map((x) => x.trim().replace(/[`*]/g, ""))
						.filter(Boolean);
					const want: string[] = truth[s];
					const hit = got.filter((g) => want.includes(g));
					const wrong = got.filter((g) => !want.includes(g));
					const missed = want.filter((x) => !got.includes(x));
					ok = !wrong.length && !missed.length;
					detail = `hit=${hit.length} wrong=${wrong.join("|")} missed=${missed.join("|")}`;
					const changed = (await $`diff -r ${dir}/work ${B}/fixtures/${s}`.nothrow().quiet()).exitCode !== 0;
					if (changed) detail += " FILES_CHANGED";
				}
				const rec = {
					id,
					s,
					arm,
					r,
					code,
					ms,
					cost,
					outTok,
					tools,
					turns: asst.length,
					ok,
					detail,
				};
				console.log(JSON.stringify(rec));
				await $`echo ${JSON.stringify(rec)} >> ${out}`.quiet();
			}),
		);
	}
