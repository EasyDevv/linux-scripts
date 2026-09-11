#!/usr/bin/env bun
/**
 * Capture the current (or --url) CDP tab into {DESIGN_THEMES}/ref/{host}/.
 * Writes viewport PNG, pages/{id}.mhtml, and merges index.json.
 */

import { mkdir } from "node:fs/promises";
import { relative } from "node:path";
import { refDirForHost } from "./paths.ts";
import {
	type RefIndex,
	VIEWPORTS,
	type ViewportId,
	fileExists,
	loadRefIndex,
	parseTarget,
	pngPath,
	snapshotPath,
} from "./ref-store.ts";

type CDPMessage = {
	id?: number;
	method?: string;
	result?: unknown;
	error?: { message: string };
};

const args = Bun.argv.slice(2);
const valueFor = (flag: string) => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};

const port = Number(valueFor("--port") ?? 9222);
const targetUrl = valueFor("--url");
const viewportId = (valueFor("--viewport") ?? "desktop") as ViewportId;
const skipMhtml = args.includes("--no-mhtml");
const forcePng = args.includes("--png");
const skipPngFlag = args.includes("--no-png");
const pageIdArg = valueFor("--id");
const keepTab = args.includes("--keep-tab");
const waitMs = Number(valueFor("--wait-ms") ?? 4000);

if (!targetUrl || !VIEWPORTS[viewportId]) {
	console.error("usage: save-ref.ts --url <url> [--id <page>] [--viewport desktop|tablet|mobile] [--port N] [--png|--no-png]");
	process.exit(2);
}

const viewport = VIEWPORTS[viewportId];
const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl ?? "about:blank")}`, {
	method: "PUT",
}).then((r) => r.json() as Promise<{ webSocketDebuggerUrl?: string; id?: string }>);
const wsUrl = created.webSocketDebuggerUrl;
if (!wsUrl) {
	throw new Error(`No page target on CDP port ${port}`);
}
const createdId = created.id;

const socket = new WebSocket(wsUrl);
await new Promise<void>((resolveOpen, reject) => {
	socket.addEventListener("open", () => resolveOpen(), { once: true });
	socket.addEventListener(
		"error",
		() => reject(new Error("Unable to connect to Chrome")),
		{ once: true },
	);
});

let sequence = 0;
const pending = new Map<
	number,
	{ resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
socket.addEventListener("message", (event) => {
	const message = JSON.parse(String(event.data)) as CDPMessage;
	if (!message.id || !pending.has(message.id)) return;
	const request = pending.get(message.id);
	if (!request) return;
	pending.delete(message.id);
	if (message.error) request.reject(new Error(message.error.message));
	else request.resolve(message.result);
});

function command(method: string, params: Record<string, unknown> = {}) {
	const id = ++sequence;
	socket.send(JSON.stringify({ id, method, params }));
	return new Promise<unknown>((resolveCmd, reject) => {
		pending.set(id, { resolve: resolveCmd, reject });
	});
}

await command("Page.enable");
await command("Runtime.enable");
await command("Emulation.setDeviceMetricsOverride", {
	width: viewport.width,
	height: viewport.height,
	deviceScaleFactor: 1,
	mobile: viewport.mobile,
});

if (targetUrl) {
	await command("Page.navigate", { url: targetUrl });
	await command("Page.waitForLifecycleEvent", { name: "networkIdle" }).catch(() => undefined);
	await Bun.sleep(Number.isFinite(waitMs) ? waitMs : 4000);
}

const evaluated = (await command("Runtime.evaluate", {
	expression: `JSON.stringify({
		url: location.href,
		title: document.title,
		ready: document.readyState,
		htmlClass: document.documentElement.className,
		innerWidth,
		innerHeight,
		devicePixelRatio
	})`,
	returnByValue: true,
})) as { result?: { value?: string } };

const measured = JSON.parse(evaluated.result?.value ?? "{}") as {
	url?: string;
	title?: string;
	htmlClass?: string;
};
const pageUrl = measured.url ?? targetUrl;
if (!pageUrl) {
	socket.close();
	if (createdId && !keepTab) await fetch(`http://127.0.0.1:${port}/json/close/${createdId}`);
	throw new Error("no page url");
}

const login =
	/\blog\s*in\b/i.test(measured.title ?? "") ||
	/\blogged-out\b/i.test(measured.htmlClass ?? "") ||
	/\/(login|signin)\b/i.test(new URL(pageUrl).pathname);
if (login) {
	socket.close();
	if (createdId && !keepTab) await fetch(`http://127.0.0.1:${port}/json/close/${createdId}`);
	throw new Error(`refused login page: ${pageUrl}`);
}

const target = parseTarget(pageUrl);
const dir = refDirForHost(target.host);
const pageId =
	pageIdArg ??
	(target.url?.pathname.split("/").filter(Boolean).slice(-1)[0] || "index");
await mkdir(dir, { recursive: true });
const pngFile = pngPath(dir, viewportId, pageId);
const skipPng = skipPngFlag || (!forcePng && (await fileExists(pngFile)));

if (!skipPng) {
	const shot = (await command("Page.captureScreenshot", {
		format: "png",
		fromSurface: true,
		captureBeyondViewport: false,
	})) as { data: string };
	const png = pngPath(dir, viewportId, pageId);
	await mkdir(png.slice(0, png.lastIndexOf("/")), { recursive: true });
	await Bun.write(png, Buffer.from(shot.data, "base64"));
}

let mhtmlRel: string | undefined;
if (!skipMhtml) {
	const snap = (await command("Page.captureSnapshot", {
		format: "mhtml",
	})) as { data: string };
	if (!snap.data?.includes("Content-Type: multipart/related") && (snap.data?.length ?? 0) < 200) {
		socket.close();
		if (createdId && !keepTab) await fetch(`http://127.0.0.1:${port}/json/close/${createdId}`);
		throw new Error("empty mhtml snapshot");
	}
	const mhtml = snapshotPath(dir, pageId);
	await mkdir(mhtml.slice(0, mhtml.lastIndexOf("/")), { recursive: true });
	await Bun.write(mhtml, snap.data);
	mhtmlRel = relative(dir, mhtml);
}

socket.close();
if (createdId && !keepTab) await fetch(`http://127.0.0.1:${port}/json/close/${createdId}`);

const loaded = await loadRefIndex(target.host);
const index: RefIndex = loaded.index ?? {
	pages: [],
	viewports: [],
	files: [],
	snapshots: [],
};
index.capturedAt = new Date().toISOString();
if (!index.viewports.some((item) => item.id === viewport.id)) {
	index.viewports.push({ ...viewport });
}
if (!index.pages.some((item) => item.id === pageId)) {
	index.pages.push({ id: pageId, url: pageUrl });
} else {
	index.pages = index.pages.map((item) =>
		item.id === pageId ? { id: pageId, url: pageUrl } : item,
	);
}
if (!skipPng) {
	const rel = relative(dir, pngPath(dir, viewportId, pageId));
	index.files = index.files.filter(
		(file) => !(file.page === pageId && file.viewport === viewportId),
	);
	index.files.push({ page: pageId, viewport: viewportId, url: pageUrl, file: rel });
}
if (mhtmlRel) {
	index.snapshots = (index.snapshots ?? []).filter((item) => item.page !== pageId);
	index.snapshots.push({ page: pageId, url: pageUrl, file: mhtmlRel, format: "mhtml" });
}
await Bun.write(loaded.indexPath, `${JSON.stringify(index, null, 2)}\n`);

const result = {
	dir,
	host: target.host,
	page: pageId,
	url: pageUrl,
	viewport: viewportId,
	png: skipPng ? null : relative(dir, pngPath(dir, viewportId, pageId)),
	snapshot: mhtmlRel ?? null,
	title: measured.title,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (mhtmlRel && !(await fileExists(snapshotPath(dir, pageId)))) {
	process.exit(1);
}
