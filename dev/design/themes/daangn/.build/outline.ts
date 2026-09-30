export {};
// Print the live DOM outline of seed-design.io previews: tag, seed-* classes, data-* / aria / role,
// leaf text. Used to write each snippet's markup with the same slots and attributes.
//
//   bun themes/daangn/.build/outline.ts <page> [previewIndex|all] [--port 9222] [--depth 12]
const [page, which = "0"] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const arg = (n: string) => {
	const i = process.argv.indexOf(n);
	return i > 0 ? process.argv[i + 1] : undefined;
};
const port = Number(arg("--port") ?? 9222);
const maxDepth = Number(arg("--depth") ?? 12);
const url = page === "app-screen" ? "https://seed-design.io/react/stackflow/app-screen" : `https://seed-design.io/react/components/${page}`;

function outline(which: string, maxDepth: number) {
	const panels = [...document.querySelectorAll("article .seed-chip-tabs__content")].filter(
		(p) => p.querySelector(".not-prose") && !p.querySelector("pre"),
	);
	const headings = [...document.querySelectorAll("article h2, article h3")];
	const keep = (a: Attr) => a.name.startsWith("data-") || a.name.startsWith("aria-") || ["role", "type", "for", "tabindex", "hidden", "disabled", "placeholder", "value", "name", "src", "width", "height", "viewBox"].includes(a.name);
	const line = (el: Element, depth: number): string[] => {
		if (depth > maxDepth) return [];
		const cls = [...el.classList].filter((c) => c.startsWith("seed-")).join(" ");
		const attrs = [...el.attributes].filter(keep).filter((a) => !/^data-(ownedby|scope|part)$/.test(a.name) && !a.value.startsWith("_R_") && !a.value.includes(":_R_")).map((a) => (a.value === "" ? a.name : `${a.name}="${a.value.slice(0, 40)}"`)).join(" ");
		const text = el.children.length === 0 ? (el.textContent || "").trim().slice(0, 30) : "";
		const tag = el.tagName.toLowerCase();
		const head = `${"  ".repeat(depth)}<${tag}${cls ? ` .${cls.replace(/ /g, ".")}` : ""}${attrs ? ` ${attrs}` : ""}>${text ? ` "${text}"` : ""}`;
		if (tag === "svg" || tag === "path") return [head];
		return [head, ...[...el.children].flatMap((c) => line(c, depth + 1))];
	};
	const pick = which === "all" ? panels.map((_, i) => i) : which.split(",").map(Number);
	return pick
		.map((i) => {
			const panel = panels[i];
			if (!panel) return `#${i}: none`;
			let heading = "";
			for (const h of headings) if (h.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING) heading = h.textContent?.trim() ?? "";
			const stage = panel.querySelector(".not-prose") as Element;
			return [`# ${i} ${heading}`, ...[...stage.children].flatMap((c) => line(c, 0))].join("\n");
		})
		.join("\n\n");
}

const tab = (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" }).then((r) => r.json())) as {
	id: string;
	webSocketDebuggerUrl: string;
};
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok) => (ws.onopen = ok));
await Bun.sleep(4000);
const result = await new Promise<{ result: { result: { value: string } } }>((ok) => {
	ws.onmessage = (e) => ok(JSON.parse(String(e.data)));
	ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: `(${outline.toString()})(${JSON.stringify(which)}, ${maxDepth})`, returnByValue: true } }));
});
console.log(result.result.result.value);
ws.close();
await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
