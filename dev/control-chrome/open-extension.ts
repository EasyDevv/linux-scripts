import { CDP, getBrowserWsUrl } from "./cdp.ts";
import { DEFAULT_PORT } from "./config.ts";

const DEFAULT_PAGE = "popup.html";

const HELP = `control-chrome open-extension — Open extension page by name

Usage: control-chrome open-extension <NAME_PATTERN> [options]

Options:
  --port <N>            CDP debug port (default: 9222)
  --page <page>         Extension page to open (default: popup.html)
  --help                Show this help

Environment:
  EXTENSION_NAME        Name pattern (alternative to positional arg)`;

function die(msg: string): never {
	console.error(`✗ ${msg}`);
	process.exit(1);
}

async function sleep(ms: number) {
	return await new Promise((resolve) => setTimeout(resolve, ms));
}

async function cdpFetch(port: number, path: string): Promise<unknown> {
	const response = await fetch(`http://127.0.0.1:${port}${path}`, {
		signal: AbortSignal.timeout(5000),
	});
	if (!response.ok) {
		throw new Error(`CDP ${path}: ${response.status}`);
	}
	return await response.json();
}

async function findExtensionId(
	port: number,
	namePattern: string,
): Promise<string | null> {
	const targets = (await cdpFetch(port, "/json/list")) as Array<{
		type: string;
		url?: string;
		webSocketDebuggerUrl?: string;
	}>;
	const serviceWorkers = targets.filter((t) => t.type === "service_worker");

	for (const sw of serviceWorkers) {
		const url = sw.url || "";
		const match = url.match(/^chrome-extension:\/\/([a-z]{32})\//);
		if (!match) continue;

		const extId = match[1];
		if (extId === "cimiefiiaegbelhefglklhhakcgmhkai") continue;

		try {
			const wsUrl = sw.webSocketDebuggerUrl;
			if (!wsUrl) continue;

			const cdp = await CDP.connect(wsUrl);
			const result = await cdp.send<{
				result?: { value?: string };
			}>("Runtime.evaluate", {
				expression: "chrome.runtime.getManifest().name",
				awaitPromise: true,
				returnByValue: true,
			});
			cdp.close();

			const extName = result?.result?.value;
			if (
				extName &&
				extName.toLowerCase().includes(namePattern.toLowerCase())
			) {
				return extId;
			}
		} catch {
			continue;
		}
	}

	return null;
}

async function waitForExtensionId(
	port: number,
	namePattern: string,
	timeoutMs = 15000,
): Promise<string | null> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const extId = await findExtensionId(port, namePattern);
		if (extId) return extId;
		await sleep(250);
	}

	return null;
}

function stripUrlSuffix(url: string): string {
	return url.split(/[?#]/, 1)[0];
}

async function findExistingExtensionPage(
	port: number,
	extId: string,
	page: string,
): Promise<{ webSocketDebuggerUrl?: string } | null> {
	const targets = (await cdpFetch(port, "/json/list")) as Array<{
		type: string;
		url?: string;
		webSocketDebuggerUrl?: string;
	}>;
	const targetUrl = stripUrlSuffix(`chrome-extension://${extId}/${page}`);

	return (
		targets.find(
			(target) =>
				target.type === "page" &&
				stripUrlSuffix(target.url || "") === targetUrl,
		) ?? null
	);
}

async function openExtensionPage(
	port: number,
	extId: string,
	page: string,
): Promise<void> {
	const url = `chrome-extension://${extId}/${page}`;
	const existingPage = await findExistingExtensionPage(port, extId, page);

	if (existingPage?.webSocketDebuggerUrl) {
		const wsUrl = existingPage.webSocketDebuggerUrl;
		const cdp = await CDP.connect(wsUrl);
		await cdp.send("Page.navigate", { url });
		await cdp.send("Page.bringToFront");
		cdp.close();
		console.log(`✓ Reused ${url}`);
		return;
	}

	const browserWsUrl = await getBrowserWsUrl(port);
	if (!browserWsUrl) {
		die(`Cannot connect to Chrome on port ${port}`);
	}

	const browserCdp = await CDP.connect(browserWsUrl);
	await browserCdp.send("Target.createTarget", { url });
	browserCdp.close();
	console.log(`✓ Opened ${url}`);
}

export async function main(argv: string[]): Promise<void> {
	let port = DEFAULT_PORT;
	let namePattern: string | undefined;
	let pageArg = DEFAULT_PAGE;
	const positional: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--port":
				port = +(argv[++i] ?? 0);
				break;
			case "--page":
				pageArg = argv[++i] ?? DEFAULT_PAGE;
				break;
			case "--help":
				console.log(HELP);
				process.exit(0);
			default:
				positional.push(argv[i]);
		}
	}

	namePattern = process.env.EXTENSION_NAME || positional[0];

	if (!namePattern) {
		console.error("Error: NAME_PATTERN is required");
		console.log(HELP);
		process.exit(1);
	}

	try {
		const extId = await waitForExtensionId(port, namePattern);
		if (!extId) {
			die(`Extension matching "${namePattern}" not found`);
		}

		console.log(`Found extension: ${extId}`);
		await openExtensionPage(port, extId, pageArg);
	} catch (err) {
		die(err instanceof Error ? err.message : String(err));
	}
}
