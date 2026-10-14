import { expect, test } from "bun:test";

import { CDP } from "./cdp.ts";
import { closePageAllowingDialogs } from "./dialogs.ts";

test("closePageAllowingDialogs accepts a beforeunload dialog then closes", async () => {
	const messages: Array<Record<string, unknown>> = [];
	const server = Bun.serve({
		port: 0,
		fetch(request, instance) {
			if (instance.upgrade(request)) return;
			return new Response("WebSocket upgrade required", { status: 426 });
		},
		websocket: {
			open() {},
			message(ws, message) {
				const payload = JSON.parse(String(message)) as {
					id?: number;
					method?: string;
				};
				messages.push(payload);
				if (payload.method === "Page.enable") {
					ws.send(JSON.stringify({ id: payload.id, result: {} }));
					ws.send(
						JSON.stringify({
							method: "Page.javascriptDialogOpening",
							params: {
								url: "http://127.0.0.1:8002/",
								message: "정말로 닫으시겠습니까?",
								type: "beforeunload",
								hasBrowserHandler: true,
							},
						}),
					);
					return;
				}
				if (payload.id !== undefined) {
					ws.send(JSON.stringify({ id: payload.id, result: {} }));
				}
			},
		},
	});

	const cdp = await CDP.connect(`ws://127.0.0.1:${server.port}`, 1000);
	try {
		await closePageAllowingDialogs(cdp);
		expect(
			messages.some(
				(message) =>
					message.method === "Page.handleJavaScriptDialog" &&
					(message as { params?: { accept?: boolean } }).params?.accept ===
						true,
			),
		).toBe(true);
		expect(messages.some((message) => message.method === "Page.close")).toBe(
			true,
		);
	} finally {
		cdp.close();
		server.stop(true);
	}
});
