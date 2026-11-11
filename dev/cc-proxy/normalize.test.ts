import { describe, expect, test } from "bun:test";
import { aliasOf, DEFAULT_CONFIG, validate } from "./config.ts";
import { forForeign, forNative, keepThinking, rewriteJson, StreamRewriter, strictSchema, UsageTap } from "./normalize.ts";

describe("aliasOf", () => {
	test("maps Claude ids to aliases", () => {
		expect(aliasOf("claude-haiku-5-5")).toBe("haiku");
		expect(aliasOf("claude-opus-5-5[1m]")).toBe("opus");
		expect(aliasOf("claude-sonnet-5-5-20261001")).toBe("sonnet");
		expect(aliasOf("grok-4.7")).toBeNull();
		expect(aliasOf(undefined)).toBeNull();
	});
});

describe("validate", () => {
	const providers = ["opencode-go", "xai"];
	test("fills defaults", () => {
		expect(validate({}, providers)).toEqual(DEFAULT_CONFIG);
	});
	test("refuses unknown providers, duplicates, bad effort", () => {
		expect(() => validate({ routes: { haiku: { chain: [{ model: "foo/bar" }] } } }, providers)).toThrow(/not supported/);
		expect(() =>
			validate({ routes: { haiku: { chain: [{ model: "xai/grok-4.7" }, { model: "xai/grok-4.7" }] } } }, providers),
		).toThrow(/twice/);
		expect(() => validate({ routes: { haiku: { chain: [{ model: "xai/grok-4.7", effort: "ultra" }] } } }, providers)).toThrow(
			/effort/,
		);
	});
});

/** Claude Code 2.1.322가 실제로 보내는 모양(261111 캡처를 줄인 것). */
const captured = {
	model: "claude-haiku-5-5",
	max_tokens: 128000,
	stream: true,
	metadata: { user_id: '{"account_uuid":"00000000-0000-0000-0000-000000000000"}' },
	context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] },
	thinking: { type: "adaptive", display: "omitted" },
	output_config: { effort: "medium" },
	system: [{ type: "text", text: "You are Claude Code", cache_control: { type: "ephemeral", ttl: "1h" } }],
	tools: [
		{ name: "Read", description: "read", input_schema: { type: "object", properties: { p: { type: "string" } }, required: ["p"] } },
		{ name: "ListAgents", description: "list", input_schema: { type: "object", properties: {} } },
		{ type: "web_search_20250305", name: "web_search" },
	],
	messages: [
		{ role: "user", content: [{ type: "text", text: "hi" }] },
		{
			role: "system",
			content: [
				{ type: "text", text: "<reminder>" },
				{ type: "tool_addition", tool: { name: "Late", description: "late", input_schema: { type: "object", properties: {} } } },
			],
		},
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "anthropic", signature: "EqAnthropicSig" },
				{ type: "thinking", thinking: "grok", signature: "ccproxy:xai:" },
				{ type: "tool_use", id: "t1", name: "Read", input: { p: "/x" }, caller: { type: "direct" }, cache_control: { type: "ephemeral", ttl: "1h" } },
			],
		},
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "ok" }, { type: "tool_reference", tool_name: "X" }] }] },
		{ role: "system", content: [{ type: "text", text: "<late reminder>" }] },
	],
};

describe("forForeign", () => {
	const out = forForeign(structuredClone(captured), "xai", "grok-4.7") as any;

	test("drops account metadata and Anthropic-only fields", () => {
		expect(out.metadata).toBeUndefined();
		expect(out.context_management).toBeUndefined();
		expect(out.thinking).toEqual({ type: "adaptive" });
		expect(out.model).toBe("grok-4.7");
		expect(out.output_config).toEqual({ effort: "medium" });
	});

	test("folds system messages into user turns and keeps roles alternating", () => {
		expect(out.messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user"]);
		expect(out.messages[0].content.map((b: any) => b.text)).toEqual(["hi", "<reminder>"]);
		expect(out.messages[2].content.at(-1).text).toBe("<late reminder>");
	});

	test("moves tool_addition into tools, drops server tools, fills required", () => {
		expect(out.tools.map((t: any) => t.name)).toEqual(["Read", "ListAgents", "Late"]);
		expect(out.tools[1].input_schema.required).toEqual([]);
	});

	test("keeps only this provider's thinking, strips caller, ttl and tool_reference", () => {
		const assistant = out.messages[1].content;
		expect(assistant.filter((b: any) => b.type === "thinking")).toEqual([{ type: "thinking", thinking: "grok", signature: "" }]);
		const toolUse = assistant.find((b: any) => b.type === "tool_use");
		expect(toolUse.caller).toBeUndefined();
		expect(toolUse.cache_control).toEqual({ type: "ephemeral" });
		expect(out.messages[2].content[0].content).toEqual([{ type: "text", text: "ok" }]);
	});

	test("a route effort overrides the one Claude Code sent", () => {
		expect((forForeign(structuredClone(captured), "xai", "grok-4.7", "low") as any).output_config).toEqual({ effort: "low" });
	});
});

describe("forNative", () => {
	test("drops other providers' thinking only", () => {
		const out = forNative(structuredClone(captured)) as any;
		const thinking = out.messages[2].content.filter((b: any) => b.type === "thinking");
		expect(thinking.map((b: any) => b.signature)).toEqual(["EqAnthropicSig"]);
		expect(out.metadata).toBeDefined();
	});
	test("returns the same object when nothing changes", () => {
		const body = { model: "claude-opus-5-5", messages: [{ role: "user", content: "hi" }] };
		expect(forNative(body)).toBe(body);
	});
	test("keepThinking", () => {
		expect(keepThinking({ type: "redacted_thinking", data: "x" }, "xai")).toBeNull();
		expect(keepThinking({ type: "thinking", signature: "ccproxy:opencode-go:abc" }, "opencode-go")).toEqual({
			type: "thinking",
			signature: "abc",
		});
	});
});

describe("StreamRewriter", () => {
	const sse = (data: object) => `event: x\ndata: ${JSON.stringify(data)}\n\n`;
	test("tags thinking signatures, restores the model, counts usage across split chunks", () => {
		const rewriter = new StreamRewriter("opencode-go", "claude-haiku-5-5");
		const input =
			sse({ type: "message_start", message: { model: "deepseek-v4.1-flash", usage: { input_tokens: 10, output_tokens: 1 } } }) +
			sse({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }) +
			sse({ type: "content_block_stop", index: 0 }) +
			sse({ type: "content_block_start", index: 1, content_block: { type: "thinking", thinking: "" } }) +
			sse({ type: "content_block_delta", index: 1, delta: { type: "signature_delta", signature: "s1" } }) +
			sse({ type: "content_block_stop", index: 1 }) +
			sse({ type: "message_delta", usage: { output_tokens: 42 } });
		const out = rewriter.push(input.slice(0, 50)) + rewriter.push(input.slice(50)) + rewriter.flush();
		const events = out
			.split("\n\n")
			.filter(Boolean)
			.map((raw) => JSON.parse(raw.split("\n").find((l) => l.startsWith("data:"))!.slice(5)));
		expect(events[0].message.model).toBe("claude-haiku-5-5");
		expect(events.filter((e) => e.delta?.type === "signature_delta").map((e) => e.delta.signature)).toEqual([
			"ccproxy:opencode-go:",
			"ccproxy:opencode-go:s1",
		]);
		expect(rewriter.usage).toEqual({ input: 10, output: 42, cacheRead: 0 });
	});
	test("rewriteJson tags non-streamed thinking", () => {
		const { body, usage } = rewriteJson(
			{ model: "grok-4.7", content: [{ type: "thinking", thinking: "t", signature: "z" }], usage: { input_tokens: 3, output_tokens: 4 } },
			"xai",
			"claude-sonnet-5-5",
		);
		expect(body.model).toBe("claude-sonnet-5-5");
		expect((body.content as any)[0].signature).toBe("ccproxy:xai:z");
		expect(usage).toEqual({ input: 3, output: 4, cacheRead: 0 });
	});
});

test("strictSchema drops non-portable keywords, keeps property names and values", () => {
	expect(
		strictSchema({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			type: "object",
			properties: {
				pattern: { type: "string", pattern: "^[^\\0]*$" },
				mode: { const: "x" },
				map: { type: "object", propertyNames: { maxLength: 4 }, additionalProperties: { type: "string" } },
			},
			required: ["pattern"],
		}),
	).toEqual({
		type: "object",
		properties: {
			pattern: { type: "string" },
			mode: { enum: ["x"] },
			map: { type: "object", additionalProperties: { type: "string" } },
		},
		required: ["pattern"],
	});
});

test("strictSchema", () => {
	expect(strictSchema({ type: "object", properties: { a: { type: "object", properties: {}, default: null } } })).toEqual({
		type: "object",
		properties: { a: { type: "object", properties: {}, required: [] } },
		required: [],
	});
});

test("UsageTap reads native usage from SSE across chunks and from JSON", () => {
	const tap = new UsageTap();
	const sse =
		`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 5, cache_read_input_tokens: 900, output_tokens: 1 } } })}\n\n` +
		`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { text: "usage" } })}\n\n` +
		`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 33 } })}\n\n`;
	tap.push(sse.slice(0, 40));
	tap.push(sse.slice(40));
	tap.flush();
	expect(tap.usage).toEqual({ input: 5, output: 33, cacheRead: 900 });
	const json = new UsageTap();
	json.json({ usage: { input_tokens: 2, output_tokens: 3 } });
	expect(json.usage).toEqual({ input: 2, output: 3, cacheRead: 0 });
});
