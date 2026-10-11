#!/usr/bin/env bun
/** Layout gate for an ELI5 page: drive every state to its extremes and report anything that leaves its box.
 *  usage: bun check-layout.ts <page.html> [--widths 390,1280]
 *  States: each [data-set-n] button, ELI5.store min/max, every preset chip, both themes, plus a
 *  49-step drag sweep that fails if any range moves/resizes, the sticky bar or the page changes height,
 *  svg label collisions, and a round trip back to the first state that must reproduce the same text.
 *  A finding = an element whose right/left edge leaves its nearest card (.ui-card/.ui-inset/.ui-r2/article),
 *  or a page that scrolls sideways. Needs chromium on PATH. Exit 1 on any finding. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { argv, exit } from "node:process";

const file = argv[2];
if (!file) {
	console.error("usage: bun check-layout.ts <page.html> [--widths 390,1280]");
	exit(2);
}
const wi = argv.indexOf("--widths");
const widths = (wi > 0 ? argv[wi + 1] : "390,1280")!.split(",").map(Number);
const url = "file://" + resolve(file);

// runs inside each iframe; returns findings as strings
const probe = String(function probe(win: any) {
	const doc = win.document;
	const out: string[] = [];
	const BOX = ".ui-card,.ui-inset,.ui-r2,.ui-quiz,article,section,header,footer";
	const name = (el: any) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "");
	const scan = (state: string) => {
		if (doc.documentElement.scrollWidth > win.innerWidth + 1) out.push(`${state}: page scrolls sideways (${doc.documentElement.scrollWidth} > ${win.innerWidth})`);
		for (const el of doc.querySelectorAll("main *")) {
			if (!el.getClientRects().length || el.closest("[hidden]")) continue;
			// scroll containers may be wider inside; that is their job
			if (el.closest(".overflow-x-auto") && !el.classList.contains("overflow-x-auto")) continue;
			const box = el.parentElement?.closest(BOX);
			if (!box) continue;
			const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
			if (r.width === 0) continue;
			if (r.right > b.right + 1 || r.left < b.left - 1) out.push(`${state}: ${name(el)} leaves ${name(box)} by ${Math.round(Math.max(r.right - b.right, b.left - r.left))}px`);
			// a child spilling out of its own parent (a number wider than its grid cell), ignoring svg internals
			const par = el.parentElement;
			if (par && !(el instanceof win.SVGElement && el.tagName.toLowerCase() !== "svg")) {
				const p = par.getBoundingClientRect();
				const spill = Math.max(r.right - p.right, p.left - r.left);
				if (spill > 2 && getComputedStyle(par).overflowX === "visible") out.push(`${state}: ${name(el)} spills out of ${name(par)} by ${Math.round(spill)}px`);
			}
			// text clipped inside its own box
			if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible" && !el.title) out.push(`${state}: ${name(el)} clips its text`);
			// siblings in one flex/grid row must not sit on top of each other (a long number over its bar)
			const d = getComputedStyle(el).display;
			if ((d.includes("flex") || d.includes("grid")) && el.children.length <= 8) {
				const kids = [...el.children].filter((k: any) => k.getClientRects().length).map((k: any) => [k, k.getBoundingClientRect()]);
				for (let i = 0; i < kids.length; i++)
					for (let j = i + 1; j < kids.length; j++) {
						const [a, ra] = kids[i] as any, [c, rc] = kids[j] as any;
						const x = Math.min(ra.right, rc.right) - Math.max(ra.left, rc.left);
						const y = Math.min(ra.bottom, rc.bottom) - Math.max(ra.top, rc.top);
						if (x > 2 && y > 2) out.push(`${state}: ${name(a)} overlaps ${name(c)} by ${Math.round(x)}px`);
					}
			}
		}
	};
	// SVG labels are skipped by the box checks above; check text-on-text collisions inside each svg
	const svgText = (state: string) => {
		for (const svg of doc.querySelectorAll("main svg")) {
			const ts = [...svg.querySelectorAll("text")].map((t: any) => [t, t.getBoundingClientRect()]).filter(([, r]: any) => r.width > 0);
			for (let i = 0; i < ts.length; i++)
				for (let j = i + 1; j < ts.length; j++) {
					const [a, ra] = ts[i] as any, [c, rc] = ts[j] as any;
					const x = Math.min(ra.right, rc.right) - Math.max(ra.left, rc.left), y = Math.min(ra.bottom, rc.bottom) - Math.max(ra.top, rc.top);
					if (x > 1 && y > 1) out.push(`${state}: svg labels collide: "${a.textContent}" × "${c.textContent}"`);
				}
		}
	};
	const E = win.ELI5;
	const states: [string, () => void][] = [["initial", () => {}]];
	if (E?.store) {
		states.push(["n=min", () => E.store.set(1)], ["n=max", () => E.store.set(E.MAX_N ?? 1e9)]);
		doc.querySelectorAll("[data-set-n]").forEach((b: any) => states.push([`set-n ${b.dataset.setN}`, () => b.click()]));
	}
	return (async () => {
		const n0 = E?.store ? E.store.n : null, theme0 = doc.documentElement.dataset.theme;
		for (const theme of ["dark", "light"]) {
			for (const [label, run] of states) {
				doc.documentElement.dataset.theme = theme;
				run();
				await new Promise((r) => win.setTimeout(r, 120));
				scan(`${theme} ${label}`);
				svgText(`${theme} ${label}`);
			}
		}
		// drag stability: sweep the shared number like a dragging thumb. Nothing may move or resize:
		// a range that shifts under the pointer flickers at every label boundary, and a page that
		// changes height jumps the content the reader is looking at.
		if (E?.store) {
			doc.documentElement.dataset.theme = "dark";
			const ranges = [...doc.querySelectorAll('input[type="range"]')];
			const bar = doc.getElementById("nbar");
			const snap = () => {
				const r = ranges.map((x: any) => { const b = x.getBoundingClientRect(); return `${Math.round(b.left)}/${Math.round(b.width)}`; });
				return { ranges: r.join(" "), bar: bar ? Math.round(bar.getBoundingClientRect().height) : 0, page: doc.documentElement.scrollHeight };
			};
			// round trip baseline: the sweep below moves only the shared number (buttons may also carry
			// widget state, e.g. which method a 3D room runs), so text must come back exactly at n0
			doc.documentElement.dataset.theme = theme0;
			E.store.set(n0);
			await new Promise((r) => win.setTimeout(r, 150));
			var text0 = (doc.querySelector("main") || doc.body).innerText;
			doc.documentElement.dataset.theme = "dark";
			E.store.set(E.store.min);
			await new Promise((r) => win.setTimeout(r, 120));
			const base = snap();
			const lo = Math.log10(Math.max(1, E.store.min)), hi = Math.log10(E.store.max);
			for (let i = 0; i <= 48; i++) {
				const n = Math.round(Math.pow(10, lo + ((hi - lo) * i) / 48));
				E.store.set(n);
				await new Promise((r) => win.setTimeout(r, 40));
				const now = snap();
				if (now.ranges !== base.ranges) { out.push(`drag n=${n}: a slider moved or resized (${base.ranges} → ${now.ranges})`); break; }
				if (now.bar !== base.bar) { out.push(`drag n=${n}: sticky bar height ${base.bar} → ${now.bar}px`); break; }
				if (Math.abs(now.page - base.page) > 1) { out.push(`drag n=${n}: page height ${base.page} → ${now.page}px (layout shift)`); break; }
			}
		}
		if (n0 != null) {
			doc.documentElement.dataset.theme = theme0;
			E.store.set(n0);
			await new Promise((r) => win.setTimeout(r, 150));
			const text1 = (doc.querySelector("main") || doc.body).innerText;
			if (text1 !== text0) {
				let i = 0;
				while (i < text0.length && text0[i] === text1[i]) i++;
				out.push(`round trip: text differs after returning to n=${n0} (near "${text1.slice(Math.max(0, i - 20), i + 40).replace(/\s+/g, " ")}")`);
			}
		}
		return [...new Set(out)];
	})();
});

const dir = mkdtempSync(join(tmpdir(), "eli5-layout-"));
const frames = widths.map((w, i) => `<iframe id="f${i}" src="${url}" style="width:${w}px;height:900px;border:0"></iframe>`).join("");
writeFileSync(
	join(dir, "wrap.html"),
	`<!doctype html><meta charset="utf-8"><body>${frames}<script>
const probe = ${probe};
window.addEventListener("load", () => setTimeout(async () => {
  const res = (await Promise.all(${JSON.stringify(widths)}.map(async (w, i) => { try { return (await probe(document.getElementById("f" + i).contentWindow)).map(s => w + "px " + s); } catch (e) { return [w + "px probe error: " + e.message]; } }))).flat();
  const pre = document.createElement("pre"); pre.id = "result"; pre.textContent = "RESULT" + JSON.stringify(res); document.body.append(pre);
}, 1500));
</script></body>`,
);
const run = Bun.spawnSync(["chromium", "--headless=new", "--no-sandbox", "--disable-gpu", "--allow-file-access-from-files", "--virtual-time-budget=20000", "--dump-dom", "file://" + join(dir, "wrap.html")], { stderr: "ignore" });
const m = run.stdout.toString().match(/RESULT(\[.*?\])<\/pre>/s);
if (!m) {
	console.error("fail: probe did not report (chromium missing or page error)");
	exit(1);
}
const found: string[] = JSON.parse(m[1]!.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
// round-trip findings first: they name a different bug class than overflow
found.sort((a, b) => Number(b.includes("round trip")) - Number(a.includes("round trip")));
for (const f of found.slice(0, 40)) console.error(`fail: ${f}`);
if (found.length > 40) console.error(`… ${found.length - 40} more`);
if (found.length) exit(1);
console.log(`ok layout ${file} (${widths.join(", ")}px · both themes · n extremes)`);
