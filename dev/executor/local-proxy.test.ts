import { expect, test } from "bun:test";
import { LocalProxy, localUrl, upstreamUnavailableResponse } from "./local-proxy";
import type { NormalizedConfig } from "./types";

function serverPort(server: { readonly port?: number }): number {
	if (server.port === undefined) throw new Error("Test server is not listening");
	return server.port;
}

function configFor(port: number, name = "sample"): NormalizedConfig {
	return {
		instances: new Map([
			[
				name,
				{
					name,
					dir: "/tmp",
					cmd: `server --port ${port}`,
					enabled: true,
					env: {},
				},
			],
		]),
		disabled: new Set(),
		restartTokens: new Map(),
		getInstance: () => {
			throw new Error("unused");
		},
		hasInstance: () => true,
		isEnabled: () => true,
		getPort: () => String(port),
		instanceMatchingCwd: () => null,
	};
}

async function waitFor(
	condition: () => boolean,
	timeoutMs = 500,
): Promise<void> {
	const deadline = performance.now() + timeoutMs;
	while (performance.now() < deadline) {
		if (condition()) return;
		await Bun.sleep(5);
	}
	if (!condition()) throw new Error("Timed out waiting for proxy state");
}

function waitForClose(socket: WebSocket): Promise<CloseEvent> {
	return new Promise((resolve) => {
		socket.addEventListener("close", resolve, { once: true });
	});
}

test("localUrl uses the executor instance name", () => {
	expect(localUrl("postdock")).toBe("http://postdock.localhost");
});

test("unavailable HTML responses retry without being cached", async () => {
	const response = upstreamUnavailableResponse(
		new Request("http://sample.localhost/property", {
			headers: { accept: "text/html" },
		}),
	);

	expect(response.status).toBe(502);
	expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
	expect(response.headers.get("retry-after")).toBe("1");
	expect(await response.text()).toContain('http-equiv="refresh"');
});

test("proxy bounds a stalled HTML navigation without restarting first boot", async () => {
	const upstream = Bun.serve({
		port: 0,
		fetch() {
			return new Promise<Response>(() => {});
		},
	});
	const timedOutInstances: string[] = [];
	const proxy = new LocalProxy(0, 25, (name) => timedOutInstances.push(name), 10_000);
	proxy.update(configFor(serverPort(upstream)));

	try {
		const startedAt = performance.now();
		const response = await fetch(
			`http://sample.localhost:${proxy.port}/stalled`,
			{ headers: { accept: "text/html" } },
		);
		expect(response.status).toBe(502);
		expect(performance.now() - startedAt).toBeLessThan(500);
		expect(timedOutInstances).toEqual([]);
		const body = await response.text();
		expect(body).toContain("Development server starting");
		expect(body).toContain('http-equiv="refresh"');
	} finally {
		await proxy.stop();
		upstream.stop(true);
	}
});

test("first-boot wait page does not abort the in-flight compile", async () => {
	let upstreamAborted = false;
	const upstream = Bun.serve({
		port: 0,
		fetch(request) {
			request.signal.addEventListener(
				"abort",
				() => {
					upstreamAborted = true;
				},
				{ once: true },
			);
			return new Promise<Response>(() => {});
		},
	});
	const proxy = new LocalProxy(0, 25, undefined, 10_000);
	proxy.update(configFor(serverPort(upstream)));

	try {
		const response = await fetch(
			`http://sample.localhost:${proxy.port}/stalled`,
			{ headers: { accept: "text/html" } },
		);
		expect(response.status).toBe(502);
		await Bun.sleep(40);
		expect(upstreamAborted).toBe(false);
	} finally {
		await proxy.stop();
		upstream.stop(true);
	}
});

test("proxy restarts a stalled navigation after the start budget", async () => {
	const upstream = Bun.serve({
		port: 0,
		fetch() {
			return new Promise<Response>(() => {});
		},
	});
	const timedOutInstances: string[] = [];
	const proxy = new LocalProxy(0, 20, (name) => timedOutInstances.push(name), 45);
	proxy.update(configFor(serverPort(upstream)));

	try {
		const navigate = () =>
			fetch(`http://sample.localhost:${proxy.port}/stalled`, {
				headers: { accept: "text/html" },
			});
		await navigate();
		expect(timedOutInstances).toEqual([]);
		await Bun.sleep(30);
		await navigate();
		expect(timedOutInstances).toEqual(["sample"]);
	} finally {
		await proxy.stop();
		upstream.stop(true);
	}
});

test("proxy restarts after a previously healthy instance stalls", async () => {
	let stall = false;
	const upstream = Bun.serve({
		port: 0,
		fetch() {
			if (stall) return new Promise<Response>(() => {});
			return new Response("ok");
		},
	});
	const timedOutInstances: string[] = [];
	const proxy = new LocalProxy(0, 25, (name) => timedOutInstances.push(name), 10_000);
	proxy.update(configFor(serverPort(upstream)));

	try {
		const url = `http://sample.localhost:${proxy.port}/page`;
		const headers = { accept: "text/html" };
		expect(await (await fetch(url, { headers })).text()).toBe("ok");
		stall = true;
		await fetch(url, { headers });
		expect(timedOutInstances).toEqual([]);
		await Bun.sleep(30);
		await fetch(url, { headers });
		expect(timedOutInstances).toEqual(["sample"]);
	} finally {
		await proxy.stop();
		upstream.stop(true);
	}
});

test("slow first HTML keeps running and does not restart", async () => {
	let served = 0;
	let delayMs = 60;
	const upstream = Bun.serve({
		port: 0,
		async fetch() {
			served += 1;
			await Bun.sleep(delayMs);
			delayMs = 0;
			return new Response(`ok-${served}`);
		},
	});
	const timedOutInstances: string[] = [];
	const proxy = new LocalProxy(0, 20, (name) => timedOutInstances.push(name), 10_000);
	proxy.update(configFor(serverPort(upstream)));

	try {
		const url = `http://sample.localhost:${proxy.port}/slow`;
		const headers = { accept: "text/html" };
		const first = await fetch(url, { headers });
		expect(first.status).toBe(502);
		expect(timedOutInstances).toEqual([]);
		await Bun.sleep(80);
		const second = await fetch(url, { headers });
		expect(second.status).toBe(200);
		expect(await second.text()).toStartWith("ok-");
		expect(timedOutInstances).toEqual([]);
		expect(served).toBeGreaterThanOrEqual(1);
	} finally {
		await proxy.stop();
		upstream.stop(true);
	}
});

test("proxy restarts after sustained refused HTML navigations", async () => {
	const upstream = Bun.serve({ port: 0, fetch: () => new Response("ok") });
	const port = serverPort(upstream);
	upstream.stop(true);
	const failedInstances: string[] = [];
	const proxy = new LocalProxy(0, 25, (name) => failedInstances.push(name));
	proxy.update(configFor(port));

	try {
		const navigate = () =>
			fetch(`http://sample.localhost:${proxy.port}/stalled`, {
				headers: { accept: "text/html" },
			});
		await navigate();
		expect(failedInstances).toEqual([]);
		await Bun.sleep(30);
		await navigate();
		expect(failedInstances).toEqual(["sample"]);
	} finally {
		await proxy.stop();
	}
});

test("proxy forwards HTTP and WebSocket traffic", async () => {
	const upstream = Bun.serve({
		port: 0,
		fetch(request, server) {
			if (
				request.headers.get("upgrade") === "websocket" &&
				server.upgrade(request)
			)
				return;
			if (new URL(request.url).pathname === "/compressed") {
				return new Response(Bun.gzipSync("compressed"), {
					headers: { "content-encoding": "gzip" },
				});
			}
			return new Response(new URL(request.url).pathname);
		},
		websocket: {
			message(socket, message) {
				socket.send(message);
			},
		},
	});
	const proxy = new LocalProxy(0);
	proxy.update(configFor(serverPort(upstream)));

	try {
		const response = await fetch(
			`http://sample.localhost:${proxy.port}/health`,
		);
		expect(await response.text()).toBe("/health");
		const compressed = await fetch(
			`http://sample.localhost:${proxy.port}/compressed`,
		);
		expect(await compressed.text()).toBe("compressed");

		const echoed = await new Promise<string>((resolve, reject) => {
			const socket = new WebSocket(`ws://sample.localhost:${proxy.port}/hmr`);
			socket.addEventListener("open", () => socket.send("ready"));
			socket.addEventListener("message", (event) => {
				resolve(String(event.data));
				socket.close();
			});
			socket.addEventListener("error", () =>
				reject(new Error("WebSocket proxy failed")),
			);
		});
		expect(echoed).toBe("ready");
	} finally {
		await proxy.stop();
		upstream.stop(true);
	}
});

test("navigation timeout aborts upstream and releases pending work", async () => {
	let stall = false;
	let upstreamAborted = false;
	const upstream = Bun.serve({
		port: 0,
		fetch(request) {
			if (!stall) return new Response("ok");
			request.signal.addEventListener(
				"abort",
				() => {
					upstreamAborted = true;
				},
				{ once: true },
			);
			return new Promise<Response>(() => {});
		},
	});
	const proxy = new LocalProxy(0, 25, undefined, 10_000, {
		stopGracePeriodMs: 50,
	});
	proxy.update(configFor(serverPort(upstream)));

	try {
		const headers = { accept: "text/html" };
		const url = `http://sample.localhost:${proxy.port}/stalled`;
		expect(await (await fetch(url, { headers })).text()).toBe("ok");
		stall = true;
		const request = fetch(url, { headers });
		await waitFor(() => proxy.snapshot.pendingRequests > 0);
		expect(proxy.snapshot.pendingRequests).toBeGreaterThan(0);
		expect((await request).status).toBe(502);
		await waitFor(() => upstreamAborted);
		await waitFor(() => proxy.snapshot.pendingRequests === 0);
	} finally {
		await proxy.stop();
		upstream.stop(true);
	}
});

test("client disconnect aborts a non-navigation upstream fetch", async () => {
	let upstreamAborted = false;
	const upstream = Bun.serve({
		port: 0,
		fetch(request) {
			request.signal.addEventListener(
				"abort",
				() => {
					upstreamAborted = true;
				},
				{ once: true },
			);
			return new Promise<Response>(() => {});
		},
	});
	const proxy = new LocalProxy(0, 5_000, undefined, 10_000, {
		stopGracePeriodMs: 50,
	});
	proxy.update(configFor(serverPort(upstream)));
	const controller = new AbortController();
	const request = fetch(`http://sample.localhost:${proxy.port}/pending`, {
		signal: controller.signal,
	});

	try {
		await waitFor(() => proxy.snapshot.pendingRequests > 0);
		controller.abort();
		await request.catch(() => undefined);
		await waitFor(() => upstreamAborted);
		await waitFor(() => proxy.snapshot.pendingRequests === 0);
	} finally {
		await proxy.stop();
		upstream.stop(true);
	}
});

test("client disconnect cancels a streamed upstream body", async () => {
	let upstreamAborted = false;
	const upstream = Bun.serve({
		port: 0,
		fetch(request) {
			request.signal.addEventListener(
				"abort",
				() => {
					upstreamAborted = true;
				},
				{ once: true },
			);
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new Uint8Array([1]));
					},
				}),
				{ headers: { "content-type": "text/plain" } },
			);
		},
	});
	const proxy = new LocalProxy(0, 5_000, undefined, 10_000, {
		stopGracePeriodMs: 50,
	});
	proxy.update(configFor(serverPort(upstream)));
	const controller = new AbortController();

	try {
		const response = await fetch(`http://sample.localhost:${proxy.port}/stream`, {
			signal: controller.signal,
		});
		const reader = response.body!.getReader();
		expect((await reader.read()).value).toEqual(new Uint8Array([1]));
		controller.abort();
		await reader.cancel().catch(() => undefined);
		await waitFor(() => upstreamAborted);
		await waitFor(() => proxy.snapshot.pendingRequests === 0);
	} finally {
		await proxy.stop();
		upstream.stop(true);
	}
});

test("proxy streams responses and removes hop-by-hop headers", async () => {
	let receivedHeaders = new Headers();
	const upstream = Bun.serve({
		port: 0,
		fetch(request) {
			receivedHeaders = new Headers(request.headers);
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("first-"));
						setTimeout(() => {
							controller.enqueue(new TextEncoder().encode("second"));
							controller.close();
						}, 25);
					},
				}),
				{
					headers: {
						connection: "keep-alive, x-response-hop",
						"x-response-hop": "remove",
						"keep-alive": "timeout=5",
						te: "trailers",
						"x-response-visible": "keep",
						location: "/next",
						"set-cookie": "session=ok; Path=/",
					},
				},
			);
		},
	});
	const proxy = new LocalProxy(0, 20);
	proxy.update(configFor(serverPort(upstream)));

	try {
		const response = await fetch(
			`http://sample.localhost:${proxy.port}/stream`,
			{
				headers: {
					accept: "text/html",
					connection: "keep-alive, x-request-hop",
					"x-request-hop": "remove",
					"keep-alive": "timeout=5",
					te: "trailers",
					upgrade: "h2c",
					"x-request-visible": "keep",
				},
			},
		);
		await Bun.sleep(35);
		const reader = response.body!.getReader();
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toBe("first-");
		const second = await reader.read();
		expect(new TextDecoder().decode(second.value)).toBe("second");
		expect((await reader.read()).done).toBe(true);
		const forwardedHeaders = receivedHeaders;
		expect(forwardedHeaders.get("x-request-hop")).toBeNull();
		expect(forwardedHeaders.get("keep-alive")).toBeNull();
		expect(forwardedHeaders.get("te")).toBeNull();
		expect(forwardedHeaders.get("x-request-visible")).toBe("keep");
		expect(forwardedHeaders.get("host")).toBe(`127.0.0.1:${serverPort(upstream)}`);
		expect(forwardedHeaders.get("x-forwarded-host")).toBe(
			`sample.localhost:${proxy.port}`,
		);
		expect(response.headers.get("x-response-hop")).toBeNull();
		expect(response.headers.get("keep-alive")).toBeNull();
		expect(response.headers.get("te")).toBeNull();
		expect(response.headers.get("x-response-visible")).toBe("keep");
		expect(response.headers.get("location")).toBe("/next");
		expect(response.headers.get("set-cookie")).toBe("session=ok; Path=/");
		await waitFor(() => proxy.snapshot.pendingRequests === 0);
	} finally {
		await proxy.stop();
		upstream.stop(true);
	}
});

test("proxy escapes instance names in the root index", async () => {
	const name = `bad\"><script>alert(1)</script>&'`;
	const proxy = new LocalProxy(0);
	proxy.update(configFor(31_337, name));

	try {
		const html = await (await fetch(`http://127.0.0.1:${proxy.port}/`)).text();
		expect(html).toContain("&lt;script&gt;");
		expect(html).toContain("&quot;");
		expect(html).toContain("&#39;");
		expect(html).toContain("&amp;");
		expect(html).not.toContain("<script>");
	} finally {
		await proxy.stop();
	}
});

test("proxy gracefully stops before forcing a stalled request", async () => {
	const upstream = Bun.serve({
		port: 0,
		fetch() {
			return new Promise<Response>(() => {});
		},
	});
	const proxy = new LocalProxy(0, 5_000, undefined, 10_000, {
		stopGracePeriodMs: 25,
	});
	proxy.update(configFor(serverPort(upstream)));
	const request = fetch(`http://sample.localhost:${proxy.port}/pending`).catch(
		() => undefined,
	);

	try {
		await waitFor(() => proxy.snapshot.pendingRequests > 0);
		const startedAt = performance.now();
		await proxy.stop();
		expect(performance.now() - startedAt).toBeLessThan(500);
		await request;
		await waitFor(() => proxy.snapshot.pendingRequests === 0);
	} finally {
		await proxy.stop();
		upstream.stop(true);
	}
});

test("websocket pre-open queue is bounded", async () => {
	const upstream = Bun.serve({
		port: 0,
		fetch() {
			return new Promise<Response>(() => {});
		},
	});
	const proxy = new LocalProxy(0, 5_000, undefined, 10_000, {
		websocketQueueBytes: 4,
		websocketQueueMessages: 2,
		websocketConnectTimeoutMs: 250,
	});
	proxy.update(configFor(serverPort(upstream)));
	const socket = new WebSocket(
		`ws://sample.localhost:${proxy.port}/hmr`,
	);
	const closed = waitForClose(socket);
	const opened = new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener(
			"error",
			() => reject(new Error("WebSocket proxy failed before open")),
			{ once: true },
		);
	});

	try {
		await opened;
		await waitFor(() => proxy.snapshot.pendingWebSockets === 1);
		socket.send("aa");
		socket.send("bb");
		try {
			socket.send("c");
		} catch {
			// The proxy may close before the client-side send returns.
		}
		const event = await closed;
		expect(event.code).toBe(1013);
		await waitFor(() => proxy.snapshot.pendingWebSockets === 0);
	} finally {
		if (socket.readyState === WebSocket.OPEN) socket.close();
		await proxy.stop();
		upstream.stop(true);
	}
});

test("websocket upstream connect timeout cleans up both sockets", async () => {
	const upstream = Bun.serve({
		port: 0,
		fetch() {
			return new Promise<Response>(() => {});
		},
	});
	const proxy = new LocalProxy(0, 5_000, undefined, 10_000, {
		websocketConnectTimeoutMs: 25,
	});
	proxy.update(configFor(serverPort(upstream)));
	const socket = new WebSocket(
		`ws://sample.localhost:${proxy.port}/hmr`,
	);
	const closed = waitForClose(socket);
	const opened = new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener(
			"error",
			() => reject(new Error("WebSocket proxy failed before open")),
			{ once: true },
		);
	});

	try {
		await opened;
		await waitFor(() => proxy.snapshot.pendingWebSockets === 1);
		const event = await closed;
		expect(event.code).toBe(1013);
		await waitFor(() => proxy.snapshot.pendingWebSockets === 0);
	} finally {
		if (socket.readyState === WebSocket.OPEN) socket.close();
		await proxy.stop();
		upstream.stop(true);
	}
});
