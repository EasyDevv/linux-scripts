import { expect, test } from "bun:test";
import { LocalProxy, localUrl } from "./local-proxy";
import type { NormalizedConfig } from "./types";

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
	proxy.update(configFor(upstream.port));

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
