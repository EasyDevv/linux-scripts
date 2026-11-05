import { CDP, type Tab } from "./cdp.ts";
import { classifyPageStatus } from "./navigation.ts";

export type PageCheck = {
	status: "ok" | "error" | "timeout";
	url: string;
	title: string;
	readyState: string;
	elapsedMs: number;
	detail?: string;
};

type Probe = { url: string; title: string; readyState: string };

async function firstPageTab(port: number): Promise<Tab | null> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
			signal: AbortSignal.timeout(1500),
		});
		const tabs = (await res.json()) as Tab[];
		return tabs.find((t) => t.type === "page") ?? null;
	} catch {
		return null;
	}
}

async function probe(tab: Tab, stepMs: number): Promise<Probe | null> {
	if (!tab.webSocketDebuggerUrl) return null;
	let cdp: CDP | undefined;
	try {
		cdp = await CDP.connect(tab.webSocketDebuggerUrl, stepMs);
		const r = await cdp.send<{ result?: { value?: string } }>(
			"Runtime.evaluate",
			{
				expression: "JSON.stringify({url: location.href, title: document.title, readyState: document.readyState})",
				returnByValue: true,
			},
			stepMs,
		);
		return r?.result?.value ? (JSON.parse(r.result.value) as Probe) : null;
	} catch {
		return null;
	} finally {
		cdp?.close();
	}
}

/**
 * Wait until the first tab has finished loading a real page. "error" is a
 * chrome-error page (connection refused, DNS); "timeout" is a renderer that
 * never got there (no response, or CDP itself hanging), the case a script
 * would otherwise spend minutes on.
 */
export async function verifyPage(
	port: number,
	timeoutMs = 15_000,
	stepMs = 3_000,
	/** A tab still on about:blank this long never started its navigation: give up early. */
	blankMs = 5_000,
): Promise<PageCheck> {
	const start = Date.now();
	let last: Probe = { url: "", title: "", readyState: "no tab" };
	let detail: string | undefined;
	while (Date.now() - start < timeoutMs) {
		const tab = await firstPageTab(port);
		if (!tab) {
			detail = "no page tab answering /json/list";
		} else if (tab.url.startsWith("chrome-error://")) {
			return { status: "error", url: tab.url, title: tab.title, readyState: "", elapsedMs: Date.now() - start };
		} else {
			const p = await probe(tab, Math.min(stepMs, timeoutMs - (Date.now() - start)));
			if (!p) {
				last = { url: tab.url, title: tab.title, readyState: "no answer" };
				detail = "the tab does not answer Runtime.evaluate (renderer hung)";
			} else {
				last = p;
				detail = undefined;
				if (p.url === "about:blank" && Date.now() - start >= blankMs) {
					return { status: "timeout", ...p, elapsedMs: Date.now() - start, detail: "the navigation never started" };
				}
				if (p.readyState === "complete" && p.url !== "about:blank") {
					const status = classifyPageStatus(p.url, p.title);
					return {
						status: status === "error" ? "error" : "ok",
						...p,
						elapsedMs: Date.now() - start,
					};
				}
			}
		}
		await Bun.sleep(200);
	}
	return { status: "timeout", ...last, elapsedMs: Date.now() - start, detail };
}

export function describePageCheck(check: PageCheck): string {
	const secs = (check.elapsedMs / 1000).toFixed(1);
	if (check.status === "ok") return `page ok "${check.title}" ${secs}s`;
	if (check.status === "error") return `page error ${check.url} "${check.title}"`;
	return `page not loaded after ${secs}s (tab at ${check.url || "nothing"}, ${check.readyState}${check.detail ? `; ${check.detail}` : ""})`;
}
