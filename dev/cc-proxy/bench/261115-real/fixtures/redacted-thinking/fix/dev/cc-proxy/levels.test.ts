import { describe, expect, test } from "bun:test";
import { AGENT_HEADER, DEFAULT_CONFIG, proxiable, validate } from "./config.ts";
import { offAllowed, sendEffort } from "./levels.ts";
import { forForeign, withCommon } from "./normalize.ts";

const store = {
	"opencode-go": { models: [{ id: "deepseek-v4.1-flash", reasoning: true, thinkingLevelMap: { off: null, low: "low" } }] },
	xai: { models: [{ id: "grok-4.7", reasoning: true, thinkingLevelMap: { off: null, low: "low" } }, { id: "grok-4.3", reasoning: true, thinkingLevelMap: {} }] },
};
const overrides = { providers: { "opencode-go": { modelOverrides: { "deepseek-v4.1-flash": { thinkingLevelMap: { off: "none" } } } } } };

describe("offAllowed", () => {
	test("reads the catalog with pi's overrides, not the provider name", () => {
		expect(offAllowed(store, overrides, "opencode-go", "deepseek-v4.1-flash")).toBe(true);
		expect(offAllowed(store, {}, "opencode-go", "deepseek-v4.1-flash")).toBe(false);
		expect(offAllowed(store, overrides, "xai", "grok-4.7")).toBe(false);
		expect(offAllowed(store, overrides, "xai", "grok-4.3")).toBe(true);
		expect(offAllowed(store, overrides, "xai", "unknown")).toBe(false);
	});
	test("off without support goes out as low", () => {
		expect(sendEffort("off", false)).toBe("low");
		expect(sendEffort("off", true)).toBe("off");
		expect(sendEffort("high", false)).toBe("high");
		expect(sendEffort(undefined, false)).toBeUndefined();
	});
});

describe("forForeign off and common", () => {
	const body = {
		model: "claude-haiku-5-5",
		thinking: { type: "adaptive" },
		output_config: { effort: "medium" },
		system: [{ type: "text", text: "You are Claude Code" }],
		messages: [{ role: "user", content: "hi" }],
	};
	test("off disables thinking and drops effort", () => {
		const out = forForeign(body, "opencode-go", "deepseek-v4.1-flash", "off");
		expect(out.thinking).toEqual({ type: "disabled" });
		expect(out.output_config).toBeUndefined();
	});
	test("common goes once at the end of system", () => {
		const out = forForeign(body, "xai", "grok-4.7", "low", "Think concisely.");
		expect(out.system).toEqual([{ type: "text", text: "You are Claude Code" }, { type: "text", text: "Think concisely." }]);
		expect(withCommon(out.system, "Think concisely.")).toBe(out.system);
		expect(withCommon("A", "B")).toBe("A\n\nB");
		expect(forForeign(body, "xai", "grok-4.7").system).toEqual(body.system);
	});
});

describe("validate route.common", () => {
	test("keeps false only, refuses non-boolean", () => {
		const providers = ["opencode-go", "xai"];
		expect(validate({ routes: { haiku: { chain: [], common: false } } }, providers).routes.haiku).toEqual({ chain: [], common: false });
		expect(validate({ routes: { haiku: { chain: [], common: true } } }, providers).routes.haiku).toEqual({ chain: [] });
		expect(() => validate({ routes: { haiku: { chain: [], common: "no" } } }, providers)).toThrow(/common/);
		expect(validate({ routes: { haiku: { chain: [{ model: "xai/grok-4.7", effort: "off" }] } } }, providers).routes.haiku.chain[0]?.effort).toBe("off");
	});
});

describe("subagentsOnly", () => {
	test("only requests with the agent header take the chain", () => {
		const subagent = new Headers({ [AGENT_HEADER]: "a1" });
		expect(proxiable(DEFAULT_CONFIG, new Headers())).toBe(false);
		expect(proxiable(DEFAULT_CONFIG, subagent)).toBe(true);
		expect(proxiable({ ...DEFAULT_CONFIG, subagentsOnly: false }, new Headers())).toBe(true);
		expect(() => validate({ subagentsOnly: "yes" }, ["opencode-go", "xai"])).toThrow(/subagentsOnly/);
	});
});
