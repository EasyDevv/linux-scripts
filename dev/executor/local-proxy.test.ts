import { expect, test } from "bun:test";
import { LocalProxy, localUrl, upstreamUnavailableResponse } from "./local-proxy";
import type { NormalizedConfig } from "./types";

function serverPort(server: { readonly port?: number }): number {
	if (server.port === undefined) throw new Error("Test server is not listening");
	return server.port;
}

function configFor(port: number): NormalizedConfig {
	return {
		instances: new Map([
			[
				"sample",
				{
					name: "sample",
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
		expect(await response.text()).toContain('http-equiv="refresh"');
	} finally {
		proxy.stop();
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
		proxy.stop();
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
		proxy.stop();
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
		proxy.stop();
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
		proxy.stop();
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
		proxy.stop();
		upstream.stop(true);
	}
});
