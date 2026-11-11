// deepseek-v4.1-flash on OpenCode Go: effort별 TTFB/전체/thinking, 세션 헤더별 캐시 적중.
import { readFileSync, writeFileSync } from "node:fs";
const P = `${process.env.HOME}/.local/share/scripts/dev/cc-proxy`;
const { forForeign } = await import(`${P}/normalize.ts`);
const { credentialFor, PROVIDERS } = await import(`${P}/upstreams.ts`);
const captured = JSON.parse(readFileSync(`${process.env.HOME}/.local/state/cc-proxy/failed/opencode-go_deepseek-v4.1-flash.json`, "utf8"));
const PROMPT = "In the repository at /home/easydev/dev/dashboard, find where the cc-proxy stats are relayed to the browser and which Rust file wires that route. Use the tools; do not change files.";

function build(effort: string, nonce: string) {
	const body = structuredClone(captured);
	body.messages = [{ role: "user", content: [{ type: "text", text: PROMPT }] }];
	body.system = [{ type: "text", text: `run ${nonce}` }, ...body.system];
	body.max_tokens = 32000;
	body.stream = true;
	if (effort === "none") { body.thinking = { type: "disabled" }; delete body.output_config; }
	else { body.thinking = { type: "adaptive" }; body.output_config = { effort }; }
	const out = forForeign(body, "opencode-go", "deepseek-v4.1-flash", effort === "none" ? undefined : effort) as any;
	if (effort === "none") { out.thinking = { type: "disabled" }; delete out.output_config; }
	return out;
}

async function call(body: unknown, session: string) {
	for (let k = 0; k < 20; k++) { const r: any = await once(body, session); if (!String(r.error ?? "").startsWith("429")) return { retries: k, ...r }; await Bun.sleep(30_000); }
	return { error: "429 x20" };
}
async function once(body: unknown, session: string) {
	const cred = await credentialFor("opencode-go");
	const headers = { "content-type": "application/json", accept: "text/event-stream", "anthropic-version": "2023-06-01", ...PROVIDERS["opencode-go"].auth(cred), ...PROVIDERS["opencode-go"].headers(session) };
	const t0 = performance.now();
	const res = await fetch(`${PROVIDERS["opencode-go"].baseUrl}/v1/messages`, { method: "POST", headers, body: JSON.stringify(body) });
	const tHead = performance.now() - t0;
	if (!res.ok) return { error: `${res.status} ${(await res.text()).slice(0, 200)}` };
	const dec = new TextDecoder(); let buf = ""; let tFirstDelta = 0, tFirstVisible = 0;
	let thinkChars = 0, textChars = 0, input = 0, output = 0, cacheRead = 0, cacheWrite = 0; const kinds: string[] = [];
	for await (const chunk of res.body!) {
		buf += dec.decode(chunk, { stream: true });
		let cut;
		while ((cut = buf.indexOf("\n\n")) !== -1) {
			const raw = buf.slice(0, cut); buf = buf.slice(cut + 2);
			const line = raw.split("\n").find((l) => l.startsWith("data:")); if (!line) continue;
			let d: any; try { d = JSON.parse(line.slice(5)); } catch { continue; }
			const now = performance.now() - t0;
			if (d.type === "message_start") { const u = d.message.usage ?? {}; input = u.input_tokens ?? 0; cacheRead = u.cache_read_input_tokens ?? 0; cacheWrite = u.cache_creation_input_tokens ?? 0; }
			if (d.type === "content_block_start") kinds.push(d.content_block.type);
			if (d.type === "content_block_delta") {
				if (!tFirstDelta) tFirstDelta = now;
				if (d.delta.type === "thinking_delta") thinkChars += d.delta.thinking.length;
				else { if (!tFirstVisible) tFirstVisible = now; textChars += (d.delta.text ?? d.delta.partial_json ?? "").length; }
			}
			if (d.type === "message_delta") { output = d.usage?.output_tokens ?? output; if (d.usage?.cache_read_input_tokens != null) cacheRead = d.usage.cache_read_input_tokens; if (d.usage?.input_tokens != null) input = d.usage.input_tokens; }
		}
	}
	return { head: tHead, firstDelta: tFirstDelta, firstVisible: tFirstVisible, total: performance.now() - t0, thinkChars, textChars, input, output, cacheRead, cacheWrite, blocks: kinds.join(",") };
}

const results: any[] = [];
const mode = process.argv[2];
const runs = Number(process.argv[3] ?? 3);
if (mode === "effort") {
	const efforts = ["none", "low", "medium", "high"];
	for (let r = 0; r < runs; r++) {
		const order = efforts.map((_, i) => efforts[(i + r) % efforts.length]);
		const out: any[] = []; for (const e of order) out.push({ effort: e, run: r, ...(await call(build(e, crypto.randomUUID()), crypto.randomUUID())) });
		results.push(...out); console.error(JSON.stringify(out));
	}
} else {
	for (let g = 0; g < runs; g++) {
		const fixed = crypto.randomUUID(); const nonceA = crypto.randomUUID(); const nonceB = crypto.randomUUID();
		for (let i = 0; i < 3; i++) {
			const a = await call(build("low", nonceA), fixed); results.push({ arm: "same-session", group: g, i, ...a }); console.error(JSON.stringify(results.at(-1)));
			const b = await call(build("low", nonceB), crypto.randomUUID()); results.push({ arm: "new-session", group: g, i, ...b }); console.error(JSON.stringify(results.at(-1)));
		}
	}
}
writeFileSync(`${import.meta.dir}/${mode}-${Date.now()}.json`, JSON.stringify(results, null, 1));
