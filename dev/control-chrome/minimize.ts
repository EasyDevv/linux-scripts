import { getBrowserWsUrl } from "./cdp.ts";

export type MinimizeOptions = {
	timeoutMs?: number;
	silent?: boolean;
};

type WSResponse = {
	id: number;
	result?: unknown;
	error?: { message: string };
};

async function callBrowserCommand(
	wsUrl: string,
	commands: Array<{
		id: number;
		method: string;
		params?: Record<string, unknown>;
	}>,
): Promise<unknown> {
	return await new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl);
		const timeout = setTimeout(() => {
			ws.close();
			reject(new Error("CDP timeout"));
		}, 5000);
		let index = 0;
		let lastResponse: unknown = null;

		ws.onopen = () => {
			ws.send(JSON.stringify(commands[index]));
		};

		ws.onmessage = (evt: MessageEvent) => {
			const msg = JSON.parse(evt.data as string) as WSResponse;
			if (msg.id == null) return;
			if (msg.error) {
				clearTimeout(timeout);
				ws.close();
				reject(new Error(msg.error.message));
				return;
			}

			lastResponse = msg.result ?? null;
			index += 1;
			if (index >= commands.length) {
				clearTimeout(timeout);
				ws.close();
				resolve(lastResponse);
				return;
			}

			ws.send(JSON.stringify(commands[index]));
		};

		ws.onerror = () => {
			clearTimeout(timeout);
			reject(new Error("WebSocket connection failed"));
		};
	});
}

async function getPageTargetId(wsUrl: string): Promise<string | null> {
	const result = (await callBrowserCommand(wsUrl, [
		{ id: 1, method: "Target.getTargets" },
	])) as {
		targetInfos?: Array<{ targetId: string; type: string; url: string }>;
	};

	const targetInfos = result?.targetInfos ?? [];
	const preferredTarget = targetInfos.find(
		(target) =>
			target?.type === "page" &&
			typeof target.url === "string" &&
			!target.url.startsWith("chrome-extension://"),
	);
	const fallbackTarget = targetInfos.find((target) => target?.type === "page");
	return preferredTarget?.targetId ?? fallbackTarget?.targetId ?? null;
}

async function getWindowForTarget(
	wsUrl: string,
	targetId: string | null,
): Promise<{ windowId: number }> {
	return (await callBrowserCommand(wsUrl, [
		{
			id: 1,
			method: "Browser.getWindowForTarget",
			params: targetId ? { targetId } : {},
		},
	])) as { windowId: number };
}

async function setWindowBounds(
	wsUrl: string,
	windowId: number,
	bounds: { windowState: string },
): Promise<unknown> {
	return await callBrowserCommand(wsUrl, [
		{
			id: 1,
			method: "Browser.setWindowBounds",
			params: { windowId, bounds },
		},
	]);
}

async function getWindowBounds(
	wsUrl: string,
	windowId: number,
): Promise<{ bounds?: { windowState?: string } }> {
	return (await callBrowserCommand(wsUrl, [
		{
			id: 1,
			method: "Browser.getWindowBounds",
			params: { windowId },
		},
	])) as { bounds?: { windowState?: string } };
}

async function waitForWindowState(
	wsUrl: string,
	windowId: number,
	deadline: number,
	expectedState: string,
): Promise<boolean> {
	while (Date.now() < deadline) {
		const { bounds } = await getWindowBounds(wsUrl, windowId);
		if (bounds?.windowState === expectedState) return true;
		await Bun.sleep(300);
	}
	return false;
}

async function cdpMinimizeUntilStable(
	wsUrl: string,
	deadline: number,
): Promise<boolean> {
	while (Date.now() < deadline) {
		try {
			const targetId = await getPageTargetId(wsUrl);
			if (!targetId) {
				await Bun.sleep(300);
				continue;
			}

			const { windowId } = await getWindowForTarget(wsUrl, targetId);
			const { bounds } = await getWindowBounds(wsUrl, windowId);
			if (bounds?.windowState === "minimized") {
				return true;
			}

			await setWindowBounds(wsUrl, windowId, { windowState: "minimized" });
			return await waitForWindowState(wsUrl, windowId, deadline, "minimized");
		} catch {
			// Retry
		}

		await Bun.sleep(300);
	}

	return false;
}

export async function minimizeWindow(
	port: number,
	opts: MinimizeOptions = {},
): Promise<boolean> {
	const { timeoutMs = 15_000, silent = false } = opts;
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		try {
			const wsUrl = await getBrowserWsUrl(port);
			if (wsUrl) {
				const minimized = await cdpMinimizeUntilStable(wsUrl, deadline);
				if (minimized) {
					if (!silent) {
						console.log(`Window minimized (port ${port})`);
					}
					return true;
				}
			}
		} catch (error) {
			if (!silent) {
				console.warn(
					`[minimize] Error: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		await Bun.sleep(300);
	}

	if (!silent) {
		console.warn(`Timed out waiting to minimize window on port ${port}`);
	}
	return false;
}

export type MinimizeCliOptions = {
	port: number;
	timeoutMs?: number;
	silent: boolean;
};

export function parseMinimizeArgs(argv: string[]): MinimizeCliOptions {
	const options: MinimizeCliOptions = {
		port: 0,
		silent: false,
	};

	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--port":
				options.port = +(argv[++i] ?? 0);
				break;
			case "--timeout-ms":
				options.timeoutMs = +(argv[++i] ?? 0);
				break;
			case "--silent":
				options.silent = true;
				break;
			default:
				if (!options.port && /^\d+$/.test(argv[i])) {
					options.port = Number.parseInt(argv[i], 10);
				}
				break;
		}
	}

	return options;
}

export async function main(argv: string[]): Promise<void> {
	const options = parseMinimizeArgs(argv);
	if (!options.port) {
		console.error("Usage: control-chrome minimize --port <port>");
		process.exit(1);
	}

	const ok = await minimizeWindow(options.port, {
		timeoutMs: options.timeoutMs,
		silent: options.silent,
	});
	process.exit(ok ? 0 : 1);
}
