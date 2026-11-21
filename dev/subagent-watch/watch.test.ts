import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { digest, wakeText } from "./watch.ts";

const LONG = "/home/easydev/.claude/projects/-home-easydev-dev-private-quant/dbaba518-0570-4a4e-8b39-a17db4a1329e/subagents/agent-a02983ca094781b5e.jsonl";

test.if(existsSync(LONG))("dbaba518 deletion agent at 15 min: denials and re-reads are flagged, not finished", () => {
	const start = Date.parse("2026-11-21T01:31:47.733Z");
	const d = digest(LONG, start + 15 * 60000);
	expect(d.minutes).toBe(15);
	expect(d.finished).toBe(false);
	expect(d.denials.length).toBeGreaterThanOrEqual(4);
	expect(d.flags.some((f) => f.includes("denials"))).toBe(true);
	expect(d.flags.some((f) => f.includes("quant-signal.rs"))).toBe(true);
	expect(d.repeated.every(([k]) => !k.startsWith("Poll"))).toBe(true);
	const w = wakeText(d, { verdict: "redirect", reason: "r", message_to_agent: "m" }, "general-purpose");
	expect(w).toContain('SendMessage({to: "a02983ca094781b5e"');
	expect(w).toContain("Course correction to send: m");
});

test.if(existsSync(LONG))("the same agent at its end reads as finished (interrupted by the user)", () => {
	expect(digest(LONG).finished).toBe(true);
});
