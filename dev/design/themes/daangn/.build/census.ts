// Census of the live SEED docs (seed-design.io): every inline preview of every
// component page, in light and dark, as computed styles + a PNG crop per preview.
//
//   bun themes/daangn/.build/census.ts [--port 9222] [--only action-button,chip] [--scheme light|dark|both]
//
// Output (the durable live reference for this theme):
//   ref/seed-design.io/index.json                     page list
//   ref/seed-design.io/census/{scheme}/{page}.json    per preview: heading, rect, nodes[]
//   ref/seed-design.io/{scheme}/{page}-{n}.png        preview crops (light: all, dark: all)
// A node is any element carrying a `seed-*` recipe class, up to 80 per preview.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const arg = (n: string) => {
	const i = process.argv.indexOf(n);
	return i > 0 ? process.argv[i + 1] : undefined;
};
const port = Number(arg("--port") ?? 9222);
const only = arg("--only")?.split(",");
const schemes = (arg("--scheme") ?? "both") === "both" ? ["light", "dark"] : [arg("--scheme") as string];
const seed = resolve(homedir(), ".ref/seed-design/docs/content/react/components");
const store = resolve(import.meta.dir, "../../../ref/seed-design.io");

const PAGES = [
	...[...new Bun.Glob("*.mdx").scanSync(seed)].map((f) => f.replace(/\.mdx$/, "")),
	"app-screen",
].filter((p) => !only || only.includes(p)).sort();
const url = (p: string) =>
	p === "app-screen" ? "https://seed-design.io/react/stackflow/app-screen" : `https://seed-design.io/react/components/${p}`;

class CDP {
	ws: WebSocket;
	id = 0;
	pending = new Map<number, (v: { result?: unknown; error?: { message: string } }) => void>();
	constructor(ws: WebSocket) {
		this.ws = ws;
		ws.onmessage = (e) => {
			const m = JSON.parse(String(e.data));
			if (m.id && this.pending.has(m.id)) {
				this.pending.get(m.id)?.(m);
				this.pending.delete(m.id);
			}
		};
	}
	send<T = unknown>(method: string, params: object = {}) {
		const id = ++this.id;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise<T>((ok, bad) =>
			this.pending.set(id, (m) => (m.error ? bad(new Error(`${method}: ${m.error.message}`)) : ok(m.result as T))),
		);
	}
	async eval<T>(expression: string) {
		const r = await this.send<{ result: { value: T }; exceptionDetails?: { exception?: { description?: string } } }>(
			"Runtime.evaluate",
			{ expression, returnByValue: true, awaitPromise: true },
		);
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
		return r.result.value;
	}
}

// Runs in the page. Plain JS, serialized once.
function collect() {
	const panels = [...document.querySelectorAll("article .seed-chip-tabs__content")].filter(
		(p) => p.querySelector(".not-prose") && !p.querySelector("pre"),
	);
	const headings = [...document.querySelectorAll("article h2, article h3")];
	const px = (v: string) => v.replace(/px/g, "");
	return panels.map((panel, index) => {
		const stage = panel.querySelector(".not-prose") as HTMLElement;
		const frame = (stage.parentElement ?? stage) as HTMLElement;
		const r = frame.getBoundingClientRect();
		let heading = "";
		for (const h of headings) if (h.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING) heading = h.textContent.trim();
		const nodes = [...stage.querySelectorAll("*")]
			.filter((el): el is HTMLElement => [...el.classList].some((c) => c.startsWith("seed-")))
			.slice(0, 80)
			.map((el) => {
				const b = el.getBoundingClientRect();
				const c = getComputedStyle(el);
				const cls = [...el.classList].filter((x) => x.startsWith("seed-"));
				const text = el.children.length === 0 ? (el.textContent || "").trim().slice(0, 40) : "";
				return {
					tag: el.tagName.toLowerCase(),
					cls: cls.join(" "),
					data: Object.fromEntries(Object.entries(el.dataset).filter(([k]) => !k.startsWith("ownedby") && k !== "part" && k !== "scope")),
					text,
					box: [Math.round(b.x - r.x), Math.round(b.y - r.y), +b.width.toFixed(1), +b.height.toFixed(1)],
					pad: px(c.padding),
					gap: c.gap === "normal" ? "" : px(c.gap),
					radius: px(c.borderRadius),
					border: c.borderTopWidth === "0px" && c.borderBottomWidth === "0px" ? "" : `${px(c.borderWidth)} ${c.borderTopColor}`,
					bg: c.backgroundColor === "rgba(0, 0, 0, 0)" ? (c.backgroundImage !== "none" ? c.backgroundImage.slice(0, 80) : "") : c.backgroundColor,
					color: c.color,
					font: `${px(c.fontSize)}/${px(c.lineHeight)}/${c.fontWeight}`,
					shadow: c.boxShadow === "none" ? "" : c.boxShadow,
					opacity: c.opacity === "1" ? "" : c.opacity,
				};
			});
		return { index, heading, rect: [Math.round(r.x), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)], nodes };
	});
}

const tab = (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json())) as {
	id: string;
	webSocketDebuggerUrl: string;
};
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok) => (ws.onopen = ok));
const cdp = new CDP(ws);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });

const index: { id: string; url: string; previews: Record<string, number> }[] = [];
for (const scheme of schemes) {
	mkdirSync(join(store, "census", scheme), { recursive: true });
	mkdirSync(join(store, scheme), { recursive: true });
	await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
	for (const page of PAGES) {
		await cdp.send("Page.navigate", { url: url(page) });
		await Bun.sleep(3500);
		await cdp.eval(`document.documentElement.dataset.seedUserColorScheme = ${JSON.stringify(scheme)}`);
		await Bun.sleep(300);
		const previews = await cdp.eval<ReturnType<typeof collect>>(`(${collect.toString()})()`);
		await Bun.write(join(store, "census", scheme, `${page}.json`), `${JSON.stringify({ page, url: url(page), scheme, previews })}\n`);
		for (const p of previews) {
			const [x, y, w, h] = p.rect;
			if (!w || !h) continue;
			const shot = await cdp.send<{ data: string }>("Page.captureScreenshot", {
				format: "png",
				captureBeyondViewport: true,
				clip: { x, y, width: w, height: h, scale: 1 },
			});
			await Bun.write(join(store, scheme, `${page}-${p.index}.png`), Buffer.from(shot.data, "base64"));
		}
		const entry = index.find((e) => e.id === page) ?? (index.push({ id: page, url: url(page), previews: {} }), index[index.length - 1]);
		entry.previews[scheme] = previews.length;
		console.log(`${scheme} ${page}: ${previews.length} previews, ${previews.reduce((n, p) => n + p.nodes.length, 0)} nodes`);
	}
}
await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
if (!only) await Bun.write(join(store, "index.json"), `${JSON.stringify({ host: "seed-design.io", viewport: { width: 1440, height: 900, dpr: 1 }, pages: index }, null, "\t")}\n`);
