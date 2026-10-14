import type { CDP } from "./cdp.ts";

export async function evaluateHealth(
	cdp: CDP,
): Promise<Record<string, unknown> | null> {
	try {
		const result = await cdp.send<{
			result?: { value?: string };
		}>("Runtime.evaluate", {
			expression: `(() => {
        const h = {
          url: document.location.href,
          title: document.title,
          readyState: document.readyState,
          health: {
            createdAt: Date.now(),
            heartbeatAt: Date.now(),
            domContentLoadedAt: null,
            loadEventAt: null,
            heartbeats: 1,
          }
        };
        const perf = performance.timing;
        if (perf) {
          if (perf.domContentLoadedEventEnd)
            h.health.domContentLoadedAt = perf.domContentLoadedEventEnd;
          if (perf.loadEventEnd)
            h.health.loadEventAt = perf.loadEventEnd;
        }
        return JSON.stringify(h);
      })()`,
			returnByValue: false,
		});

		if (result?.result?.value) {
			return JSON.parse(String(result.result.value)) as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

export type NavigationReport = {
	pageLocation?: string;
	pageStatus?: string;
	pageStatusSummary?: string;
	pageStatusAction?: string;
	errorText?: string;
};

const KNOWN_ERROR_TITLES = [
	"This site can't be reached",
	"This page isn't working",
	"ERR_CONNECTION_REFUSED",
	"ERR_NAME_NOT_RESOLVED",
	"ERR_CONNECTION_TIMED_OUT",
	"ERR_CONNECTION_RESET",
	"ERR_SSL_PROTOCOL_ERROR",
	"ERR_TUNNEL_CONNECTION_FAILED",
];

export function normalizeTargetUrl(input: string): string {
	if (!input) return "about:blank";

	if (/^(https?|ftp|about|chrome|file|data|view-source):/i.test(input)) {
		return input;
	}

	if (input.startsWith("//")) return `http:${input}`;

	if (/^[\w.-]+/.test(input)) {
		return `http://${input}`;
	}

	return input;
}

export function classifyPageStatus(
	url: string,
	title: string,
	errorText?: string,
): "ok" | "error" | "loading" | "unknown" {
	if (errorText) return "error";

	const isChromeError =
		url.startsWith("chrome-error://") ||
		KNOWN_ERROR_TITLES.some((t) => title.includes(t));
	if (isChromeError) return "error";

	if (url === "about:blank") return "loading";
	if (title && url && !url.startsWith("chrome-error://")) return "ok";

	return "unknown";
}
