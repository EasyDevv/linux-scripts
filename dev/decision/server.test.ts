import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DecideRequest, Decision } from "./engine.ts";
import { createRuntime } from "./runtime.ts";
import { startServer } from "./server.ts";

const requests: DecideRequest[] = [];
const unavailable: Decision = {
	status: "unavailable",
	decisionId: "d1",
	calibrated: false,
	answers: {},
	latencyMs: 0,
	costUsd: 0,
	cached: false,
	skipped: [],
};

const runtime = {
	auth: { origin: () => undefined },
	budget: { snapshot: () => ({ day: "", spentUsd: 0, dailyUsd: 1 }) },
	engine: {
		decide: async (request: DecideRequest) => {
			requests.push(request);
			return unavailable;
		},
		status: () => [],
	},
	log: { write: () => {} },
} as unknown as ReturnType<typeof createRuntime>;

let daemon: ReturnType<typeof startServer>;
let base: string;

beforeAll(() => {
	daemon = startServer({ port: 0, dailyBudgetUsd: 0, cacheTtlSec: 0, timeoutMs: 1000, prompts: {} }, runtime);
	base = `http://127.0.0.1:${daemon.server.port}`;
});

afterAll(() => daemon.stop());

describe("dispatch is no longer a mounted feature", () => {
	test("POST /v1/dispatch is not found and /health lists no dispatch prompt", async () => {
		const route = await fetch(`${base}/v1/dispatch`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ prompt: "x" }),
		});
		expect(route.status).toBe(404);
		const health = (await (await fetch(`${base}/health`)).json()) as { prompts: Record<string, string> };
		expect(health.prompts.dispatch).toBeUndefined();
	});

	test("POST /v1/decide still accepts feature dispatch", async () => {
		const response = await fetch(`${base}/v1/decide`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				feature: "dispatch",
				version: "v1",
				harness: "dashboard",
				state: { prompt: "서버 에러 고쳐" },
				questions: { kind: { type: "choice", instructions: "kind?", criteria: { task: "do it" } } },
			}),
		});
		expect(response.status).toBe(200);
		expect(((await response.json()) as Decision).status).toBe("unavailable");
		expect(requests.at(-1)).toMatchObject({ feature: "dispatch", version: "v1", harness: "dashboard" });
	});
});
