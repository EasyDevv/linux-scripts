import { closePageAllowingDialogs, preparePageLeave } from "./dialogs.ts";

export type Tab = {
	id: string;
	type: string;
	title: string;
	url: string;
	webSocketDebuggerUrl: string;
};

export type BrowserConsoleIssue = {
	level: string;
	source: string;
	text: string;
};

export class CDP {
	private ws: WebSocket;
	private pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	private events = new Map<string, Array<(...args: unknown[]) => void>>();
	private idCounter = 0;

	private constructor(ws: WebSocket) {
		this.ws = ws;

		this.ws.onmessage = (event: MessageEvent) => {
			const msg = JSON.parse(event.data as string) as {
				id?: number;
				method?: string;
				params?: unknown;
				result?: unknown;
				error?: { message: string };
			};

			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const request = this.pending.get(msg.id)!;
				this.pending.delete(msg.id);
				clearTimeout(request.timer);
				if (msg.error) {
					request.reject(new Error(msg.error.message));
				} else {
					request.resolve(msg.result);
				}
				return;
			}

			if (msg.method) {
				const handlers = this.events.get(msg.method);
				if (handlers) {
					for (const fn of handlers) {
						fn(msg.params);
					}
				}
			}
		};
		this.ws.onclose = () => this.rejectPending("CDP connection closed");
		this.ws.onerror = () => this.rejectPending("CDP connection failed");
	}

	private rejectPending(message: string): void {
		for (const [id, request] of this.pending) {
			clearTimeout(request.timer);
			request.reject(new Error(message));
			this.pending.delete(id);
		}
	}

	static async connect(wsUrl: string, timeoutMs = 20_000): Promise<CDP> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(wsUrl);
			const timer = setTimeout(() => {
				ws.close();
				reject(new Error(`Timed out connecting to ${wsUrl}`));
			}, timeoutMs);
			ws.onopen = () => {
				clearTimeout(timer);
				resolve(new CDP(ws));
			};
			ws.onerror = () => {
				clearTimeout(timer);
				reject(new Error(`Failed to connect to ${wsUrl}`));
			};
		});
	}

	async send<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		timeoutMs = 20_000,
	): Promise<T> {
		const id = ++this.idCounter;
		return await new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP command timed out: ${method}`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
				timer,
			});
			try {
				this.ws.send(JSON.stringify({ id, method, params }));
			} catch (error) {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	on(event: string, fn: (...args: unknown[]) => void) {
		(
			this.events.get(event) ??
			(this.events.set(event, []), this.events.get(event)!)
		).push(fn);
	}

	close() {
		this.rejectPending("CDP connection closed");
		this.ws.close();
	}
}

export function die(msg: string): never {
	console.error(`✗ ${msg}`);
	process.exit(1);
}

export async function getBrowserWsUrl(port: number): Promise<string | null> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/json/version`);
		const version = (await response.json()) as {
			webSocketDebuggerUrl?: string;
		};
		return version?.webSocketDebuggerUrl ?? null;
	} catch {
		return null;
	}
}

export async function listTabs(port: number): Promise<Tab[]> {
	try {
		return (await (
			await fetch(`http://127.0.0.1:${port}/json/list`)
		).json()) as Tab[];
	} catch {
		die(
			`Cannot connect to Chrome on port ${port}. Launch with: control-chrome open --port ${port}`,
		);
	}
}

export async function waitForChrome(port: number, timeout = 10000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
				signal: AbortSignal.timeout(750),
			});
			if (response.ok) return;
		} catch {}
		await Bun.sleep(100);
	}
	die(`Timed out waiting for Chrome on port ${port}`);
}

export async function waitForLoad(cdp: CDP, timeout = 10000) {
	await cdp.send("Page.enable");
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => resolve(), timeout);
		cdp.on("Page.loadEventFired", () => {
			clearTimeout(timer);
			resolve();
		});
	});
}


function canAttachDebugger(url?: string) {
	if (!url) return false;
	try {
		const parsed = new URL(url);
		return (
			parsed.hostname === "127.0.0.1" ||
			parsed.hostname === "localhost" ||
			parsed.hostname === "[::1]" ||
			parsed.hostname === "::1"
		);
	} catch {
		return false;
	}
}

export async function closeTabAllowingDialogs(port: number, tab: Tab) {
	if (canAttachDebugger(tab.webSocketDebuggerUrl)) {
		try {
			const session = await CDP.connect(tab.webSocketDebuggerUrl, 400);
			try {
				if (await closePageAllowingDialogs(session)) return;
			} finally {
				session.close();
			}
		} catch {
			// Fall through to the HTTP close endpoint.
		}
	}
	await closeTabById(port, tab.id);
}

export async function acceptPageDialogs(port: number) {
	let tabs: Tab[] = [];
	try {
		tabs = (await (
			await fetch(`http://127.0.0.1:${port}/json/list`)
		).json()) as Tab[];
	} catch {
		return;
	}

	for (const tab of tabs) {
		if (tab.type && tab.type !== "page") continue;
		if (!tab.webSocketDebuggerUrl) continue;
		try {
			const session = await CDP.connect(tab.webSocketDebuggerUrl, 400);
			try {
				await preparePageLeave(session);
			} finally {
				session.close();
			}
		} catch {}
	}
}

export async function closeTabById(port: number, tabId: string) {
	try {
		await fetch(`http://127.0.0.1:${port}/json/close/${tabId}`);
	} catch {}
}

export async function activateTabById(port: number, tabId: string) {
	await fetch(`http://127.0.0.1:${port}/json/activate/${tabId}`);
}

export async function createTab(
	port: number,
	url: string,
): Promise<Tab | null> {
	try {
		const encodedUrl = encodeURIComponent(url);
		const response = await fetch(
			`http://127.0.0.1:${port}/json/new?${encodedUrl}`,
			{ method: "PUT" },
		);
		if (!response.ok) return null;
		return (await response.json()) as Tab;
	} catch {
		return null;
	}
}

export async function getWsUrl(port: number, tabIndex = 0): Promise<string> {
	const tabs = await listTabs(port);
	const tab = tabs[tabIndex];
	if (!tab?.webSocketDebuggerUrl) {
		die(
			`No page tab found on port ${port}. Open a tab first or check the port.`,
		);
	}
	return tab.webSocketDebuggerUrl;
}

export async function getPageTab(port: number, tabIndex = 0): Promise<Tab> {
	const tabs = await listTabs(port);
	const pages = tabs.filter((t) => t.type === "page");
	const tab = pages[tabIndex] ?? tabs[tabIndex];
	if (!tab) {
		die(`No tab found on port ${port}`);
	}
	return tab;
}

export async function resetTabs(
	port: number,
	url: string,
	configureTab?: (cdp: CDP) => Promise<void>,
): Promise<{
	tab: Tab;
	navigation?: NavigationReport;
	consoleIssues: BrowserConsoleIssue[];
}> {
	const tabs = await listTabs(port);
	const pageTabs = tabs.filter((t) => t.type === "page");

	for (const tab of pageTabs.slice(1)) {
		await closeTabAllowingDialogs(port, tab);
	}

	const targetUrl = url || "about:blank";
	const consoleIssues: BrowserConsoleIssue[] = [];
	let navigation: NavigationReport | undefined;

	if (pageTabs.length > 0) {
		const firstTab = pageTabs[0];
		await fetch(`http://127.0.0.1:${port}/json/activate/${firstTab.id}`);

		if (targetUrl !== firstTab.url && targetUrl !== "about:blank") {
			try {
				const wsUrl = firstTab.webSocketDebuggerUrl;
				if (wsUrl) {
					const cdp = await CDP.connect(wsUrl);

					cdp.on("Runtime.consoleAPICalled", (params: unknown) => {
						const p = params as {
							type?: string;
							args?: Array<{ value?: string }>;
						};
						if (p?.type && p?.args?.[0]?.value) {
							consoleIssues.push({
								level: p.type,
								source: "console",
								text: p.args[0].value,
							});
						}
					});

					cdp.on("Log.entryAdded", (params: unknown) => {
						const p = params as { entry?: { level?: string; text?: string } };
						if (p?.entry?.level && p?.entry?.text) {
							consoleIssues.push({
								level: p.entry.level,
								source: "log",
								text: p.entry.text,
							});
						}
					});

					cdp.on("Runtime.exceptionThrown", (params: unknown) => {
						const p = params as {
							exceptionDetails?: {
								text?: string;
								exception?: { description?: string };
							};
						};
						const text =
							p?.exceptionDetails?.text ??
							p?.exceptionDetails?.exception?.description;
						if (text) {
							consoleIssues.push({
								level: "error",
								source: "exception",
								text,
							});
						}
					});

					await cdp.send("Page.enable");
					await cdp.send("Runtime.enable");
					await cdp.send("Log.enable");
					await preparePageLeave(cdp);

					const navResult = await cdp.send<{ frameId?: string }>(
						"Page.navigate",
						{ url: targetUrl },
					);

					const loadPromise = new Promise<void>((resolve) => {
						cdp.on("Page.loadEventFired", () => resolve());
					});
					await Promise.race([loadPromise, Bun.sleep(15000)]);

					const evalResult = await cdp.send<{
						result?: { value?: Record<string, unknown> };
					}>("Runtime.evaluate", {
						expression: `JSON.stringify({
              url: document.location.href,
              title: document.title,
              readyState: document.readyState
            })`,
						returnByValue: false,
					});

					let pageData: Record<string, unknown> | null = null;
					if (evalResult?.result?.value) {
						try {
							pageData = JSON.parse(String(evalResult.result.value)) as Record<
								string,
								unknown
							>;
						} catch {}
					}

					navigation = {
						pageLocation: navResult?.frameId ? targetUrl : undefined,
						pageStatus: pageData?.readyState === "complete" ? "ok" : "loading",
						pageStatusSummary: pageData
							? `URL: ${pageData.url}, Title: ${pageData.title}, ReadyState: ${pageData.readyState}`
							: "Unable to evaluate page state",
					};

					cdp.close();
				}
			} catch (error) {
				navigation = {
					pageStatus: "error",
					pageStatusSummary: String(error),
				};
			}
		}

		return {
			tab: firstTab,
			navigation,
			consoleIssues,
		};
	}

	if (targetUrl !== "about:blank") {
		const newTab = await createTab(port, targetUrl);
		if (newTab) {
			return { tab: newTab, consoleIssues };
		}
	}

	return {
		tab: {
			id: "",
			type: "page",
			title: "",
			url: targetUrl,
			webSocketDebuggerUrl: "",
		},
		consoleIssues,
	};
}

export type NavigationReport = {
	pageLocation?: string;
	pageStatus?: string;
	pageStatusSummary?: string;
	pageStatusAction?: string;
	errorText?: string;
};
