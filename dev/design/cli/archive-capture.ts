#!/usr/bin/env bun
/**
 * Capture the current CDP tab: viewport, plain PNG, optional MHTML.
 * Does not compare replay to live. Does not change the tab URL unless --url is set.
 */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

type CDPMessage = {
	id?: number;
	result?: unknown;
	error?: { message: string };
};

const args = Bun.argv.slice(2);
const valueFor = (flag: string) => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};

const port = Number(valueFor("--port") ?? 9222);
const outDir = resolve(valueFor("--out") ?? `/tmp/site-to-design/capture-${Date.now()}`);
const targetUrl = valueFor("--url");
const skipMhtml = args.includes("--no-mhtml");

const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const tab = (tabs as { type: string; webSocketDebuggerUrl?: string }[]).find(
	(candidate) => candidate.type === "page",
);
if (!tab?.webSocketDebuggerUrl) {
	throw new Error(`No page target on CDP port ${port}`);
}

const socket = new WebSocket(tab.webSocketDebuggerUrl);
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
if (targetUrl) {
	await command("Page.navigate", { url: targetUrl });
}

const evaluated = (await command("Runtime.evaluate", {
	expression: `JSON.stringify({
		url: location.href,
		title: document.title,
		ready: document.readyState,
		innerWidth,
		innerHeight,
		devicePixelRatio,
		fonts: document.fonts.status
	})`,
	returnByValue: true,
})) as { result?: { value?: string } };

const viewport = JSON.parse(evaluated.result?.value ?? "{}") as Record<
	string,
	unknown
>;

await mkdir(outDir, { recursive: true });
const shot = (await command("Page.captureScreenshot", {
	format: "png",
	fromSurface: true,
	captureBeyondViewport: false,
})) as { data: string };
const pngPath = resolve(outDir, "live.png");
await Bun.write(pngPath, Buffer.from(shot.data, "base64"));
const png = Bun.file(pngPath);
const pngSize = png.size;

if (!skipMhtml) {
	const snap = (await command("Page.captureSnapshot", {
		format: "mhtml",
	})) as { data: string };
	await Bun.write(resolve(outDir, "live.mhtml"), snap.data);
}

const manifest = {
	out: outDir,
	capturedAt: new Date().toISOString(),
	viewport,
	pngBytes: pngSize,
	files: skipMhtml ? ["live.png", "manifest.json"] : ["live.png", "live.mhtml", "manifest.json"],
};
await Bun.write(resolve(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
socket.close();
process.stdout.write(`${JSON.stringify(manifest)}\n`);
