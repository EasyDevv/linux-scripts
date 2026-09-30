// Draft ↔ live comparison for the daangn ref catalogue.
//
//   bun themes/daangn/.build/compare.ts <page> [--scheme light|dark] [--only section-id,...] [--shots dir]
//
// For every `<section data-live="page:index">` on the draft page, collects the `seed-*` nodes inside
// its [data-role=stage] exactly the way census.ts collects the live preview, then diffs them node by
// node (matched in document order per base class list) against ref/seed-design.io/census/{scheme}/{page}.json.
// Compared: w/h (±0.6px), padding, gap, radius, border, background, colour, font, shadow, opacity.
// With --shots, writes {dir}/{section}.png = live crop | draft crop, side by side (ImageMagick).
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const [page] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const arg = (n: string) => {
	const i = process.argv.indexOf(n);
	return i > 0 ? process.argv[i + 1] : undefined;
};
const scheme = arg("--scheme") ?? "light";
const only = arg("--only")?.split(",");
const shots = arg("--shots");
const port = Number(arg("--port") ?? 9222);
const store = resolve(import.meta.dir, "../../../ref/seed-design.io");

type Node = {
	tag: string;
	cls: string;
	text: string;
	box: number[];
	pad: string;
	gap: string;
	radius: string;
	border: string;
	bg: string;
	color: string;
	font: string;
	shadow: string;
	opacity: string;
};

// Same field extraction as census.ts (runs in the page).
function collectDraft(only: string[] | null) {
	const px = (v: string) => v.replace(/px/g, "");
	return [...document.querySelectorAll("section[data-live]")]
		.filter((s) => !only || only.includes(s.id))
		.map((section) => {
			const stage = section.querySelector("[data-role=stage]") as HTMLElement;
			stage.scrollIntoView({ block: "center" });
			const r = stage.getBoundingClientRect();
			const nodes = [...stage.querySelectorAll("*")]
				.filter((el): el is HTMLElement => [...el.classList].some((c) => c.startsWith("seed-")))
				.slice(0, 80)
				.map((el) => {
					const b = el.getBoundingClientRect();
					const c = getComputedStyle(el);
					return {
						tag: el.tagName.toLowerCase(),
						cls: [...el.classList].filter((x) => x.startsWith("seed-")).join(" "),
						text: el.children.length === 0 ? (el.textContent || "").trim().slice(0, 40) : "",
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
			return { id: section.id, live: (section as HTMLElement).dataset.live as string, nodes };
		});
}

/** Base classes only: drop SEED modifier classes (`seed-x--size_medium`), keep slots and helpers. */
const base = (cls: string) =>
	cls
		.split(" ")
		.filter((c) => !c.includes("--"))
		.sort()
		.join(" ");
const near = (a: number, b: number, tol = 0.6) => Math.abs(a - b) <= tol;
const norm = (v: string) => v.replace(/\s+/g, " ").replace(/(\d+\.\d{2})\d+/g, "$1");

/** SEED layout primitives the docs examples use for arrangement only (VStack, HStack, Box, Grid). */
const LAYOUT = /^(seed-box|seed-grid|seed-stack|seed-inline|seed-columns|seed-float)( |$)/;

function diffNodes(liveAll: Node[], draftAll: Node[]) {
	const diffs: string[] = [];
	const live = liveAll.filter((n) => !LAYOUT.test(base(n.cls)));
	const draft = draftAll.filter((n) => !LAYOUT.test(base(n.cls)));
	const byBase = (list: Node[]) => {
		const m = new Map<string, Node[]>();
		for (const n of list) m.set(base(n.cls), [...(m.get(base(n.cls)) ?? []), n]);
		return m;
	};
	const L = byBase(live);
	const D = byBase(draft);
	for (const [k, ls] of L) {
		const ds = D.get(k) ?? [];
		if (ds.length !== ls.length) diffs.push(`${k}: live ${ls.length} node(s), draft ${ds.length}`);
		ls.forEach((l, i) => {
			const d = ds[i];
			if (!d) return;
			const tag = `${k.replace(/seed-/g, "")}#${i}${l.text ? ` "${l.text}"` : ""}`;
			if (!near(l.box[2], d.box[2]) || !near(l.box[3], d.box[3])) diffs.push(`${tag} size live ${l.box[2]}x${l.box[3]} draft ${d.box[2]}x${d.box[3]}`);
			for (const f of ["pad", "gap", "radius", "border", "bg", "color", "font", "shadow", "opacity"] as const)
				if (norm(l[f]) !== norm(d[f])) diffs.push(`${tag} ${f} live "${l[f]}" draft "${d[f]}"`);
		});
	}
	for (const [k, ds] of D) if (!L.has(k)) diffs.push(`${k}: draft-only ×${ds.length}`);
	return diffs;
}

const url = `http://dashboard.localhost/design/draft?file=${page}/page.svelte&project=theme-daangn&style=daangn&scheme=${scheme}`;
const tab = (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json())) as {
	id: string;
	webSocketDebuggerUrl: string;
};
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok) => (ws.onopen = ok));
let id = 0;
const waiters = new Map<number, (m: { result?: never; error?: { message: string } }) => void>();
ws.onmessage = (e) => {
	const m = JSON.parse(String(e.data));
	if (m.id && waiters.has(m.id)) {
		waiters.get(m.id)?.(m);
		waiters.delete(m.id);
	}
};
const send = <T = never>(method: string, params: object = {}) =>
	new Promise<T>((ok, bad) => {
		const i = ++id;
		const timer = setTimeout(() => bad(new Error(`${method}: timed out`)), 45000);
		waiters.set(i, (m) => {
			clearTimeout(timer);
			m.error ? bad(new Error(`${method}: ${m.error.message}`)) : ok(m.result as T);
		});
		ws.send(JSON.stringify({ id: i, method, params }));
	});
const js = async <T>(expression: string) =>
	(await send<{ result: { value: T } }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Page.navigate", { url });
await Bun.sleep(4500);

const sections = await js<{ id: string; live: string; nodes: Node[] }[]>(`(${collectDraft.toString()})(${JSON.stringify(only ?? null)})`);
const census = new Map<string, { previews: { index: number; heading: string; nodes: Node[] }[] }>();
const report: { id: string; live: string; heading: string; diffs: string[] }[] = [];
if (shots) mkdirSync(shots, { recursive: true });
for (const s of sections) {
	const [livePage, idx] = s.live.split(":");
	if (!census.has(livePage)) census.set(livePage, await Bun.file(join(store, "census", scheme, `${livePage}.json`)).json());
	const preview = census.get(livePage)?.previews[Number(idx)];
	if (!preview) {
		report.push({ id: s.id, live: s.live, heading: "", diffs: ["no live preview"] });
		continue;
	}
	const diffs = diffNodes(preview.nodes, s.nodes);
	report.push({ id: s.id, live: s.live, heading: preview.heading, diffs });
	if (shots) {
		const rect = await js<number[]>(`(() => { const st = document.getElementById(${JSON.stringify(s.id)}).querySelector('[data-role=stage]'); st.scrollIntoView({block:'center'}); const r = st.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`);
		await Bun.sleep(250);
		const shot = await send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { x: rect[0], y: rect[1], width: rect[2], height: rect[3], scale: 1 } });
		const draftPng = join(shots, `${s.id}.draft.png`);
		await Bun.write(draftPng, Buffer.from(shot.data, "base64"));
		const livePng = join(store, scheme, `${livePage}-${idx}.png`);
		Bun.spawnSync(["magick", livePng, draftPng, "-background", "#ff00ff", "-splice", "4x0", "+append", join(shots, `${s.id}.png`)]);
	}
}
ws.close();
await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);

let bad = 0;
for (const r of report) {
	if (r.diffs.length) bad++;
	console.log(`${r.diffs.length ? "✗" : "✓"} ${r.id} ← ${r.live} ${r.heading}`);
	for (const d of r.diffs.slice(0, 12)) console.log(`    ${d}`);
	if (r.diffs.length > 12) console.log(`    … ${r.diffs.length - 12} more`);
}
console.log(`${report.length - bad}/${report.length} sections match (${scheme})`);
mkdirSync(join(store, "compare"), { recursive: true });
await Bun.write(join(store, "compare", `${page}-${scheme}.json`), `${JSON.stringify(report, null, "\t")}\n`);
process.exit(0);
