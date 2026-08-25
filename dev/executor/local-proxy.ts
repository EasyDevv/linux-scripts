import type { NormalizedConfig } from "./types";

interface ProxySocketData {
	target: string;
	protocols: string[];
	upstream?: WebSocket;
	queued: Array<string | Uint8Array>;
}

export function localUrl(name: string): string {
	return `http://${name}.localhost`;
}

function isHtmlNavigation(request: Request): boolean {
	return (
		request.method === "GET" &&
		(request.headers.get("sec-fetch-mode") === "navigate" ||
			request.headers.get("accept")?.includes("text/html") === true)
	);
}

export function upstreamUnavailableResponse(request: Request): Response {
	const headers = {
		"cache-control": "no-store, max-age=0",
		"retry-after": "1",
	};
	if (isHtmlNavigation(request)) {
		return new Response(
			'<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="1"><title>Restarting…</title><p>Development server restarting…</p>',
			{
				status: 502,
				headers: { ...headers, "content-type": "text/html; charset=utf-8" },
			},
		);
	}

	return new Response("Upstream unavailable", {
		status: 502,
		headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
	});
}

function drain(response: Response): void {
	void response.arrayBuffer().catch(() => undefined);
}

function forward(response: Response): Response {
	const responseHeaders = new Headers(response.headers);
	responseHeaders.delete("content-encoding");
	responseHeaders.delete("content-length");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: responseHeaders,
	});
}

export class LocalProxy {
	private routes = new Map<string, string>();
	private navigationFailureStartedAt = new Map<string, number>();
	private navigationSucceeded = new Set<string>();
	private server: ReturnType<typeof Bun.serve>;

	constructor(
		port = 80,
		private navigationTimeoutMs = 5_000,
		private onNavigationTimeout?: (name: string) => void,
		private startBudgetMs = 120_000,
	) {
		this.server = Bun.serve<ProxySocketData>({
			hostname: "127.0.0.1",
			port,
			fetch: (request, server) => this.handleRequest(request, server),
			websocket: {
				open: (socket) => {
					const upstream = new WebSocket(
						socket.data.target,
						socket.data.protocols,
					);
					upstream.binaryType = "arraybuffer";
					socket.data.upstream = upstream;
					upstream.addEventListener("open", () => {
						for (const message of socket.data.queued) upstream.send(message);
						socket.data.queued.length = 0;
					});
					upstream.addEventListener("message", (event) =>
						socket.send(event.data),
					);
					upstream.addEventListener("close", (event) => {
						socket.close(event.code, event.reason);
					});
					upstream.addEventListener("error", () => socket.close(1011));
				},
				message: (socket, message) => {
					const normalized =
						typeof message === "string" ? message : new Uint8Array(message);
					if (socket.data.upstream?.readyState === WebSocket.OPEN) {
						socket.data.upstream.send(normalized);
					} else {
						socket.data.queued.push(normalized);
					}
				},
				close: (socket, code, reason) => {
					if (socket.data.upstream?.readyState === WebSocket.OPEN) {
						const upstreamCode = [1005, 1006, 1015].includes(code)
							? 1000
							: code;
						socket.data.upstream.close(upstreamCode, reason);
					}
				},
			},
		});
		console.log(`[proxy] listening on http://localhost:${port}`);
	}

	get port(): number {
		const port = this.server.port;
		if (port === undefined) {
			throw new Error("Local proxy is not listening");
		}
		return port;
	}

	update(config: NormalizedConfig): void {
		const routes = new Map<string, string>();
		for (const [name] of config.instances) {
			const port = config.getPort(name);
			if (config.isEnabled(name) && port) routes.set(name.toLowerCase(), port);
		}
		this.routes = routes;
	}

	stop(): void {
		this.server.stop(true);
	}

	private route(
		request: Request,
	): { name: string; port: string; url: URL } | null {
		const url = new URL(request.url);
		const hostname = url.hostname.toLowerCase();
		if (!hostname.endsWith(".localhost")) return null;
		const name = hostname.slice(0, -".localhost".length);
		const port = this.routes.get(name);
		return port ? { name, port, url } : null;
	}

	private recordNavigationResult(
		name: string,
		succeeded: boolean,
		timedOut = false,
	): void {
		if (succeeded) {
			this.navigationSucceeded.add(name);
			this.navigationFailureStartedAt.delete(name);
			return;
		}

		const now = performance.now();
		const startedAt = this.navigationFailureStartedAt.get(name) ?? now;
		if (!this.navigationFailureStartedAt.has(name)) {
			this.navigationFailureStartedAt.set(name, startedAt);
		}

		const elapsed = now - startedAt;
		const ready = this.navigationSucceeded.has(name);
		const restartAfter = ready
			? this.navigationTimeoutMs
			: timedOut
				? this.startBudgetMs
				: this.navigationTimeoutMs;

		if (elapsed < restartAfter) return;

		this.navigationSucceeded.delete(name);
		this.navigationFailureStartedAt.set(name, now);
		this.onNavigationTimeout?.(name);
	}

	private async handleRequest(
		request: Request,
		server: Bun.Server<ProxySocketData>,
	): Promise<Response | undefined> {
		const route = this.route(request);
		if (!route) {
			const links = [...this.routes.keys()]
				.map((name) => `<li><a href="${localUrl(name)}">${name}</a></li>`)
				.join("");
			return new Response(
				`<!doctype html><meta charset="utf-8"><title>Executor</title><h1>Executor</h1><ul>${links}</ul>`,
				{
					status: links ? 200 : 404,
					headers: { "content-type": "text/html; charset=utf-8" },
				},
			);
		}

		const target = new URL(route.url);
		target.hostname = "127.0.0.1";
		target.port = route.port;
		const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);

		if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
			const headers = protocols[0]
				? { "sec-websocket-protocol": protocols[0] }
				: undefined;
			if (
				server.upgrade(request, {
					data: {
						target: target.toString().replace(/^http/, "ws"),
						protocols,
						queued: [],
					},
					headers,
				})
			) {
				return undefined;
			}
			return new Response("WebSocket upgrade failed", { status: 400 });
		}

		const headers = new Headers(request.headers);
		headers.set("host", `127.0.0.1:${route.port}`);
		headers.set("x-forwarded-host", route.url.host);
		headers.set("x-forwarded-proto", "http");
		headers.delete("accept-encoding");

		const navigation = isHtmlNavigation(request);
		const upstream = fetch(target, {
			method: request.method,
			headers,
			body:
				request.method === "GET" || request.method === "HEAD"
					? undefined
					: request.body,
			redirect: "manual",
		});

		if (!navigation) {
			try {
				return forward(await upstream);
			} catch {
				return upstreamUnavailableResponse(request);
			}
		}

		const timedOut = Symbol("timedOut");
		const winner = await Promise.race([
			upstream.then(
				(response) => response,
				(error: unknown) => error,
			),
			new Promise<typeof timedOut>((resolve) => {
				setTimeout(() => resolve(timedOut), this.navigationTimeoutMs);
			}),
		]);

		if (winner === timedOut) {
			void upstream.then(drain, () => undefined);
			this.recordNavigationResult(route.name, false, true);
			return upstreamUnavailableResponse(request);
		}

		if (winner instanceof Response) {
			this.recordNavigationResult(route.name, true);
			return forward(winner);
		}

		this.recordNavigationResult(route.name, false, false);
		return upstreamUnavailableResponse(request);
	}
}
