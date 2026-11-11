/**
 * 요청·응답 변환 — 순수 함수만.
 *
 * Claude Code는 Anthropic 전용 beta 형태를 보낸다: 대화 중간의 `role: "system"` 메시지,
 * `tool_addition` 블록(대화 중 추가된 도구), `tool_use.caller`, `context_management`,
 * `metadata.user_id`(계정 UUID). Anthropic 호환이라도 다른 업체는 이것을 422로 거절하므로
 * (xAI 실측 261111), 다른 업체로 보낼 때는 표준 Messages 형태로 바꾼다. 업체별로 갈래를 두지 않고
 * 가장 엄격한 쪽에 맞춘 한 가지 변환을 모두에 쓴다.
 *
 * thinking 블록의 서명은 업체마다 다르고 서로 검증하지 못한다. 그래서 다른 업체가 만든 thinking의
 * 서명 앞에 `ccproxy:<provider>:`를 붙여 두고, 다음 요청에서 그 업체로 갈 때만 원래 서명으로
 * 되돌려 남기고 나머지 대상(Anthropic 포함)에게서는 그 블록을 뺀다.
 */
import type { Effort } from "./config.ts";

type Json = Record<string, unknown>;
type Block = Json & { type?: string };
type Message = { role: string; content: string | Block[] };

export const TAG = "ccproxy:";
const tagOf = (provider: string) => `${TAG}${provider}:`;

const KNOWN_BLOCKS = new Set(["text", "image", "document", "tool_use", "tool_result", "thinking", "redacted_thinking"]);
const TOOL_KEYS = ["name", "description", "input_schema"] as const;

/** 엄격한 백엔드가 거절하는 키워드. 인자 검증은 Claude Code의 도구가 실행할 때 다시 한다. */
const DROPPED_SCHEMA_KEYS = new Set(["$schema", "pattern", "patternProperties", "propertyNames"]);

/**
 * JSON Schema를 가장 엄격한 업체에 맞춘다(261111 실측):
 * - null 값 키를 지운다. `properties`가 있는 객체에 `required`가 없으면 `[]`를 채운다
 *   (xAI는 빠진 `required`를 null로 읽어 422).
 * - `pattern`(제어 문자 `\0` 포함)·`propertyNames`·`$schema`를 지우고 `const`는 `enum`으로 바꾼다
 *   (OpenCode Go deepseek은 요청을 나눠 받는 백엔드 일부가 "invalid JSON Schema"로 400).
 * 스키마 자체가 아닌 곳(`properties`의 이름들, `enum` 값)은 키워드로 보지 않는다.
 */
export function strictSchema(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(strictSchema);
	if (!value || typeof value !== "object") return value;
	const out: Json = {};
	for (const [key, inner] of Object.entries(value)) {
		if (inner === null || DROPPED_SCHEMA_KEYS.has(key)) continue;
		if (key === "const") out.enum = [inner];
		else if ((key === "properties" || key === "$defs" || key === "definitions") && typeof inner === "object") {
			out[key] = Object.fromEntries(Object.entries(inner as Json).map(([name, schema]) => [name, strictSchema(schema)]));
		} else if (key === "enum" || key === "default" || key === "examples" || key === "required") out[key] = inner;
		else out[key] = strictSchema(inner);
	}
	if (out.properties && typeof out.properties === "object" && !Array.isArray(out.required)) out.required = [];
	return out;
}

function blocks(content: Message["content"]): Block[] {
	return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

/** cache_control은 남기되 Anthropic 전용 `ttl`은 뺀다. */
function plainCache(block: Block): Block {
	const out: Block = { ...block };
	const cache = out.cache_control as Json | undefined;
	if (cache && typeof cache === "object") out.cache_control = { type: "ephemeral" };
	return out;
}

/** 이 대상(`native`면 Anthropic)이 받을 thinking 블록만 남긴다. */
export function keepThinking(block: Block, target: string | "native"): Block | null {
	if (block.type === "redacted_thinking") return target === "native" ? block : null;
	if (block.type !== "thinking") return block;
	const signature = typeof block.signature === "string" ? block.signature : "";
	if (target === "native") return signature.startsWith(TAG) ? null : block;
	const tag = tagOf(target);
	if (!signature.startsWith(tag)) return null;
	return { ...block, signature: signature.slice(tag.length) };
}

/** 같은 역할이 이어지면 한 메시지로 합친다(블록을 지우고 나면 생길 수 있다). 빈 메시지는 뺀다. */
function mergeRuns(messages: Message[]): Message[] {
	const out: Message[] = [];
	for (const message of messages) {
		const content = blocks(message.content);
		if (content.length === 0) continue;
		const last = out.at(-1);
		if (last && last.role === message.role) last.content = [...blocks(last.content), ...content];
		else out.push({ role: message.role, content: [...content] });
	}
	return out;
}

/** Anthropic 직행 요청: 다른 업체가 만든 thinking 블록만 뺀다. 나머지는 손대지 않는다. */
export function forNative(body: Json): Json {
	const messages = body.messages as Message[] | undefined;
	if (!Array.isArray(messages)) return body;
	let touched = false;
	const next = messages.map((message) => {
		if (typeof message.content === "string") return message;
		const content = message.content.map((block) => keepThinking(block, "native")).filter((b): b is Block => b !== null);
		if (content.length !== message.content.length) touched = true;
		return { ...message, content };
	});
	return touched ? { ...body, messages: mergeRuns(next) } : body;
}

/** 다른 업체용 표준 Messages 요청. `provider`는 thinking 서명 태그, `model`은 업체 쪽 ID. */
export function forForeign(body: Json, provider: string, model: string, effort?: Effort): Json {
	const tools: Block[] = [];
	const toolNames = new Set<string>();
	const addTool = (tool: unknown) => {
		if (!tool || typeof tool !== "object") return;
		const source = tool as Json;
		// 서버 도구(web_search 등 type이 있는 것)는 그 업체에 없다.
		if (typeof source.type === "string" && source.type !== "custom") return;
		if (typeof source.name !== "string" || toolNames.has(source.name)) return;
		toolNames.add(source.name);
		const out: Block = {};
		for (const key of TOOL_KEYS) if (source[key] !== undefined) out[key] = source[key];
		out.input_schema = out.input_schema ? strictSchema(out.input_schema) : { type: "object", properties: {} };
		tools.push(out);
	};
	for (const tool of (body.tools as unknown[] | undefined) ?? []) addTool(tool);

	// 대화 중간 system 메시지: 텍스트는 앞(없으면 다음) user 메시지 끝에 붙인다.
	const messages: Message[] = [];
	let pending: Block[] = [];
	for (const message of (body.messages as Message[] | undefined) ?? []) {
		const content: Block[] = [];
		for (const raw of blocks(message.content)) {
			if (raw.type === "tool_addition") {
				addTool(raw.tool);
				continue;
			}
			const block = keepThinking(raw, provider);
			if (!block || !KNOWN_BLOCKS.has(String(block.type))) continue;
			const clean = plainCache(block);
			if (clean.type === "tool_use") delete clean.caller;
			if (clean.type === "thinking") delete clean.display;
			if (clean.type === "tool_result" && Array.isArray(clean.content)) {
				clean.content = (clean.content as Block[])
					.filter((part) => part.type === "text" || part.type === "image")
					.map(plainCache);
			}
			content.push(clean);
		}
		if (message.role === "system") {
			const text = content.filter((block) => block.type === "text");
			const previous = messages.at(-1);
			if (previous?.role === "user") previous.content = [...blocks(previous.content), ...text];
			else pending.push(...text);
			continue;
		}
		if (message.role === "user" && pending.length > 0) {
			content.push(...pending);
			pending = [];
		}
		messages.push({ role: message.role, content });
	}
	if (pending.length > 0) messages.push({ role: "user", content: pending });

	const out: Json = { model, messages: mergeRuns(messages), max_tokens: body.max_tokens ?? 32000 };
	for (const key of ["system", "stream", "temperature", "top_p", "top_k", "stop_sequences", "tool_choice"]) {
		if (body[key] !== undefined) out[key] = body[key];
	}
	if (Array.isArray(out.system)) out.system = (out.system as Block[]).map(plainCache);
	if (tools.length > 0) out.tools = tools;
	else delete out.tool_choice;
	const thinking = body.thinking as Json | undefined;
	if (thinking && typeof thinking === "object") {
		const { display: _display, ...rest } = thinking;
		out.thinking = rest;
	}
	const sentEffort = (body.output_config as Json | undefined)?.effort;
	const finalEffort = effort ?? sentEffort;
	if (typeof finalEffort === "string") out.output_config = { effort: finalEffort };
	return out;
}

export type Usage = { input: number; output: number; cacheRead: number };

/** SSE 응답 변환: thinking 서명에 태그를 달고, 보고 모델명을 요청한 Claude ID로 돌린다. 사용량을 모은다. */
export class StreamRewriter {
	usage: Usage = { input: 0, output: 0, cacheRead: 0 };
	#buffer = "";
	#tagged = new Map<number, boolean>();
	#thinking = new Set<number>();
	readonly #tag: string;
	constructor(
		provider: string,
		private readonly requestedModel: string,
	) {
		this.#tag = tagOf(provider);
	}

	/** 받은 조각을 넣으면 내보낼 텍스트를 돌려준다(완성된 이벤트만). */
	push(chunk: string): string {
		this.#buffer += chunk;
		let out = "";
		let cut = this.#buffer.indexOf("\n\n");
		while (cut !== -1) {
			out += this.#event(this.#buffer.slice(0, cut));
			this.#buffer = this.#buffer.slice(cut + 2);
			cut = this.#buffer.indexOf("\n\n");
		}
		return out;
	}

	flush(): string {
		const rest = this.#buffer;
		this.#buffer = "";
		return rest.trim() ? this.#event(rest) : rest;
	}

	#event(raw: string): string {
		const lines = raw.split("\n");
		const dataAt = lines.findIndex((line) => line.startsWith("data:"));
		if (dataAt === -1) return `${raw}\n\n`;
		let data: Json;
		try {
			data = JSON.parse(lines[dataAt]!.slice(5).trim()) as Json;
		} catch {
			return `${raw}\n\n`;
		}
		const extra: string[] = [];
		const index = typeof data.index === "number" ? data.index : -1;
		switch (data.type) {
			case "message_start": {
				const message = data.message as Json | undefined;
				if (message) {
					message.model = this.requestedModel;
					this.#count(message.usage as Json | undefined);
				}
				break;
			}
			case "message_delta":
				this.#count(data.usage as Json | undefined);
				break;
			case "content_block_start": {
				const block = data.content_block as Block | undefined;
				if (block?.type === "thinking") {
					this.#thinking.add(index);
					if (typeof block.signature === "string" && block.signature) {
						block.signature = this.#tag + block.signature;
						this.#tagged.set(index, true);
					}
				}
				break;
			}
			case "content_block_delta": {
				const delta = data.delta as Json | undefined;
				if (delta?.type === "signature_delta" && !this.#tagged.get(index)) {
					delta.signature = this.#tag + String(delta.signature ?? "");
					this.#tagged.set(index, true);
				}
				break;
			}
			case "content_block_stop":
				if (this.#thinking.has(index) && !this.#tagged.get(index)) {
					this.#tagged.set(index, true);
					extra.push(
						`event: content_block_delta\ndata: ${JSON.stringify({
							type: "content_block_delta",
							index,
							delta: { type: "signature_delta", signature: this.#tag },
						})}\n\n`,
					);
				}
				break;
		}
		lines[dataAt] = `data: ${JSON.stringify(data)}`;
		return `${extra.join("")}${lines.join("\n")}\n\n`;
	}

	#count(usage: Json | undefined) {
		if (!usage) return;
		// message_start와 message_delta는 누적값을 준다: 큰 쪽을 남긴다.
		const num = (key: string) => (typeof usage[key] === "number" ? (usage[key] as number) : 0);
		this.usage.input = Math.max(this.usage.input, num("input_tokens"));
		this.usage.output = Math.max(this.usage.output, num("output_tokens"));
		this.usage.cacheRead = Math.max(this.usage.cacheRead, num("cache_read_input_tokens"));
	}
}

/** 스트리밍이 아닌 응답 본문 변환. */
export function rewriteJson(body: Json, provider: string, requestedModel: string): { body: Json; usage: Usage } {
	const tag = tagOf(provider);
	const content = Array.isArray(body.content)
		? (body.content as Block[]).map((block) =>
				block.type === "thinking" ? { ...block, signature: tag + String(block.signature ?? "") } : block,
			)
		: body.content;
	const usage = (body.usage as Json | undefined) ?? {};
	const num = (key: string) => (typeof usage[key] === "number" ? (usage[key] as number) : 0);
	return {
		body: { ...body, model: requestedModel, content },
		usage: { input: num("input_tokens"), output: num("output_tokens"), cacheRead: num("cache_read_input_tokens") },
	};
}

/** Anthropic 직행 응답의 사용량만 읽는다(바이트는 손대지 않는다). SSE면 `push`, JSON이면 `json`. */
export class UsageTap {
	usage: Usage = { input: 0, output: 0, cacheRead: 0 };
	#buffer = "";

	push(chunk: string) {
		this.#buffer += chunk;
		let cut = this.#buffer.indexOf("\n\n");
		while (cut !== -1) {
			this.#event(this.#buffer.slice(0, cut));
			this.#buffer = this.#buffer.slice(cut + 2);
			cut = this.#buffer.indexOf("\n\n");
		}
	}

	flush() {
		if (this.#buffer.trim()) this.#event(this.#buffer);
		this.#buffer = "";
	}

	json(body: unknown) {
		if (body && typeof body === "object") this.#count((body as Json).usage as Json | undefined);
	}

	#event(raw: string) {
		const line = raw.split("\n").find((entry) => entry.startsWith("data:"));
		if (!line || !line.includes('"usage"')) return;
		try {
			const data = JSON.parse(line.slice(5).trim()) as Json;
			if (data.type === "message_start") this.#count((data.message as Json | undefined)?.usage as Json | undefined);
			else if (data.type === "message_delta") this.#count(data.usage as Json | undefined);
		} catch {
			// 깨진 이벤트는 세지 않는다.
		}
	}

	#count(usage: Json | undefined) {
		if (!usage) return;
		const num = (key: string) => (typeof usage[key] === "number" ? (usage[key] as number) : 0);
		this.usage.input = Math.max(this.usage.input, num("input_tokens"));
		this.usage.output = Math.max(this.usage.output, num("output_tokens"));
		this.usage.cacheRead = Math.max(this.usage.cacheRead, num("cache_read_input_tokens"));
	}
}
