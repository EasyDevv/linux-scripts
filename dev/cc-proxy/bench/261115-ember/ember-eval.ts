// muse-ember effort × concise-nudge evaluation through cc-proxy's own transform.
// Cases and graders: ~/.pi/agent/docs/provider/bench (cases.ts, score.ts), copied unchanged.
// Each request is built as Claude Code would send it, passed through cc-proxy `forForeign` (effort, common
// layer, schema) and the response through `rewriteJson` (thinking tags), then sent to OpenRouter's
// Anthropic endpoint, exactly what the proxy does for a non-streamed call.
//   bun ember-eval.ts <outDir> [reps=3] [efforts=low,medium,high,xhigh,max]
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Case, reads, type StructuredCase, summaries, workers } from "./cases.ts";
import { hard } from "./hard-cases.ts";
import { harder } from "./harder-cases.ts";
import { traceQuality, traces } from "./trace-cases.ts";
import { holdout } from "./holdout-cases.ts";
import { codeQuality, structuredQuality } from "./score.ts";

const P = `${process.env.HOME}/.local/share/scripts/dev/cc-proxy`;
const { forForeign, rewriteJson } = await import(`${P}/normalize.ts`);
const { commonText } = await import(`${P}/levels.ts`);
const { credentialFor, PROVIDERS } = await import(`${P}/upstreams.ts`);

/** TARGET=provider/model (default the Muse Ember route); CASESET=harder runs harder-cases.ts only. */
const TARGET = process.env.TARGET ?? "openrouter/meta/muse-ember";
const PROVIDER = TARGET.slice(0, TARGET.indexOf("/"));
const MODEL = TARGET.slice(TARGET.indexOf("/") + 1);
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 16);
const MAX_MS = Number(process.env.MAX_MS ?? 180_000);
const PRICES: Record<string, { input: number; cacheRead: number; output: number }> = {
	"openrouter/meta/muse-ember": { input: 0.1, cacheRead: 0.004, output: 0.5 }, // $/1M, ≤200K tier
	"xai/grok-4.7": { input: 2, cacheRead: 0.5, output: 10 }, // rough list price, for relative cost only
	"opencode-go/deepseek-v4.1-flash": { input: 0.15, cacheRead: 0.003, output: 0.6 }, // pi catalog (opencode-go); subscription, relative only
};
const PRICE = PRICES[TARGET] ?? { input: 0, cacheRead: 0, output: 0 };
const out = process.argv[2] ?? "out";
const reps = Number(process.argv[3] ?? 3);
const efforts = (process.argv[4] ?? "low,medium,high,xhigh,max").split(",");
const concurrency = Number(process.env.CONCURRENCY ?? 10);
mkdirSync(out, { recursive: true });
const attemptsFile = join(out, "attempts.jsonl");
const done = new Set(
	existsSync(attemptsFile)
		? readFileSync(attemptsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).key)
		: [],
);
const work = mkdtempSync(join(tmpdir(), "ember-eval-"));
const COMMON = commonText();
if (!COMMON) throw new Error("common.md is empty");

type Usage = { input: number; cacheRead: number; output: number };
type Variant = { effort: string; common: boolean };

async function call(body: Record<string, unknown>, variant: Variant) {
	const sent = forForeign(body, PROVIDER, MODEL, variant.effort, variant.common ? COMMON : "");
	const credential = await credentialFor(PROVIDER);
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`${PROVIDERS[PROVIDER].baseUrl}/v1/messages`, {
			method: "POST",
			headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", ...PROVIDERS[PROVIDER].auth(credential), ...(PROVIDERS[PROVIDER].headers?.(crypto.randomUUID()) ?? {}) },
			body: JSON.stringify(sent),
			signal: AbortSignal.timeout(Number(process.env.REQ_MS ?? 120_000)),
		});
		if (res.ok) {
			const { body: rewritten } = rewriteJson((await res.json()) as Record<string, unknown>, PROVIDER, "claude-haiku-5-5");
			return { body: rewritten as any, retries: attempt };
		}
		const text = await res.text();
		if ((res.status === 429 || res.status >= 500) && attempt < 6) {
			await Bun.sleep(5000 * (attempt + 1));
			continue;
		}
		throw new Error(`${res.status} ${text.slice(0, 300)}`);
	}
}

const add = (sum: Usage, usage: any) => {
	sum.input += usage?.input_tokens ?? 0;
	sum.cacheRead += usage?.cache_read_input_tokens ?? 0;
	sum.output += usage?.output_tokens ?? 0;
};
const cost = (u: Usage) => (u.input * PRICE.input + u.cacheRead * PRICE.cacheRead + u.output * PRICE.output) / 1e6;
const textOf = (body: any) =>
	(body.content ?? [])
		.filter((b: any) => b.type === "text")
		.map((b: any) => b.text)
		.join("");
const parseJson = (text: string) =>
	JSON.parse(
		text
			.trim()
			.replace(/^```(?:json)?\s*/, "")
			.replace(/\s*```$/, ""),
	);
const request = (system: string, messages: unknown[], tools?: unknown[]) => ({
	model: "claude-haiku-5-5",
	max_tokens: 32000,
	system: [{ type: "text", text: system }],
	messages,
	...(tools ? { tools } : {}),
	thinking: { type: "adaptive" },
	output_config: { effort: "medium" },
});

function checkCode(c: Case, dir: string) {
	const runner = `const assert=require('node:assert/strict');const {solve}=require(${JSON.stringify(join(dir, "main.cjs"))});const tests=${JSON.stringify(c.tests)};let pass=0;const errors=[];for(const t of tests){try{const before=JSON.stringify(t.input);assert.deepEqual(solve(t.input),t.expected);assert.equal(JSON.stringify(t.input),before);pass++;}catch(e){errors.push(String(e.message).slice(0,800));}}console.log(JSON.stringify({pass,total:tests.length,errors}));`;
	const child = spawnSync("node", ["--permission", `--allow-fs-read=${dir}`, "-e", runner], {
		cwd: dir,
		env: { PATH: process.env.PATH },
		timeout: 3000,
		maxBuffer: 32768,
		encoding: "utf8",
	});
	if (child.status !== 0) return { pass: 0, total: c.tests.length, errors: [String(child.error ?? child.stderr).slice(0, 500)] };
	try {
		return JSON.parse(child.stdout.trim().split("\n").at(-1)!);
	} catch {
		return { pass: 0, total: c.tests.length, errors: ["Invalid grader output"] };
	}
}

async function structured(c: StructuredCase, v: Variant) {
	const usage: Usage = { input: 0, cacheRead: 0, output: 0 };
	const { body, retries } = await call(
		request("Follow the task precisely. Return only the requested JSON.", [{ role: "user", content: c.prompt }]),
		v,
	);
	add(usage, body.usage);
	let actual: unknown = null;
	try {
		actual = parseJson(textOf(body));
	} catch {}
	const quality = structuredQuality(actual, c.expected);
	return { quality, success: quality === 100, usage, retries, turns: 1 };
}

async function code(c: Case, v: Variant, dir: string) {
	const usage: Usage = { input: 0, cacheRead: 0, output: 0 };
	const prompt = `${c.spec}\nOutput ONLY JSON mapping filenames to complete CommonJS source text. main.cjs exports solve. No dependencies. Reference files:\n${JSON.stringify(c.files)}`;
	const { body, retries } = await call(request("Return only the requested JSON source map.", [{ role: "user", content: prompt }]), v);
	add(usage, body.usage);
	let parsed: Record<string, string> = {};
	try {
		parsed = parseJson(textOf(body));
	} catch {}
	for (const file of Object.keys(c.files)) writeFileSync(join(dir, file), typeof parsed[file] === "string" ? parsed[file] : "");
	const result = checkCode(c, dir);
	const source = Object.fromEntries(Object.keys(c.files).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
	const quality = codeQuality(result, source, Object.keys(c.files), c.requiredPatterns);
	return { quality, success: quality === 100, usage, retries, turns: 1 };
}


async function trace(c: { id: string; program: string; expected: string[] }, v: Variant) {
	const usage: Usage = { input: 0, cacheRead: 0, output: 0 };
	const prompt = `Determine exactly what this JavaScript program prints when run with node. Do not run it; reason it through. Return only JSON {"lines": [...]} with one string per console.log call, in order, each exactly as node prints it (arguments joined by one space).\n\n${c.program}`;
	const { body, retries } = await call(request("Follow the task precisely. Return only the requested JSON.", [{ role: "user", content: prompt }]), v);
	add(usage, body.usage);
	let actual: unknown = null;
	try {
		actual = parseJson(textOf(body));
	} catch {}
	const quality = traceQuality(actual, c.expected);
	return { quality, success: quality === 100, usage, retries, turns: 1, actual };
}

const WORKER_TOOLS = [
	{ name: "read_file", description: "Read a listed source file.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
	{
		name: "write_file",
		description: "Replace a listed source file.",
		input_schema: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"] },
	},
	{ name: "check", description: "Run immutable tests and input-mutation checks.", input_schema: { type: "object", properties: {} } },
];

async function worker(c: Case, v: Variant, dir: string) {
	const usage: Usage = { input: 0, cacheRead: 0, output: 0 };
	for (const [file, text] of Object.entries(c.files)) writeFileSync(join(dir, file), text);
	const messages: any[] = [
		{ role: "user", content: `${c.spec}\nFiles: ${Object.keys(c.files).join(", ")}. main.cjs exports solve. Tests are immutable.` },
	];
	const system =
		"Implement the requested CommonJS code using only listed tools. Read first, run check, repair failures, and finish concisely.";
	let turns = 0,
		checks = 0,
		retries = 0,
		reason: string | undefined;
	const started = performance.now();
	while (true) {
		if (turns >= MAX_TURNS) {
			reason = "turn-budget";
			break;
		}
		if (performance.now() - started > MAX_MS) {
			reason = "wall-timeout";
			break;
		}
		const res = await call(request(system, messages, WORKER_TOOLS), v);
		retries += res.retries;
		turns++;
		add(usage, res.body.usage);
		messages.push({ role: "assistant", content: res.body.content });
		const uses = (res.body.content ?? []).filter((b: any) => b.type === "tool_use");
		if (!uses.length) break;
		const results = uses.map((u: any) => {
			try {
				if (u.name === "check") {
					checks++;
					return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(checkCode(c, dir)) };
				}
				if (!Object.hasOwn(c.files, u.input?.name)) throw new Error("Only listed files may be accessed");
				if (u.name === "read_file") return { type: "tool_result", tool_use_id: u.id, content: readFileSync(join(dir, u.input.name), "utf8") };
				if (u.name === "write_file") {
					if (String(u.input.content).length > 20_000) throw new Error("Source too large");
					writeFileSync(join(dir, u.input.name), String(u.input.content));
					return { type: "tool_result", tool_use_id: u.id, content: "saved" };
				}
				throw new Error(`unknown tool ${u.name}`);
			} catch (error) {
				return { type: "tool_result", tool_use_id: u.id, content: String(error), is_error: true };
			}
		});
		messages.push({ role: "user", content: results });
	}
	const result = checkCode(c, dir);
	const source = Object.fromEntries(Object.keys(c.files).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
	const quality = codeQuality(result, source, Object.keys(c.files), c.requiredPatterns);
	return { quality, success: !reason && checks > 0 && quality === 100, usage, retries, turns, checks, reason };
}

type Job = { key: string; workload: string; id: string; rep: number; v: Variant; run: (dir: string) => Promise<any> };
const jobs: Job[] = [];
for (let rep = 0; rep < reps; rep++)
	for (const [workload, list] of (process.env.CASESET === "trace"
		? [["trace", traces]]
		: process.env.CASESET === "holdout"
		? [["trace", holdout]]
		: process.env.CASESET === "harder"
		? [
				["x-code", harder],
				["x-worker", harder],
			]
		: [
				["read", reads],
				["summary", summaries],
				["code", workers],
				["worker", workers],
				["hard-code", hard],
				["hard-worker", hard],
			]) as Array<[string, any[]]>)
		for (const c of list as any[])
			for (const effort of efforts)
				for (const common of (process.env.COMMON ?? "off,on").split(",").map((x) => x === "on")) {
					const v = { effort, common };
					const key = `${TARGET}|${workload}|${c.id}|${rep}|${effort}|${common ? "on" : "off"}`;
					if (done.has(key)) continue;
					jobs.push({
						key,
						workload,
						id: c.id,
						rep,
						v,
						run: (dir) =>
							workload === "trace"
								? trace(c, v)
								: workload === "read" || workload === "summary"
								? structured(c, v)
								: workload.endsWith("code")
									? code(c, v, dir)
									: worker(c, v, dir),
					});
				}
console.error(`${jobs.length} jobs, concurrency ${concurrency}`);
let cursor = 0,
	finished = 0;
await Promise.all(
	Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
		while (cursor < jobs.length) {
			const job = jobs[cursor++]!;
			const dir = join(work, job.key.replace(/[^\w.-]+/g, "_"));
			mkdirSync(dir, { recursive: true });
			const start = performance.now();
			let row: any;
			try {
				row = await job.run(dir);
			} catch (error) {
				row = { quality: 0, success: false, error: String(error).slice(0, 300), usage: { input: 0, cacheRead: 0, output: 0 } };
			}
			const record = {
				key: job.key,
				target: TARGET,
				workload: job.workload,
				id: job.id,
				rep: job.rep,
				effort: job.v.effort,
				common: job.v.common,
				ms: Math.round(performance.now() - start),
				cost: cost(row.usage),
				...row,
			};
			appendFileSync(attemptsFile, `${JSON.stringify(record)}\n`);
			if (++finished % 50 === 0) console.error(`${finished}/${jobs.length}`);
		}
	}),
);
console.error("done");
