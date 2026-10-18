/**
 * Decision daemon: HTTP JSON on loopback only.
 *
 * Routes: `GET /health`, `POST /v1/decide`, one `POST` per feature (`features/index.ts`), and
 * `POST /v1/outcome`. Callers (pi extension, Claude Code hooks) send state and receive
 * recommendations; applying them stays in the harness. Bad input is a 400; a backend failure is
 * a 200 with `status: "unavailable"`, so every client has exactly one "change nothing" path.
 */

import type { ClassifierQuestion, JsonObject } from "@earendil-works/pi-ai";
import { FEATURES } from "./features/index.ts";
import { isRecord, str } from "./features/types.ts";
import { createRuntime, type DaemonConfig, promptVersion, readConfig } from "./runtime.ts";
import { STATE_DIR } from "./state.ts";

export { CONFIG_PATH, DEFAULT_PORT, readConfig } from "./runtime.ts";

function bad(message: string): Response {
	return Response.json({ error: message }, { status: 400 });
}

async function body(req: Request): Promise<Record<string, unknown> | undefined> {
	try {
		const parsed = (await req.json()) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

type Handler = (req: Request) => Response | Promise<Response>;

export function startServer(config: DaemonConfig = readConfig()) {
	const { auth, ladder, budget, engine, log } = createRuntime(config);
	void ladder.refresh(true);
	const refreshTimer = setInterval(() => void ladder.refresh(), 60 * 60_000);
	refreshTimer.unref?.();

	const decide = engine.decide.bind(engine);
	const featureRoutes: Record<string, { POST: Handler }> = {};
	const versions: Record<string, string> = {};
	for (const def of FEATURES) {
		const runtime = def.load(promptVersion(config, def.name));
		versions[def.name] = runtime.version;
		featureRoutes[def.path] = {
			POST: async (req) => {
				const b = await body(req);
				if (!b) return bad("JSON object body is required");
				const input = runtime.parse(b);
				if (typeof input === "string") return bad(input);
				const result = await runtime.run(input, decide);
				log.write({
					type: "result",
					feature: def.name,
					version: runtime.version,
					harness: str(b.harness),
					sessionId: str(b.sessionId),
					currentModel: str(b.currentModel),
					...result,
				});
				return Response.json(result);
			},
		};
	}

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: config.port,
		routes: {
			"/health": {
				GET: () =>
					Response.json({
						ok: true,
						pid: process.pid,
						backends: engine.status(),
						keyOrigin: { openrouter: auth.origin("openrouter") ?? null, opencode: auth.origin("opencode") ?? null },
						budget: budget.snapshot(),
						prompts: versions,
						stateDir: STATE_DIR,
					}),
			},
			"/v1/decide": {
				POST: async (req) => {
					const b = await body(req);
					if (!b || !isRecord(b.state) || !isRecord(b.questions))
						return bad("state and questions objects are required");
					const decision = await engine.decide({
						feature: str(b.feature) ?? "adhoc",
						version: str(b.version) ?? "adhoc",
						state: b.state as JsonObject,
						questions: b.questions as Record<string, ClassifierQuestion>,
						harness: str(b.harness),
						sessionId: str(b.sessionId),
					});
					return Response.json(decision);
				},
			},
			...featureRoutes,
			"/v1/outcome": {
				POST: async (req) => {
					const b = await body(req);
					if (!b || !str(b.signal)) return bad("signal is required");
					log.write({
						type: "outcome",
						decisionId: str(b.decisionId),
						feature: str(b.feature),
						harness: str(b.harness),
						sessionId: str(b.sessionId),
						signal: str(b.signal),
						detail: b.detail ?? null,
					});
					return new Response(null, { status: 204 });
				},
			},
		},
		fetch: () => new Response("not found", { status: 404 }),
	});
	return { server, engine, stop: () => (clearInterval(refreshTimer), server.stop(true)) };
}
