/**
 * cc-proxy 서버 — Claude Code의 `ANTHROPIC_BASE_URL` 자리에 선다.
 *
 * `POST /v1/messages`만 들여다본다: 모델 ID의 별칭(haiku/sonnet/…)에 체인이 있고 프록시가 켜져 있으면
 * 체인 앞부터 그 업체로 보내고(요청은 `forForeign`으로 표준화), 실패(2xx 아님, 연결, 첫 바이트 시간 초과)면
 * 다음 대상, 모두 실패하면 원래 요청을 Anthropic으로 보낸다. 그 밖의 경로(count_tokens, OAuth, 모델 목록 …)는
 * 바이트 그대로 Anthropic으로 넘긴다. Claude Code의 OAuth 헤더는 Anthropic으로만 가고 다른 업체로는
 * 가지 않는다; 다른 업체에는 pi의 키를 붙인다.
 *
 * `/_proxy/*`는 관리용: health, stats, config, enabled.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	aliasOf,
	type Config,
	PORT,
	readConfig,
	splitTarget,
	type Target,
	validate,
	versionOf,
	configPath,
	writeConfig,
} from "./config.ts";
import { forForeign, forNative, rewriteJson, StreamRewriter, UsageTap } from "./normalize.ts";
import * as statsStore from "./stats.ts";
import { credentialFor, loggedIn, PROVIDER_NAMES, PROVIDERS } from "./upstreams.ts";

const ANTHROPIC = process.env.CC_PROXY_ANTHROPIC_URL ?? "https://api.anthropic.com";
/** 다른 업체가 응답 헤더를 줄 때까지 기다리는 시간. 그 뒤 스트림은 끝까지 기다린다. */
const FIRST_BYTE_MS = Number(process.env.CC_PROXY_FIRST_BYTE_MS ?? 90_000);
const PROCESS_SESSION = randomUUID();

const stats = statsStore.load();
let dirty = false;
const saver = setInterval(() => {
	if (!dirty) return;
	dirty = false;
	try {
		statsStore.save(stats);
	} catch (cause) {
		console.error("stats save failed", cause);
	}
}, 3000);
saver.unref?.();

/** 대상 → 쿨다운 끝 시각. */
const cooldowns = new Map<string, number>();

function currentConfig(): Config {
	const { config, error } = readConfig(PROVIDER_NAMES);
	if (error) console.error(`config.json invalid, using defaults: ${error}`);
	return config;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Anthropic으로 그대로(필요하면 본문만 바꿔서). */
async function toAnthropic(req: Request, url: URL, body?: string): Promise<Response> {
	const headers = new Headers(req.headers);
	headers.delete("host");
	headers.delete("content-length");
	headers.delete("accept-encoding");
	const upstream = await fetch(ANTHROPIC + url.pathname + url.search, {
		method: req.method,
		headers,
		body: body ?? (req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer()),
		signal: req.signal,
		redirect: "manual",
	});
	const out = new Headers(upstream.headers);
	out.delete("content-encoding");
	out.delete("content-length");
	return new Response(upstream.body, { status: upstream.status, headers: out });
}

function keepFailed(target: string, payload: string) {
	try {
		const dir = join(dirname(statsStore.statsPath()), "failed");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, `${target.replace(/[^\w.-]+/g, "_")}.json`), payload, { mode: 0o600 });
	} catch {
		// 진단용일 뿐이다.
	}
}

type Attempt ={ response: Response; target: string } | { failed: string };

const cools = (status: number | string) => typeof status === "string" || status === 401 || status === 403 || status === 429 || status >= 500;

async function toForeign(
	req: Request,
	body: Record<string, unknown>,
	target: Target,
	session: string,
	config: Config,
	onDone: (usage: statsStore.Outcome["usage"]) => void,
): Promise<Attempt> {
	const split = splitTarget(target.model)!;
	const provider = PROVIDERS[split.provider]!;
	const fail = (status: number | string, message: string): Attempt => {
		statsStore.recordFailure(stats, target.model, status, message);
		dirty = true;
		if (cools(status) && config.cooldownSeconds > 0) cooldowns.set(target.model, Date.now() + config.cooldownSeconds * 1000);
		console.error(`${target.model} failed (${status}): ${message.slice(0, 200)}`);
		return { failed: target.model };
	};
	const until = cooldowns.get(target.model);
	if (until && until > Date.now()) return { failed: target.model };

	let headers: Record<string, string>;
	try {
		const credential = await credentialFor(split.provider);
		headers = {
			"content-type": "application/json",
			accept: body.stream ? "text/event-stream" : "application/json",
			"anthropic-version": req.headers.get("anthropic-version") ?? "2023-06-01",
			...provider.auth(credential),
			...(provider.headers?.(session) ?? {}),
		};
	} catch (cause) {
		return fail("auth", cause instanceof Error ? cause.message : String(cause));
	}
	const requested = String(body.model);
	const payload = JSON.stringify(forForeign(body, split.provider, split.id, target.effort));
	const timer = new AbortController();
	const timeout = setTimeout(() => timer.abort(new Error("no response headers")), FIRST_BYTE_MS);
	let upstream: Response;
	try {
		upstream = await fetch(`${provider.baseUrl}/v1/messages`, {
			method: "POST",
			headers,
			body: payload,
			signal: AbortSignal.any([req.signal, timer.signal]),
		});
	} catch (cause) {
		clearTimeout(timeout);
		if (req.signal.aborted) throw cause;
		return fail("network", cause instanceof Error ? cause.message : String(cause));
	}
	clearTimeout(timeout);
	if (!upstream.ok) {
		// 요청 모양 문제(4xx)는 다시 재현해 고칠 수 있게 대상마다 마지막 하나를 남긴다(이 기기에만, 0600).
		if (upstream.status >= 400 && upstream.status < 500 && upstream.status !== 429) keepFailed(target.model, payload);
		return fail(upstream.status, await upstream.text().catch(() => ""));
	}

	const outHeaders = { "x-ccproxy-target": target.model };
	if (!body.stream || !upstream.body) {
		const parsed = rewriteJson((await upstream.json()) as Record<string, unknown>, split.provider, requested);
		onDone(parsed.usage);
		return { target: target.model, response: json(parsed.body) };
	}
	const rewriter = new StreamRewriter(split.provider, requested);
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const stream = upstream.body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				const out = rewriter.push(decoder.decode(chunk, { stream: true }));
				if (out) controller.enqueue(encoder.encode(out));
			},
			flush(controller) {
				const out = rewriter.flush();
				if (out) controller.enqueue(encoder.encode(out));
				onDone(rewriter.usage);
			},
		}),
	);
	return {
		target: target.model,
		response: new Response(stream, {
			status: 200,
			headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...outHeaders },
		}),
	};
}

async function messages(req: Request, url: URL): Promise<Response> {
	const text = await req.text();
	let body: Record<string, unknown>;
	try {
		body = JSON.parse(text) as Record<string, unknown>;
	} catch {
		return toAnthropic(req, url, text);
	}
	const config = currentConfig();
	const alias = aliasOf(body.model);
	const session = req.headers.get("x-claude-code-session-id") ?? undefined;
	const chain = config.enabled && alias ? config.routes[alias].chain : [];
	const record = (outcome: Omit<statsStore.Outcome, "session" | "alias">) => {
		statsStore.record(stats, { session, alias: alias ?? "other", ...outcome });
		dirty = true;
	};

	let failed = 0;
	for (const target of chain) {
		const attempt = await toForeign(req, body, target, session ?? PROCESS_SESSION, config, (usage) =>
			record({ target: target.model, fallbacks: failed, usage }),
		);
		if ("response" in attempt) return attempt.response;
		failed += 1;
	}

	const native = forNative(body);
	const response = await toAnthropic(req, url, native === body ? text : JSON.stringify(native));
	const target = `native/${String(body.model)}`;
	const out = new Headers(response.headers);
	if (failed > 0) out.set("x-ccproxy-target", target);
	if (!response.ok || !response.body) {
		record({ target: response.ok ? target : undefined, fallbacks: failed });
		return new Response(response.body, { status: response.status, headers: out });
	}
	// 바이트는 그대로 넘기고 사용량만 읽어, 응답이 끝날 때 센다.
	const tap = new UsageTap();
	const streamed = response.headers.get("content-type")?.includes("text/event-stream") ?? false;
	const decoder = new TextDecoder();
	let whole = "";
	const body$ = response.body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				const piece = decoder.decode(chunk, { stream: true });
				if (streamed) tap.push(piece);
				else whole += piece;
				controller.enqueue(chunk);
			},
			flush() {
				if (streamed) tap.flush();
				else {
					try {
						tap.json(JSON.parse(whole));
					} catch {
						// 사용량 없이 센다.
					}
				}
				record({ target, fallbacks: failed, usage: tap.usage });
			},
		}),
	);
	return new Response(body$, { status: response.status, headers: out });
}

function configView() {
	const { config, version, error } = readConfig(PROVIDER_NAMES);
	return {
		config,
		version,
		error,
		providers: PROVIDER_NAMES.map((name) => ({ name, loggedIn: loggedIn(name) })),
	};
}

function cooldownView() {
	const now = Date.now();
	return [...cooldowns.entries()].filter(([, until]) => until > now).map(([target, until]) => ({ target, until }));
}

async function admin(req: Request, url: URL): Promise<Response> {
	const route = `${req.method} ${url.pathname}`;
	if (req.method !== "GET" && !req.headers.get("content-type")?.includes("application/json")) {
		return json({ error: "content-type must be application/json" }, 415);
	}
	switch (route) {
		case "GET /_proxy/health":
			return json({ ok: true, enabled: currentConfig().enabled, port: PORT, pid: process.pid });
		case "GET /_proxy/stats": {
			const session = url.searchParams.get("session");
			return json({
				enabled: currentConfig().enabled,
				total: stats.total,
				day: stats.day,
				session: session ? (stats.sessions[session] ?? statsStore.emptyBucket()) : null,
				cooldowns: cooldownView(),
				recentFailures: stats.recentFailures,
			});
		}
		case "GET /_proxy/config":
			return json(configView());
		case "PUT /_proxy/config": {
			const input = (await req.json()) as { config?: unknown; version?: string };
			if (input.version !== versionOf(configPath())) {
				return json({ ...configView(), error: "config.json changed since it was read; reload" }, 409);
			}
			try {
				writeConfig(validate(input.config, PROVIDER_NAMES));
			} catch (cause) {
				return json({ error: cause instanceof Error ? cause.message : String(cause) }, 400);
			}
			return json(configView());
		}
		case "POST /_proxy/enabled": {
			const input = (await req.json()) as { enabled?: unknown };
			if (typeof input.enabled !== "boolean") return json({ error: "enabled must be true or false" }, 400);
			writeConfig({ ...currentConfig(), enabled: input.enabled });
			return json(configView());
		}
		case "POST /_proxy/reset-cooldowns":
			cooldowns.clear();
			return json({ cooldowns: [] });
	}
	return json({ error: `no route ${route}` }, 404);
}

/** 이 기기 안의 Claude Code만: 브라우저(Origin)와 DNS rebinding(Host)은 막는다. 프록시가 pi의 키를 붙이기 때문이다. */
function refuse(req: Request, url: URL): Response | null {
	if (req.headers.get("origin")) return json({ error: "browser requests are refused" }, 403);
	const host = req.headers.get("host") ?? "";
	if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return json({ error: "bad host" }, 403);
	if (url.pathname.startsWith("/v1/") && !req.headers.get("authorization") && !req.headers.get("x-api-key")) {
		return json({ type: "error", error: { type: "authentication_error", message: "cc-proxy: no Anthropic credential" } }, 401);
	}
	return null;
}

export function serve(port = PORT) {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port,
		idleTimeout: 0,
		async fetch(req) {
			const url = new URL(req.url);
			const refused = refuse(req, url);
			if (refused) return refused;
			try {
				if (url.pathname.startsWith("/_proxy/")) return await admin(req, url);
				if (req.method === "POST" && url.pathname === "/v1/messages") return await messages(req, url);
				return await toAnthropic(req, url);
			} catch (cause) {
				if (req.signal.aborted) return new Response(null, { status: 499 });
				const message = cause instanceof Error ? cause.message : String(cause);
				console.error(`${req.method} ${url.pathname}: ${message}`);
				return json({ type: "error", error: { type: "api_error", message: `cc-proxy: ${message}` } }, 502);
			}
		},
	});
	const flush = () => {
		try {
			statsStore.save(stats);
		} catch {
			// 끝나는 중이다.
		}
		process.exit(0);
	};
	process.on("SIGTERM", flush);
	process.on("SIGINT", flush);
	console.log(`cc-proxy on http://127.0.0.1:${server.port}`);
	return server;
}
