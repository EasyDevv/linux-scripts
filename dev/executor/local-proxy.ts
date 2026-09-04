import type { NormalizedConfig } from "./types";

const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"proxy-connection",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);
const TEXT_ENCODER = new TextEncoder();
const DEFAULT_HTTP_IDLE_TIMEOUT_SECONDS = 10;
const DEFAULT_MAX_REQUEST_BODY_SIZE = 128 * 1024 * 1024;
const DEFAULT_STOP_GRACE_PERIOD_MS = 5_000;
const DEFAULT_WEBSOCKET_QUEUE_BYTES = 1 * 1024 * 1024;
const DEFAULT_WEBSOCKET_QUEUE_MESSAGES = 256;
const DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_WEBSOCKET_BUFFERED_AMOUNT_LIMIT = 1 * 1024 * 1024;
const DEFAULT_WEBSOCKET_IDLE_TIMEOUT_SECONDS = 120;
const DEFAULT_WEBSOCKET_MAX_PAYLOAD_LENGTH = 16 * 1024 * 1024;
const STOP_TIMEOUT = Symbol("stop timeout");

type ProxyMessage = string | Uint8Array;
type FlowControlledWebSocket = WebSocket & {
	pause?: () => void;
	resume?: () => void;
	terminate?: () => void;
};

type UpstreamListeners = {
	open: () => void;
	message: (event: MessageEvent) => void;
	close: (event: CloseEvent) => void;
	error: () => void;
};

interface ProxySocketData {
	target: string;
	protocols: string[];
	upstream?: FlowControlledWebSocket;
	upstreamListeners?: UpstreamListeners;
	connectTimer?: ReturnType<typeof setTimeout>;
	queued: ProxyMessage[];
	queuedBytes: number;
	upstreamPaused: boolean;
	closed: boolean;
}

export interface LocalProxyOptions {
	stopGracePeriodMs?: number;
	websocketQueueBytes?: number;
	websocketQueueMessages?: number;
	websocketConnectTimeoutMs?: number;
	websocketBufferedAmountLimit?: number;
	websocketIdleTimeoutSeconds?: number;
	websocketMaxPayloadLength?: number;
	httpIdleTimeoutSeconds?: number;
	maxRequestBodySize?: number;
}

function nonNegativeOption(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}

function positiveIntegerOption(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: fallback;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		switch (character) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&#39;";
		}
	});
}

function forwardHeaders(source: HeadersInit): Headers {
	const headers = new Headers(source);
	const connectionTokens = new Set<string>();
	for (const headerName of ["connection", "proxy-connection"]) {
		const value = headers.get(headerName);
		if (!value) continue;
		for (const token of value.split(",")) {
			const normalized = token.trim().toLowerCase();
			if (normalized) connectionTokens.add(normalized);
		}
	}

	for (const name of Array.from(headers.keys())) {
		const normalized = name.toLowerCase();
		if (HOP_BY_HOP_HEADERS.has(normalized) || connectionTokens.has(normalized)) {
			headers.delete(name);
		}
	}
	return headers;
}

function linkAbortSignal(
	source: AbortSignal,
	target: AbortController,
): () => void {
	let active = true;
	const onAbort = (): void => {
		if (active && !target.signal.aborted) target.abort();
	};

	if (source.aborted) onAbort();
	else source.addEventListener("abort", onAbort, { once: true });

	return () => {
		if (!active) return;
		active = false;
		source.removeEventListener("abort", onAbort);
	};
}

function trackedBody(
	body: ReadableStream<Uint8Array>,
	onDone: () => void,
	onCancel?: () => void,
): ReadableStream<Uint8Array> {
	const reader = body.getReader();
	let finished = false;
	const finish = (): void => {
		if (finished) return;
		finished = true;
		onDone();
	};

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const result = await reader.read();
				if (result.done) {
					finish();
					controller.close();
					return;
				}
				controller.enqueue(result.value);
			} catch (error) {
				finish();
				controller.error(error);
			}
		},
		async cancel(reason) {
			try {
				onCancel?.();
			} finally {
				finish();
			}
			await reader.cancel(reason).catch(() => undefined);
		},
	});
}

function forward(
	response: Response,
	onDone?: () => void,
	onCancel?: () => void,
): Response {
	const responseHeaders = forwardHeaders(response.headers);
	// Bun fetch transparently decompresses responses. The original framing headers
	// would describe the compressed body and must not be forwarded with the stream.
	responseHeaders.delete("content-encoding");
	responseHeaders.delete("content-length");

	const body = response.body;
	if (body === null) {
		onDone?.();
		return new Response(null, {
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders,
		});
	}

	return new Response(
		onDone ? trackedBody(body, onDone, onCancel) : body,
		{
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders,
		},
	);
}

function isEventStream(request: Request, response?: Response): boolean {
	const requestAcceptsStream = request.headers
		.get("accept")
		?.toLowerCase()
		.split(",")
		.some((value) => value.trim().startsWith("text/event-stream"));
	const responseIsStream = response?.headers
		.get("content-type")
		?.toLowerCase()
		.startsWith("text/event-stream");
	return requestAcceptsStream === true || responseIsStream === true;
}

function socketMessage(message: unknown): ProxyMessage | null {
	if (typeof message === "string") return message;
	if (message instanceof Uint8Array) return message;
	if (message instanceof ArrayBuffer) return new Uint8Array(message);
	if (ArrayBuffer.isView(message)) {
		return new Uint8Array(
			message.buffer as ArrayBuffer,
			message.byteOffset,
			message.byteLength,
		);
	}
	return null;
}

function copySocketMessage(message: unknown): ProxyMessage | null {
	const normalized = socketMessage(message);
	if (normalized === null || typeof normalized === "string") return normalized;
	return new Uint8Array(normalized);
}

function socketMessageBytes(message: ProxyMessage): number {
	return typeof message === "string"
		? TEXT_ENCODER.encode(message).byteLength
		: message.byteLength;
}

function clientCloseCode(code: number): number {
	return [1005, 1006, 1015].includes(code) ? 1000 : code;
}

function closeReason(reason: string): string {
	if (TEXT_ENCODER.encode(reason).byteLength <= 123) return reason;
	let shortened = reason;
	while (shortened.length > 0 && TEXT_ENCODER.encode(`${shortened}…`).byteLength > 123) {
		shortened = shortened.slice(0, -1);
	}
	return `${shortened}…`;
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

export function upstreamUnavailableResponse(
	request: Request,
	phase: "starting" | "restarting" = "restarting",
): Response {
	const headers = {
		"cache-control": "no-store, max-age=0",
		"retry-after": "1",
	};
	if (isHtmlNavigation(request)) {
		const title = phase === "starting" ? "Starting…" : "Restarting…";
		const message =
			phase === "starting"
				? "Development server starting…"
				: "Development server restarting…";
		return new Response(
			`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="1"><title>${title}</title><p>${message}</p>`,
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

export class LocalProxy {
	private routes = new Map<string, string>();
	private navigationFailureStartedAt = new Map<string, number>();
	private navigationSucceeded = new Set<string>();
	private server: ReturnType<typeof Bun.serve>;
	private stopPromise: Promise<void> | null = null;
	private lastHandlerErrorAt = 0;
	private readonly stopGracePeriodMs: number;
	private readonly websocketQueueBytes: number;
	private readonly websocketQueueMessages: number;
	private readonly websocketConnectTimeoutMs: number;
	private readonly websocketBufferedAmountLimit: number;
	private readonly websocketIdleTimeoutSeconds: number;
	private readonly websocketMaxPayloadLength: number;

	constructor(
		port = 80,
		private navigationTimeoutMs = 5_000,
		private onNavigationTimeout?: (name: string) => void,
		private startBudgetMs = 120_000,
		options: LocalProxyOptions = {},
	) {
		this.stopGracePeriodMs = nonNegativeOption(
			options.stopGracePeriodMs,
			DEFAULT_STOP_GRACE_PERIOD_MS,
		);
		this.websocketQueueBytes = positiveIntegerOption(
			options.websocketQueueBytes,
			DEFAULT_WEBSOCKET_QUEUE_BYTES,
		);
		this.websocketQueueMessages = positiveIntegerOption(
			options.websocketQueueMessages,
			DEFAULT_WEBSOCKET_QUEUE_MESSAGES,
		);
		this.websocketConnectTimeoutMs = nonNegativeOption(
			options.websocketConnectTimeoutMs,
			DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS,
		);
		this.websocketBufferedAmountLimit = positiveIntegerOption(
			options.websocketBufferedAmountLimit,
			DEFAULT_WEBSOCKET_BUFFERED_AMOUNT_LIMIT,
		);
		this.websocketIdleTimeoutSeconds = positiveIntegerOption(
			options.websocketIdleTimeoutSeconds,
			DEFAULT_WEBSOCKET_IDLE_TIMEOUT_SECONDS,
		);
		this.websocketMaxPayloadLength = positiveIntegerOption(
			options.websocketMaxPayloadLength,
			DEFAULT_WEBSOCKET_MAX_PAYLOAD_LENGTH,
		);

		this.server = Bun.serve<ProxySocketData>({
			hostname: "127.0.0.1",
			port,
			idleTimeout: positiveIntegerOption(
				options.httpIdleTimeoutSeconds,
				DEFAULT_HTTP_IDLE_TIMEOUT_SECONDS,
			),
			maxRequestBodySize: positiveIntegerOption(
				options.maxRequestBodySize,
				DEFAULT_MAX_REQUEST_BODY_SIZE,
			),
			fetch: (request, server) => this.handleRequest(request, server),
			error: (error) => this.handleServerError(error),
			websocket: {
				maxPayloadLength: this.websocketMaxPayloadLength,
				backpressureLimit: this.websocketBufferedAmountLimit,
				closeOnBackpressureLimit: true,
				idleTimeout: this.websocketIdleTimeoutSeconds,
				perMessageDeflate: false,
				open: (socket) => this.openWebSocket(socket),
				message: (socket, message) => this.handleWebSocketMessage(socket, message),
				drain: (socket) => this.drainWebSocket(socket),
				close: (socket, code, reason) =>
					this.closeWebSocket(socket, code, reason),
			},
		});
		console.log(`[proxy] listening on http://localhost:${port}`);
	}

	get snapshot(): {
		pendingRequests: number;
		pendingWebSockets: number;
	} {
		return {
			pendingRequests: this.server.pendingRequests,
			pendingWebSockets: this.server.pendingWebSockets,
		};
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

	stop(gracePeriodMs = this.stopGracePeriodMs): Promise<void> {
		if (!this.stopPromise) this.stopPromise = this.stopServer(gracePeriodMs);
		return this.stopPromise;
	}

	private async stopServer(gracePeriodMs: number): Promise<void> {
		const graceful = Promise.resolve(this.server.stop()).then(
			() => ({ ok: true as const }),
			(error: unknown) => ({ ok: false as const, error }),
		);

		if (gracePeriodMs === Infinity) {
			const result = await graceful;
			if (!result.ok) {
				await this.server.stop(true);
				throw result.error;
			}
			return;
		}

		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<typeof STOP_TIMEOUT>((resolve) => {
			timer = setTimeout(
				() => resolve(STOP_TIMEOUT),
				Math.max(0, gracePeriodMs),
			);
		});
		try {
			const result = await Promise.race([graceful, timeout]);
			if (result === STOP_TIMEOUT) {
				await this.server.stop(true);
				return;
			}
			if (!result.ok) {
				await this.server.stop(true);
				throw result.error;
			}
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
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
		try {
			this.onNavigationTimeout?.(name);
		} catch (error) {
			this.handleServerError(error);
		}
	}

	private handleServerError(error: unknown): Response {
		const now = Date.now();
		if (now - this.lastHandlerErrorAt >= 1_000) {
			this.lastHandlerErrorAt = now;
			const detail = error instanceof Error ? error.message : String(error);
			console.error(`[proxy] request handler failed: ${detail}`);
		}
		return new Response("Proxy handler error", {
			status: 500,
			headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
		});
	}

	private openWebSocket(socket: Bun.ServerWebSocket<ProxySocketData>): void {
		const data = socket.data;
		if (data.closed) return;

		let upstream: FlowControlledWebSocket;
		try {
			upstream = new WebSocket(data.target, data.protocols);
			upstream.binaryType = "arraybuffer";
		} catch {
			this.closeProxySocket(socket, 1011, "Unable to connect upstream");
			return;
		}

		data.upstream = upstream;
		const listeners: UpstreamListeners = {
			open: () => this.openUpstream(socket, upstream),
			message: (event) => this.forwardUpstreamMessage(socket, upstream, event),
			close: (event) => this.upstreamClosed(socket, upstream, event),
			error: () => this.closeProxySocket(socket, 1011, "Upstream WebSocket error"),
		};
		data.upstreamListeners = listeners;
		upstream.addEventListener("open", listeners.open);
		upstream.addEventListener("message", listeners.message);
		upstream.addEventListener("close", listeners.close);
		upstream.addEventListener("error", listeners.error);
		if (data.closed || data.upstream !== upstream) return;
		data.connectTimer = setTimeout(() => {
			if (
				!data.closed &&
				data.upstream === upstream &&
				upstream.readyState !== WebSocket.OPEN
			) {
				this.closeProxySocket(socket, 1013, "Upstream WebSocket timeout");
			}
		}, this.websocketConnectTimeoutMs);
		if (upstream.readyState === WebSocket.OPEN) {
			this.openUpstream(socket, upstream);
		}
	}

	private openUpstream(
		socket: Bun.ServerWebSocket<ProxySocketData>,
		upstream: FlowControlledWebSocket,
	): void {
		const data = socket.data;
		if (
			data.closed ||
			data.upstream !== upstream ||
			socket.readyState !== WebSocket.OPEN
		) {
			this.closeProxySocket(socket, 1000, "WebSocket closed");
			return;
		}
		this.clearConnectTimer(data);
		while (data.queued.length > 0 && !data.closed) {
			const message = data.queued.shift();
			if (message === undefined) break;
			data.queuedBytes -= socketMessageBytes(message);
			if (!this.sendToUpstream(socket, message)) return;
		}
		data.queuedBytes = 0;
	}

	private handleWebSocketMessage(
		socket: Bun.ServerWebSocket<ProxySocketData>,
		message: string | Buffer<ArrayBuffer>,
	): void {
		const data = socket.data;
		if (data.closed) return;
		const normalized = copySocketMessage(message);
		if (normalized === null) {
			this.closeProxySocket(socket, 1003, "Unsupported WebSocket message");
			return;
		}

		const upstream = data.upstream;
		if (!upstream || upstream.readyState === WebSocket.CONNECTING) {
			const bytes = socketMessageBytes(normalized);
			if (
				data.queued.length >= this.websocketQueueMessages ||
				data.queuedBytes + bytes > this.websocketQueueBytes
			) {
				this.closeProxySocket(socket, 1013, "WebSocket upstream busy");
				return;
			}
			data.queued.push(normalized);
			data.queuedBytes += bytes;
			return;
		}
		if (upstream.readyState !== WebSocket.OPEN) {
			this.closeProxySocket(socket, 1011, "Upstream WebSocket closed");
			return;
		}
		this.sendToUpstream(socket, normalized);
	}

	private sendToUpstream(
		socket: Bun.ServerWebSocket<ProxySocketData>,
		message: ProxyMessage,
	): boolean {
		const data = socket.data;
		const upstream = data.upstream;
		if (!upstream || upstream.readyState !== WebSocket.OPEN || data.closed) {
			return false;
		}
		const bytes = socketMessageBytes(message);
		if (
			bytes > this.websocketBufferedAmountLimit ||
			!Number.isFinite(upstream.bufferedAmount) ||
			upstream.bufferedAmount + bytes > this.websocketBufferedAmountLimit
		) {
			this.closeProxySocket(socket, 1013, "WebSocket upstream buffer full");
			return false;
		}

		try {
			upstream.send(message);
		} catch {
			this.closeProxySocket(socket, 1011, "Unable to send upstream");
			return false;
		}
		if (upstream.bufferedAmount > this.websocketBufferedAmountLimit) {
			this.closeProxySocket(socket, 1013, "WebSocket upstream buffer full");
			return false;
		}
		return true;
	}

	private forwardUpstreamMessage(
		socket: Bun.ServerWebSocket<ProxySocketData>,
		upstream: FlowControlledWebSocket,
		event: MessageEvent,
	): void {
		const data = socket.data;
		if (data.closed || data.upstream !== upstream) return;
		if (data.upstreamPaused) {
			this.closeProxySocket(socket, 1013, "WebSocket client backpressure");
			return;
		}
		const message = socketMessage(event.data);
		if (message === null) {
			this.closeProxySocket(socket, 1003, "Unsupported WebSocket message");
			return;
		}

		let status: number;
		try {
			status = socket.send(message);
		} catch {
			this.closeProxySocket(socket, 1011, "Unable to send to WebSocket client");
			return;
		}
		if (status === 0) {
			this.closeProxySocket(socket, 1011, "WebSocket client unavailable");
		} else if (status === -1) {
			data.upstreamPaused = true;
			try {
				upstream.pause?.();
			} catch {
				this.closeProxySocket(socket, 1011, "Unable to pause upstream");
			}
		}
	}

	private drainWebSocket(
		socket: Bun.ServerWebSocket<ProxySocketData>,
	): void {
		const data = socket.data;
		if (data.closed || !data.upstreamPaused) return;
		data.upstreamPaused = false;
		try {
			data.upstream?.resume?.();
		} catch {
			this.closeProxySocket(socket, 1011, "Unable to resume upstream");
		}
	}

	private upstreamClosed(
		socket: Bun.ServerWebSocket<ProxySocketData>,
		upstream: FlowControlledWebSocket,
		event: CloseEvent,
	): void {
		if (socket.data.upstream !== upstream) return;
		this.closeProxySocket(
			socket,
			clientCloseCode(event.code),
			 event.reason || "Upstream WebSocket closed",
		);
	}

	private closeWebSocket(
		socket: Bun.ServerWebSocket<ProxySocketData>,
		code: number,
		reason: string,
	): void {
		this.closeProxySocket(socket, clientCloseCode(code), reason, false);
	}

	private closeProxySocket(
		socket: Bun.ServerWebSocket<ProxySocketData>,
		code: number,
		reason: string,
		closeClient = true,
	): void {
		const data = socket.data;
		if (data.closed) return;
		data.closed = true;
		this.clearConnectTimer(data);
		const upstream = data.upstream;
		data.upstream = undefined;
		data.queued.length = 0;
		data.queuedBytes = 0;
		data.upstreamPaused = false;

		if (upstream) {
			const listeners = data.upstreamListeners;
			if (listeners) {
				upstream.removeEventListener("open", listeners.open);
				upstream.removeEventListener("message", listeners.message);
				upstream.removeEventListener("close", listeners.close);
				upstream.removeEventListener("error", listeners.error);
				data.upstreamListeners = undefined;
			}
			try {
				if (upstream.readyState === WebSocket.OPEN) {
					upstream.close(clientCloseCode(code), closeReason(reason));
				} else if (upstream.readyState === WebSocket.CONNECTING) {
					upstream.close(clientCloseCode(code), closeReason(reason));
					upstream.terminate?.();
				}
			} catch {
				try {
					upstream.terminate?.();
				} catch {
					// The upstream may already have completed its close race.
				}
			}
		}

		if (
			closeClient &&
			(socket.readyState === WebSocket.OPEN ||
				socket.readyState === WebSocket.CONNECTING)
		) {
			try {
				socket.close(clientCloseCode(code), closeReason(reason));
			} catch {
				try {
					socket.terminate();
				} catch {
					// The client may have closed concurrently.
				}
			}
		}
	}

	private clearConnectTimer(data: ProxySocketData): void {
		if (data.connectTimer === undefined) return;
		clearTimeout(data.connectTimer);
		data.connectTimer = undefined;
	}

	private async handleRequest(
		request: Request,
		server: Bun.Server<ProxySocketData>,
	): Promise<Response | undefined> {
		const route = this.route(request);
		if (!route) {
			const links = [...this.routes.keys()]
				.map((name) => {
					const safeName = escapeHtml(name);
					const safeHref = escapeHtml(localUrl(name));
					return `<li><a href="${safeHref}">${safeName}</a></li>`;
				})
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
						queuedBytes: 0,
						upstreamPaused: false,
						closed: false,
					},
					headers,
				})
			) {
				return undefined;
			}
			return new Response("WebSocket upgrade failed", { status: 400 });
		}

		if (isEventStream(request)) server.timeout(request, 0);
		const headers = forwardHeaders(request.headers);
		headers.set("host", `127.0.0.1:${route.port}`);
		headers.set("x-forwarded-host", route.url.host);
		headers.set("x-forwarded-proto", "http");
		headers.delete("accept-encoding");

		const controller = new AbortController();
		const unlinkClientAbort = linkAbortSignal(request.signal, controller);
		let navigationTimer: ReturnType<typeof setTimeout> | undefined;
		let responseBodyOwnsCleanup = false;
		const clearNavigationTimer = (): void => {
			if (navigationTimer === undefined) return;
			clearTimeout(navigationTimer);
			navigationTimer = undefined;
		};
		const cleanup = (): void => {
			clearNavigationTimer();
			unlinkClientAbort();
		};
		const cancelUpstream = (): void => {
			if (!controller.signal.aborted) controller.abort();
			cleanup();
		};

		try {
			const upstream = fetch(target, {
				method: request.method,
				headers,
				body:
					request.method === "GET" || request.method === "HEAD"
						? undefined
						: request.body,
				redirect: "manual",
				signal: controller.signal,
			});
			const navigation = isHtmlNavigation(request);

			if (!navigation) {
				const response = await upstream;
				if (isEventStream(request, response)) server.timeout(request, 0);
				clearNavigationTimer();
				const forwarded = forward(response, cleanup, cancelUpstream);
				responseBodyOwnsCleanup = true;
				return forwarded;
			}

			const timeoutMarker = Symbol("navigation timeout");
			const settled = upstream.then(
				(response) => ({ kind: "response" as const, response }),
				(error) => ({ kind: "error" as const, error }),
			);
			const firstBoot = !this.navigationSucceeded.has(route.name);
			const timeout = new Promise<typeof timeoutMarker>((resolve) => {
				navigationTimer = setTimeout(() => {
					// First boot compiles can outlive the wait page. Aborting them
					// restarts the compile on every refresh and never becomes ready.
					if (!firstBoot && !controller.signal.aborted) controller.abort();
					resolve(timeoutMarker);
				}, this.navigationTimeoutMs);
			});
			const winner = await Promise.race([settled, timeout]);
			const waitPhase = firstBoot ? "starting" : "restarting";
			if (winner === timeoutMarker) {
				this.recordNavigationResult(route.name, false, true);
				return upstreamUnavailableResponse(request, waitPhase);
			}
			if (winner.kind === "response") {
				this.recordNavigationResult(route.name, true);
				clearNavigationTimer();
				const forwarded = forward(winner.response, cleanup, cancelUpstream);
				responseBodyOwnsCleanup = true;
				return forwarded;
			}

			this.recordNavigationResult(route.name, false, false);
			return upstreamUnavailableResponse(request, waitPhase);
		} catch {
			this.recordNavigationResult(
				route.name,
				false,
				false,
			);
			return upstreamUnavailableResponse(
				request,
				this.navigationSucceeded.has(route.name) ? "restarting" : "starting",
			);
		} finally {
			if (!responseBodyOwnsCleanup) cleanup();
		}
	}
}
