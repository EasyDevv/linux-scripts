import { expect, test } from "bun:test";

import { CDP } from "./cdp.ts";

test("CDP commands time out when Chrome does not respond", async () => {
	const server = Bun.serve({
		port: 0,
		fetch(request, instance) {
			if (instance.upgrade(request)) return;
			return new Response("WebSocket upgrade required", { status: 426 });
		},
		websocket: {
			message() {},
		},
	});
	const cdp = await CDP.connect(`ws://127.0.0.1:${server.port}`, 100);

	try {
		await expect(
			cdp.send("Page.captureScreenshot", undefined, 20),
		).rejects.toThrow("CDP command timed out: Page.captureScreenshot");
	} finally {
		cdp.close();
		server.stop(true);
	}
});

test("getWsUrl ignores extension background pages", async () => {
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			if (new URL(request.url).pathname === "/json/list") {
				return Response.json([
					{
						id: "bg",
						type: "background_page",
						title: "Extension",
						url: "chrome-extension://ext/background.html",
						webSocketDebuggerUrl: "ws://127.0.0.1:1/bg",
					},
					{
						id: "page",
						type: "page",
						title: "Example",
						url: "https://example.com/",
						webSocketDebuggerUrl: "ws://127.0.0.1:1/page",
					},
				]);
			}
			return new Response("not found", { status: 404 });
		},
	});
	try {
		const { getWsUrl } = await import("./cdp.ts");
		expect(await getWsUrl(server.port, 0)).toBe("ws://127.0.0.1:1/page");
	} finally {
		server.stop(true);
	}
});
