import { closeSync, openSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findAvailablePort } from "./browser-state.ts";
import { CDP, getBrowserWsUrl } from "./cdp.ts";
import { processExists, resolveBinary, terminateProcess } from "./chrome-instance.ts";
import { buildChromeLaunchArgs } from "./config.ts";
import {
	type CdpCookie,
	type StoredCookie,
	fromCdpCookie,
	readSession,
	toCdpCookieParam,
	writeSession,
} from "./session.ts";
import { printHelp } from "./ui.ts";

/**
 * Throwaway fetch browsers. `findAvailablePort` scans this base plus the next
 * 99 ports (`browser-state` PORT_SCAN_LIMIT). That window never includes
 * chrome.service (9201) or the global profile (9222).
 */
export const FETCH_PORT_BASE = 9300;
export const FETCH_PORT_SPAN = 100;
export const RESERVED_PORTS = [9201, 9222] as const;

const DUMPS = ["text", "markdown", "html", "links", "assets", "original"] as const;
const WAIT_UNTILS = ["load", "domcontentloaded", "networkidle0"] as const;

export type DumpKind = (typeof DUMPS)[number];
export type WaitUntil = (typeof WAIT_UNTILS)[number];

export type FetchOptions = {
	url: string;
	dump: DumpKind;
	eval?: string;
	selector?: string;
	waitS: number;
	waitUntil: WaitUntil;
	timeoutS: number;
	proxy?: string;
	output?: string;
	session?: string;
	userAgent?: string;
	verbose: boolean;
};

export type LinkRow = { url: string; text: string };

export type MdInline =
	| { t: "text"; s: string }
	| { t: "link"; href: string; s: string }
	| { t: "code"; s: string }
	| { t: "img"; alt: string; src: string };

export type MdBlock =
	| { t: "h"; level: number; inlines: MdInline[] }
	| { t: "p"; inlines: MdInline[] }
	| { t: "pre"; s: string }
	| { t: "ul" | "ol"; items: MdInline[][] }
	| { t: "table"; rows: string[][] }
	| { t: "img"; alt: string; src: string };

/** In-flight Network requests. Idle once none have been open for `quietMs`. */
export type NetIdle = { inflight: number; quietSince: number | null };

const FETCH_HELP = `browser fetch — read a page with headless Chromium

Usage
  browser fetch <url> [options]

Options
  --dump <kind>        text | markdown | html | links | assets | original (default: text)
  --eval <js>          print one JS value instead of a dump
  --session <name>     load and write back that session's cookies
  --selector <css>     wait until it appears (within --timeout)
  --wait <s>           settle seconds after the page is ready (default: 2)
  --wait-until <ev>    load | domcontentloaded | networkidle0 (default: load)
  --timeout <s>        navigation timeout (default: 30)
  --proxy <url>        HTTP or SOCKS5 proxy (Chromium --proxy-server)
  --output <file>      write instead of stdout
  --user-agent <ua>    override the user agent
  --verbose            print page console errors

Examples
  browser fetch example.com --dump markdown
  browser fetch site.example/me --session 9222

Notes
  A throwaway headless Chromium; the process and profile are removed on exit.
  --stealth and --no-stealth are accepted and ignored.
  The user agent rewrites HeadlessChrome to Chrome.`;

function required(argv: string[], index: number, flag: string): string {
	const value = argv[index];
	if (value === undefined) throw new Error(`Usage: ${flag} <value>`);
	return value;
}

function seconds(raw: string, flag: string): number {
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) throw new Error(`Usage: ${flag} <seconds>`);
	return n;
}

export function parseFetchArgs(argv: string[]): FetchOptions {
	let url = "";
	let dump: DumpKind | undefined;
	let evalJs: string | undefined;
	let selector: string | undefined;
	let waitS = 2;
	let waitUntil: WaitUntil = "load";
	let timeoutS = 30;
	let proxy: string | undefined;
	let output: string | undefined;
	let session: string | undefined;
	let userAgent: string | undefined;
	let verbose = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case "--dump": {
				const value = required(argv, ++i, arg);
				if (!(DUMPS as readonly string[]).includes(value))
					throw new Error(`Unknown dump: ${value}`);
				dump = value as DumpKind;
				break;
			}
			case "--eval":
				evalJs = required(argv, ++i, arg);
				break;
			case "--selector":
				selector = required(argv, ++i, arg);
				break;
			case "--wait":
				waitS = seconds(required(argv, ++i, arg), arg);
				break;
			case "--wait-until": {
				const value = required(argv, ++i, arg);
				if (!(WAIT_UNTILS as readonly string[]).includes(value))
					throw new Error(`Unknown wait-until: ${value}`);
				waitUntil = value as WaitUntil;
				break;
			}
			case "--timeout":
				timeoutS = seconds(required(argv, ++i, arg), arg);
				break;
			case "--proxy":
				proxy = required(argv, ++i, arg);
				break;
			case "--output":
				output = required(argv, ++i, arg);
				break;
			case "--session":
				session = required(argv, ++i, arg);
				break;
			case "--user-agent":
				userAgent = required(argv, ++i, arg);
				break;
			case "--verbose":
			case "-v":
				verbose = true;
				break;
			case "--stealth":
			case "--no-stealth":
				break;
			default:
				if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
				if (!url) url = arg;
				else throw new Error(`Unexpected argument: ${arg}`);
		}
	}
	if (!url) throw new Error("Usage: browser fetch <url>");
	if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
	return {
		url,
		dump: dump ?? "text",
		eval: evalJs,
		selector,
		waitS,
		waitUntil,
		timeoutS,
		proxy,
		output,
		session,
		userAgent,
		verbose,
	};
}

export function fetchPortsIncludeReserved(
	base = FETCH_PORT_BASE,
	span = FETCH_PORT_SPAN,
): boolean {
	for (let port = base; port < base + span; port++) {
		if ((RESERVED_PORTS as readonly number[]).includes(port)) return true;
	}
	return false;
}

export function deheadlessUserAgent(ua: string): string {
	return ua.replaceAll("HeadlessChrome", "Chrome");
}

export function formatLinks(links: LinkRow[]): string {
	const order: string[] = [];
	const text = new Map<string, string>();
	for (const link of links) {
		if (!link.url) continue;
		const label = link.text.replace(/\s+/g, " ").trim();
		if (!text.has(link.url)) {
			order.push(link.url);
			text.set(link.url, label);
		} else if (!text.get(link.url) && label) {
			text.set(link.url, label);
		}
	}
	return order
		.map((url) => (text.get(url) ? `${url}\t${text.get(url)}` : url))
		.join("\n");
}

export function renderInlines(inlines: MdInline[]): string {
	return inlines
		.map((inline) => {
			if (inline.t === "text") return inline.s;
			if (inline.t === "code") return `\`${inline.s.replace(/`/g, "\\`")}\``;
			if (inline.t === "img") return `![${inline.alt}](${inline.src})`;
			const label = inline.s.trim();
			return label ? `[${label}](${inline.href})` : inline.href;
		})
		.join("")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}

function escapeCell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function blocksToMarkdown(blocks: MdBlock[]): string {
	const parts: string[] = [];
	for (const block of blocks) {
		if (block.t === "h") {
			const level = Math.min(6, Math.max(1, block.level));
			parts.push(`${"#".repeat(level)} ${renderInlines(block.inlines)}`);
		} else if (block.t === "p") {
			const text = renderInlines(block.inlines);
			if (text) parts.push(text);
		} else if (block.t === "pre") {
			parts.push(`\`\`\`\n${block.s.replace(/\n$/, "")}\n\`\`\``);
		} else if (block.t === "ul" || block.t === "ol") {
			parts.push(
				block.items
					.map((item, index) => {
						const bullet = block.t === "ol" ? `${index + 1}. ` : "- ";
						return bullet + renderInlines(item);
					})
					.join("\n"),
			);
		} else if (block.t === "table") {
			if (!block.rows.length) continue;
			const width = Math.max(...block.rows.map((row) => row.length));
			const rows = block.rows.map((row) =>
				Array.from({ length: width }, (_, i) => escapeCell(row[i] ?? "")),
			);
			const head = rows[0];
			parts.push(
				[
					`| ${head.join(" | ")} |`,
					`| ${head.map(() => "---").join(" | ")} |`,
					...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
				].join("\n"),
			);
		} else if (block.t === "img") {
			parts.push(`![${block.alt}](${block.src})`);
		}
	}
	return parts.join("\n\n").trim();
}

export function formatAssets(assets: Array<{ url: string; type: string }>): string {
	const seen = new Set<string>();
	const lines: string[] = [];
	for (const asset of assets) {
		if (!asset.url || asset.url === "about:blank") continue;
		const type = asset.type.toLowerCase();
		const key = `${type}\0${asset.url}`;
		if (seen.has(key)) continue;
		seen.add(key);
		lines.push(JSON.stringify({ url: asset.url, type }));
	}
	return lines.join("\n");
}

export function formatEvalValue(type: string, value: unknown): string {
	if (type === "undefined" || value === undefined) return "null";
	if (type === "string" || typeof value === "string") return String(value);
	if (typeof value === "bigint") return value.toString();
	return JSON.stringify(value);
}

export function decodeResponseBody(body: string, base64Encoded: boolean): Uint8Array {
	if (base64Encoded) return new Uint8Array(Buffer.from(body, "base64"));
	return new TextEncoder().encode(body);
}

export function netIdleStart(state: NetIdle): NetIdle {
	return { inflight: state.inflight + 1, quietSince: null };
}

export function netIdleDone(state: NetIdle, now: number): NetIdle {
	const inflight = Math.max(0, state.inflight - 1);
	return { inflight, quietSince: inflight === 0 ? (state.quietSince ?? now) : null };
}

export function netIdleReady(state: NetIdle, now: number, quietMs = 500): boolean {
	return state.inflight === 0 && state.quietSince !== null && now - state.quietSince >= quietMs;
}

/** Live cookies win, but a name the throwaway browser dropped is kept. */
export function mergeSessionCookies(
	original: StoredCookie[],
	live: StoredCookie[],
): StoredCookie[] {
	const key = (cookie: StoredCookie) => `${cookie.name}\0${cookie.domain}\0${cookie.path}`;
	const merged = new Map(original.map((cookie) => [key(cookie), cookie]));
	for (const cookie of live) {
		const prev = merged.get(key(cookie));
		if (prev && cookie.value === "" && prev.value !== "") continue;
		merged.set(key(cookie), cookie);
	}
	return [...merged.values()];
}

const LINKS_JS = `(() => [...document.querySelectorAll("a[href]")].map((a) => ({
  url: a.href,
  text: (a.innerText || "").replace(/\\s+/g, " ").trim()
})))()`;

const HTML_JS = `(() => {
  const dt = document.doctype ? "<!DOCTYPE " + document.doctype.name + ">\\n" : "";
  return dt + document.documentElement.outerHTML;
})()`;

const TEXT_JS = `document.body ? document.body.innerText : ""`;

const MARKDOWN_JS = `(() => {
  const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD"]);
  const inlineTags = new Set(["A", "SPAN", "B", "STRONG", "I", "EM", "CODE", "SMALL", "BR", "IMG", "SUB", "SUP", "MARK", "ABBR", "TIME", "LABEL"]);
  const blocks = [];
  function textOf(el) {
    return (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
  }
  function inlines(node) {
    const out = [];
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const raw = child.textContent || "";
        if (!raw.trim()) {
          if (/\\s/.test(raw) && out.length) out.push({ t: "text", s: " " });
          continue;
        }
        out.push({ t: "text", s: raw.replace(/\\s+/g, " ") });
      } else if (child.nodeType === 1) {
        const el = child;
        if (skip.has(el.tagName)) continue;
        const tag = el.tagName;
        if (tag === "BR") { out.push({ t: "text", s: "\\n" }); continue; }
        if (tag === "IMG") {
          out.push({ t: "img", alt: el.getAttribute("alt") || "", src: el.currentSrc || el.src || el.getAttribute("src") || "" });
          continue;
        }
        if (tag === "A") { out.push({ t: "link", href: el.href || "", s: textOf(el) }); continue; }
        if (tag === "CODE" && (!el.parentElement || el.parentElement.tagName !== "PRE")) {
          out.push({ t: "code", s: el.textContent || "" });
          continue;
        }
        out.push(...inlines(el));
      }
    }
    return out;
  }
  function walk(el) {
    if (!el || skip.has(el.tagName)) return;
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      blocks.push({ t: "h", level: Number(tag[1]), inlines: inlines(el) });
      return;
    }
    if (tag === "A") { blocks.push({ t: "p", inlines: [{ t: "link", href: el.href || "", s: textOf(el) }] }); return; }
    if (tag === "PRE") { blocks.push({ t: "pre", s: el.innerText || el.textContent || "" }); return; }
    if (tag === "P") { blocks.push({ t: "p", inlines: inlines(el) }); return; }
    if (tag === "UL" || tag === "OL") {
      const items = [...el.children].filter((c) => c.tagName === "LI").map((li) => inlines(li));
      blocks.push({ t: tag === "OL" ? "ol" : "ul", items });
      return;
    }
    if (tag === "TABLE") {
      const rows = [...el.querySelectorAll("tr")].map((tr) =>
        [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH").map((c) => textOf(c))
      );
      if (rows.length) blocks.push({ t: "table", rows });
      return;
    }
    if (tag === "IMG") {
      blocks.push({ t: "img", alt: el.getAttribute("alt") || "", src: el.currentSrc || el.src || "" });
      return;
    }
    const kids = [...el.children].filter((c) => !skip.has(c.tagName));
    // Only inline children (a lone <a> in a <div>): one paragraph, so links stay links.
    if (!kids.length || kids.every((c) => inlineTags.has(c.tagName))) {
      const inline = inlines(el);
      if (inline.length) blocks.push({ t: "p", inlines: inline });
      return;
    }
    for (const kid of kids) walk(kid);
  }
  if (document.body) walk(document.body);
  return blocks;
})()`;

type Hold = { pid: number; dir: string };

function forceCleanup(hold: Hold) {
	if (hold.pid) {
		try {
			process.kill(-hold.pid, "SIGKILL");
		} catch {
			try {
				process.kill(hold.pid, "SIGKILL");
			} catch {}
		}
	}
	if (hold.dir) {
		try {
			rmSync(hold.dir, { recursive: true, force: true });
		} catch {}
	}
}

async function release(hold: Hold) {
	if (hold.pid) {
		const pid = hold.pid;
		hold.pid = 0;
		await terminateProcess(pid, 2000).catch(async () => {
			try {
				process.kill(-pid, "SIGKILL");
			} catch {}
			try {
				process.kill(pid, "SIGKILL");
			} catch {}
		});
		const end = Date.now() + 2000;
		while (Date.now() < end && processExists(pid)) await Bun.sleep(50);
	}
	if (hold.dir) {
		const dir = hold.dir;
		hold.dir = "";
		for (let attempt = 0; attempt < 5; attempt++) {
			try {
				await rm(dir, { recursive: true, force: true });
				break;
			} catch {
				await Bun.sleep(100);
			}
		}
	}
}

async function stderrTail(path: string): Promise<string> {
	const text = await Bun.file(path)
		.text()
		.catch(() => "");
	return text.trim().split("\n").filter(Boolean).slice(-8).join("\n");
}

type EvalResult = {
	result?: { type?: string; value?: unknown };
	exceptionDetails?: { text?: string; exception?: { description?: string } };
};

async function evaluate(cdp: CDP, expression: string, timeoutMs: number) {
	const res = await cdp.send<EvalResult>(
		"Runtime.evaluate",
		{ expression, returnByValue: true, awaitPromise: true },
		timeoutMs,
	);
	if (res.exceptionDetails) {
		throw new Error(
			res.exceptionDetails.exception?.description ||
				res.exceptionDetails.text ||
				"evaluation failed",
		);
	}
	return { type: res.result?.type ?? "undefined", value: res.result?.value };
}

function waitEvent(cdp: CDP, event: string, deadline: number) {
	let timer: ReturnType<typeof setTimeout>;
	const done = new Promise<void>((resolve, reject) => {
		timer = setTimeout(
			() => reject(new Error(`Timed out waiting for ${event}`)),
			Math.max(0, deadline - Date.now()),
		);
		cdp.on(event, () => {
			clearTimeout(timer);
			resolve();
		});
	});
	return { done, cancel: () => clearTimeout(timer) };
}

async function emitText(text: string, output?: string) {
	const body = text.endsWith("\n") ? text : `${text}\n`;
	if (output) await Bun.write(output, body);
	else process.stdout.write(body);
}

async function emitBytes(bytes: Uint8Array, output?: string) {
	if (output) {
		await Bun.write(output, bytes);
		return;
	}
	await new Promise<void>((resolve, reject) => {
		process.stdout.write(bytes, (err) => (err ? reject(err) : resolve()));
	});
}

type Launch = { port: number; proc: Bun.Subprocess; stderrPath: string };

async function launchChrome(opts: FetchOptions, hold: Hold): Promise<Launch> {
	const dir = await mkdtemp(join(tmpdir(), "browser-fetch-"));
	hold.dir = dir;
	const port = await findAvailablePort(FETCH_PORT_BASE);
	if ((RESERVED_PORTS as readonly number[]).includes(port))
		throw new Error(`refusing reserved port ${port}`);
	const binary = resolveBinary();
	const extraArgs = opts.proxy ? [`--proxy-server=${opts.proxy}`] : [];
	const args = buildChromeLaunchArgs({
		port,
		userDataDir: dir,
		url: "about:blank",
		headless: true,
		extraArgs,
	});
	const stderrPath = join(dir, "chrome.stderr");
	const stderrFd = openSync(stderrPath, "w");
	let proc: Bun.Subprocess;
	try {
		proc = Bun.spawn({
			cmd: [binary, ...args],
			detached: true,
			stdin: "ignore",
			stdout: "ignore",
			stderr: stderrFd,
		});
	} finally {
		closeSync(stderrFd);
	}
	hold.pid = proc.pid;
	proc.unref();
	return { port, proc, stderrPath };
}

async function waitForPort(launch: Launch, timeoutMs: number) {
	let exitCode: number | null = null;
	launch.proc.exited.then((code) => {
		exitCode = code;
	});
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (exitCode !== null) {
			const tail = await stderrTail(launch.stderrPath);
			throw new Error(
				`Chromium exited before its debugging port opened (${exitCode})${tail ? `\n${tail}` : ""}`,
			);
		}
		try {
			const response = await fetch(`http://127.0.0.1:${launch.port}/json/version`, {
				signal: AbortSignal.timeout(750),
			});
			if (response.ok) return;
		} catch {}
		await Bun.sleep(100);
	}
	const tail = await stderrTail(launch.stderrPath);
	throw new Error(
		`Timed out waiting for Chrome on port ${launch.port}${tail ? `\n${tail}` : ""}`,
	);
}

async function pageWs(port: number, deadline: number): Promise<string> {
	while (Date.now() < deadline) {
		try {
			const tabs = (await (
				await fetch(`http://127.0.0.1:${port}/json/list`, {
					signal: AbortSignal.timeout(750),
				})
			).json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
			const page = tabs.find((tab) => tab.type === "page" && tab.webSocketDebuggerUrl);
			if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
		} catch {}
		await Bun.sleep(100);
	}
	throw new Error(`No page tab on port ${port}`);
}

async function applyCookies(browserCdp: CDP, pageCdp: CDP, cookies: StoredCookie[]) {
	if (!cookies.length) return;
	const params = cookies.map(toCdpCookieParam);
	const each = async (send: (cookie: Record<string, unknown>) => Promise<unknown>) => {
		for (const cookie of params) await send(cookie).catch(() => {});
	};
	try {
		await browserCdp.send("Storage.setCookies", { cookies: params });
	} catch {
		await each((cookie) => browserCdp.send("Storage.setCookies", { cookies: [cookie] }));
	}
	try {
		await pageCdp.send("Network.setCookies", { cookies: params });
	} catch {
		await each((cookie) => pageCdp.send("Network.setCookies", { cookies: [cookie] }));
	}
}

async function runFetch(opts: FetchOptions, hold: Hold) {
	const saved = opts.session ? await readSession(opts.session) : null;
	if (opts.session && !saved)
		throw new Error(
			`No session "${opts.session}". Create it: browser login <url> --session ${opts.session}`,
		);

	const launch = await launchChrome(opts, hold);
	const startMs = Math.min(20_000, Math.max(5_000, opts.timeoutS * 1000));
	await waitForPort(launch, startMs);

	const browserWs = await getBrowserWsUrl(launch.port);
	if (!browserWs) throw new Error(`No browser websocket on port ${launch.port}`);
	const browserCdp = await CDP.connect(browserWs);
	const pageCdp = await CDP.connect(await pageWs(launch.port, Date.now() + startMs));
	try {
		await pageCdp.send("Page.enable");
		await pageCdp.send("Network.enable");
		await pageCdp.send("Runtime.enable");
		if (opts.verbose) {
			await pageCdp.send("Log.enable").catch(() => {});
			const print = (text: string) => {
				if (text.trim()) console.error(text);
			};
			pageCdp.on("Runtime.consoleAPICalled", (params: unknown) => {
				const p = params as {
					type?: string;
					args?: Array<{ value?: unknown; description?: string }>;
				};
				if (p.type !== "error") return;
				print((p.args ?? []).map((arg) => String(arg.value ?? arg.description ?? "")).join(" "));
			});
			pageCdp.on("Runtime.exceptionThrown", (params: unknown) => {
				const p = params as {
					exceptionDetails?: { text?: string; exception?: { description?: string } };
				};
				print(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "");
			});
			pageCdp.on("Log.entryAdded", (params: unknown) => {
				const p = params as { entry?: { level?: string; text?: string } };
				if (p.entry?.level === "error" && p.entry.text) print(p.entry.text);
			});
		}

		if (saved) await applyCookies(browserCdp, pageCdp, saved);

		const version = await browserCdp.send<{ userAgent?: string }>("Browser.getVersion");
		const ua = opts.userAgent ?? deheadlessUserAgent(version.userAgent ?? "");
		if (ua) await pageCdp.send("Network.setUserAgentOverride", { userAgent: ua });

		const pending = new Set<string>();
		let idle: NetIdle = { inflight: 0, quietSince: null };
		let mainRequestId: string | null = null;
		let mainFrameId: string | null = null;
		let sawDocument = false;
		const assets: Array<{ url: string; type: string }> = [];

		pageCdp.on("Network.requestWillBeSent", (params: unknown) => {
			const p = params as {
				requestId: string;
				frameId?: string;
				type?: string;
				request?: { url?: string };
			};
			if (!pending.has(p.requestId)) {
				pending.add(p.requestId);
				idle = netIdleStart(idle);
			}
			const type = p.type ?? "";
			const url = p.request?.url ?? "";
			const main =
				type === "Document" &&
				(!mainRequestId || (p.frameId !== undefined && p.frameId === mainFrameId));
			if (main) {
				mainRequestId = p.requestId;
				if (p.frameId) mainFrameId = p.frameId;
				sawDocument = true;
			} else if (url) {
				assets.push({ url, type: type || "other" });
			}
		});
		const finish = (params: unknown) => {
			const id = (params as { requestId?: string }).requestId;
			if (id && pending.delete(id)) idle = netIdleDone(idle, Date.now());
		};
		pageCdp.on("Network.loadingFinished", finish);
		pageCdp.on("Network.loadingFailed", finish);

		const deadline = Date.now() + opts.timeoutS * 1000;
		const event =
			opts.waitUntil === "domcontentloaded"
				? "Page.domContentEventFired"
				: "Page.loadEventFired";
		const waiter = opts.waitUntil === "networkidle0" ? null : waitEvent(pageCdp, event, deadline);
		try {
			const nav = await pageCdp.send<{ errorText?: string }>(
				"Page.navigate",
				{ url: opts.url },
				Math.max(1000, deadline - Date.now()),
			);
			if (nav.errorText) throw new Error(nav.errorText);
			if (waiter) await waiter.done;
			else {
				while (Date.now() < deadline) {
					if (sawDocument && netIdleReady(idle, Date.now())) break;
					await Bun.sleep(50);
				}
				if (!(sawDocument && netIdleReady(idle, Date.now())))
					throw new Error(`Timed out waiting for networkidle0 (${opts.url})`);
			}
		} finally {
			waiter?.cancel();
		}

		let original: Uint8Array | null = null;
		if (!opts.eval && opts.dump === "original") {
			if (!mainRequestId) throw new Error("No main document response");
			const body = await pageCdp.send<{ body: string; base64Encoded: boolean }>(
				"Network.getResponseBody",
				{ requestId: mainRequestId },
				Math.max(5000, opts.timeoutS * 1000),
			);
			original = decodeResponseBody(body.body, body.base64Encoded);
		}

		if (opts.selector) {
			let found = false;
			while (Date.now() < deadline) {
				const res = await evaluate(
					pageCdp,
					`!!document.querySelector(${JSON.stringify(opts.selector)})`,
					5_000,
				);
				if (res.value) {
					found = true;
					break;
				}
				await Bun.sleep(100);
			}
			if (!found) throw new Error(`Timed out waiting for ${opts.selector}`);
		}

		if (opts.waitS > 0) await Bun.sleep(opts.waitS * 1000);

		if (opts.session && saved) {
			const { cookies } = await browserCdp.send<{ cookies: CdpCookie[] }>("Storage.getCookies");
			await writeSession(opts.session, mergeSessionCookies(saved, cookies.map(fromCdpCookie)));
		}

		if (opts.eval) {
			const res = await evaluate(pageCdp, opts.eval, Math.max(5_000, opts.timeoutS * 1000));
			await emitText(formatEvalValue(res.type, res.value), opts.output);
			return;
		}
		if (opts.dump === "original") {
			await emitBytes(original ?? new Uint8Array(), opts.output);
			return;
		}
		if (opts.dump === "assets") {
			await emitText(formatAssets(assets), opts.output);
			return;
		}
		if (opts.dump === "links") {
			const res = await evaluate(pageCdp, LINKS_JS, 15_000);
			await emitText(formatLinks((res.value as LinkRow[]) ?? []), opts.output);
			return;
		}
		if (opts.dump === "markdown") {
			const res = await evaluate(pageCdp, MARKDOWN_JS, 15_000);
			await emitText(blocksToMarkdown((res.value as MdBlock[]) ?? []), opts.output);
			return;
		}
		const expression = opts.dump === "html" ? HTML_JS : TEXT_JS;
		const res = await evaluate(pageCdp, expression, 15_000);
		await emitText(typeof res.value === "string" ? res.value : "", opts.output);
	} finally {
		pageCdp.close();
		browserCdp.close();
	}
}

export async function fetchMain(argv: string[]): Promise<void> {
	if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
		printHelp(FETCH_HELP);
		return;
	}
	const opts = parseFetchArgs(argv);
	const hold: Hold = { pid: 0, dir: "" };
	const onExit = () => forceCleanup(hold);
	process.on("exit", onExit);
	try {
		await runFetch(opts, hold);
	} finally {
		await release(hold);
		process.off("exit", onExit);
	}
}
