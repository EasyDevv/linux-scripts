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
