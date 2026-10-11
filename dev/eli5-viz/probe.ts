#!/usr/bin/env bun
/** Drive a built ELI5 page and report evidence: errors, state, eval results, and true-width captures.
 *
 *  bun probe.ts <page.html> [--width 390] [--theme dark|light] [--set-n N] [--click "<css>"]…
 *               [--wait 400] [--eval "<js expression>"] [--smoke] [--shot out.png]
 *
 *  Why: headless Chromium never lays out narrower than 500px and freezes CSS transitions under
 *  --virtual-time-budget, so hand-rolled screenshots lie (a "390px" shot is 500px; an answered quiz
 *  looks faded mid-transition). This loads a copy of the page in an iframe of the exact width,
 *  disables transitions, hooks errors before any script runs, then applies steps in order.
 *
 *  --smoke   mount check + one pass through every interaction: each data-set-n, each quiz (answer 0),
 *            each flip row to success, theme toggle. Reports widgets that rendered nothing and
 *            [data-3d] canvases that drew no pixels, and accent-colored text above the dose cap (8).
 *  --eval    JS evaluated in the page after the steps (use `document`, `ELI5`); result printed as JSON.
 *  --shot    full-page PNG at the given width (plus <out>-N.png tiles of 1100px for reading).
 *  Exit 1 when the page threw, or --smoke found an empty widget. */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { argv, exit } from "node:process";

const file = argv[2];
if (!file || file.startsWith("--")) {
	console.error("usage: bun probe.ts <page.html> [--width 390] [--theme dark|light] [--set-n N] [--click css]… [--wait ms] [--eval js] [--smoke] [--shot out.png]");
	exit(2);
}
const flag = (n: string) => argv.includes(n);
const opt = (n: string, d = "") => { const i = argv.indexOf(n); return i > 0 && argv[i + 1] ? argv[i + 1]! : d; };
const all = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]!] : []));
const width = Number(opt("--width", "1280"));
const theme = opt("--theme");
const steps = [
	...(theme ? [{ theme }] : []),
	...all("--set-n").map((n) => ({ setN: Number(n) })),
	...all("--click").map((sel) => ({ click: sel })),
];
const dir = mkdtempSync(join(tmpdir(), "eli5-probe-"));

// page copy: error hook first, transitions off (virtual time freezes them), no stored theme
const hook = `<script>window.__eli5Errors=[];addEventListener("error",e=>__eli5Errors.push(String(e.message)));addEventListener("unhandledrejection",e=>__eli5Errors.push(String(e.reason)));try{localStorage.removeItem("eli5-theme")}catch(_){}</script><style>*,*::before,*::after{transition:none!important;animation:none!important}</style>`;
const page = readFileSync(resolve(file), "utf8").replace(/<head>/i, (m) => m + hook);
writeFileSync(join(dir, "page.html"), page);

const driver = String(async function drive(w: any, steps: any[], smoke: boolean, evalSrc: string, waitMs: number) {
	const d = w.document, out: any = { errors: [], empty: [], eval: null, height: 0 };
	const wait = (ms: number) => new Promise((r) => w.setTimeout(r, ms));
	for (const s of steps) {
		if (s.theme) d.documentElement.dataset.theme = s.theme;
		if (s.setN != null) w.ELI5.store.set(s.setN);
		if (s.click) { const el = d.querySelector(s.click); if (el) el.click(); else out.errors.push("probe: no element for --click " + s.click); }
		await wait(120);
	}
	if (waitMs) await wait(waitMs);
	if (smoke) {
		for (const el of d.querySelectorAll("[data-w]")) if (!el.childNodes.length && !el.textContent.trim()) out.empty.push(el.dataset.w + (el.closest("[id]") ? " in #" + el.closest("[id]").id : ""));
		for (const b of d.querySelectorAll("[data-set-n]")) { b.click(); await wait(30); }
		for (const q of d.querySelectorAll('[data-w="quiz"]')) { const b = q.querySelector("button"); if (b) b.click(); }
		for (const f of d.querySelectorAll('[data-w="flip"]')) for (const row of f.querySelectorAll(".grid")) row.children[1]?.click();
		const t = d.querySelector("[data-theme-toggle]"); if (t) { t.click(); await wait(60); t.click(); }
		// 3D stages must actually draw: count non-transparent pixels of each canvas (WebGL keeps its buffer)
		for (const c of d.querySelectorAll("[data-3d] canvas")) {
			const t2 = d.createElement("canvas"); t2.width = c.width; t2.height = c.height;
			const x = t2.getContext("2d"); x.drawImage(c, 0, 0);
			const px = x.getImageData(0, 0, t2.width, t2.height).data; let k = 0;
			for (let i = 3; i < px.length; i += 16) if (px[i] > 0) k++;
			if (k < 50) out.empty.push("3d canvas drew nothing (" + c.width + "x" + c.height + ")");
		}
		// accent dose (anti-slop): the accent belongs to what the reader controls, not to running text
		const probeEl = d.createElement("i"); probeEl.style.color = w.getComputedStyle(d.documentElement).getPropertyValue("--accent").trim(); d.body.append(probeEl);
		const accent = w.getComputedStyle(probeEl).color; probeEl.remove();
		let accentText = 0;
		for (const el of d.querySelectorAll("main *")) if ([...el.childNodes].some((n: any) => n.nodeType === 3 && n.nodeValue.trim()) && w.getComputedStyle(el).color === accent) accentText++;
		out.accentText = accentText;
		if (accentText > 8) out.empty.push(`accent on ${accentText} text elements (cap 8): keep it for the control and the one symbol it moves`);
		for (const s3 of d.querySelectorAll("[data-3d]")) if (!s3.querySelector("canvas") && !/WebGL|3D/.test(s3.textContent)) out.empty.push("3d stage without canvas or fallback");
		await wait(200);
	}
	await wait(200);
	if (evalSrc) { try { out.eval = (0, w.eval)(evalSrc); } catch (e: any) { out.errors.push("eval: " + e.message); } }
	out.errors.push(...(w.__eli5Errors || []));
	out.height = d.documentElement.scrollHeight;
	return out;
});

const wrap = (h: number, report: boolean) => `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#000}</style><body>
<iframe id="f" src="page.html" style="display:block;width:${width}px;height:${h}px;border:0"></iframe>
<script>const drive=${driver};
addEventListener("load",()=>setTimeout(async()=>{const r=await drive(document.getElementById("f").contentWindow,${JSON.stringify(steps)},${flag("--smoke")},${JSON.stringify(opt("--eval"))},${Number(opt("--wait", "0"))});
${report ? 'const p=document.createElement("pre");p.id="r";p.textContent="RESULT"+JSON.stringify(r);document.body.append(p);' : ""}},1200));</script></body>`;
const chrome = (args: string[]) => Bun.spawnSync(["chromium", "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--virtual-time-budget=15000", ...args], { stderr: "ignore" });

writeFileSync(join(dir, "report.html"), wrap(900, true));
const dom = chrome(["--window-size=" + Math.max(width, 500) + ",900", "--dump-dom", "file://" + join(dir, "report.html")]).stdout.toString();
const m = dom.match(/RESULT(\{.*?\})<\/pre>/s);
if (!m) {
	console.error("fail: probe got no result (chromium missing, or the page never loaded)");
	exit(1);
}
const res = JSON.parse(m[1]!.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));

const shot = opt("--shot");
if (shot) {
	const h = Math.min(Number(res.height) || 4000, 16000);
	writeFileSync(join(dir, "shot.html"), wrap(h, false));
	chrome(["--window-size=" + Math.max(width, 500) + "," + h, "--screenshot=" + resolve(shot), "file://" + join(dir, "shot.html")]);
	// crop to the iframe width and slice into readable tiles
	const py = `import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert("RGB").crop((0,0,${width},${h}))\nim.save(sys.argv[1])\nfor i,t in enumerate(range(0,${h},1100)):\n  im.crop((0,t,${width},min(${h},t+1100))).save(sys.argv[1][:-4]+f"-{i}.png")`;
	Bun.spawnSync(["python3", "-c", py, resolve(shot)]);
	res.shot = resolve(shot);
}
console.log(JSON.stringify(res, null, 1));
if (res.errors.length || res.empty.length) exit(1);
