/** Block parts: the small data-driven relations a chapter or hero stage is built from.
 *  Each block is a core widget hook plus its class shell; all content comes from the page spec. */
import { escAttr } from "./tokens.ts";
import type { BlockSpec, PageSpec } from "./spec.ts";

const tabHtml = (items: { id: string; label: string; icon?: string; panel: string }[], start?: string) =>
	`<div data-w="tabs"${start ? ` data-start="${escAttr(start)}"` : ""}>
          <div class="flex flex-wrap gap-2" role="tablist">${items
		.map(
			(t) =>
				`<button type="button" data-tab="${escAttr(t.id)}" class="ui-chip inline-flex items-center gap-1.5">${t.icon ? `<i data-ic="${t.icon}" class="h-3.5 w-3.5"></i>` : ""}${t.label}</button>`,
		)
		.join("")}</div>${items
		.map(
			(t) =>
				`<div data-panel="${escAttr(t.id)}" class="ui-inset mt-3 p-4 text-sm leading-relaxed">${t.panel}</div>`,
		)
		.join("")}
        </div>`;

/** The bare widget markup for one block (no chapter/stage wrapper). */
export function blockInner(spec: PageSpec, b: BlockSpec): string {
	switch (b.w) {
		case "flip":
			return `<div data-w="flip"></div>`;
		case "facts":
			return `<dl data-w="facts"></dl>`;
		case "numinput":
			return `<div data-w="numinput"></div>`;
		case "cards":
			return `<div data-w="cards"></div>`;
		case "flow":
			return `<div data-w="flow" data-steps="${escAttr(b.steps)}"${b.result ? ` data-result="${escAttr(b.result)}"` : ""}></div>`;
		case "bars":
			return `<div data-w="bars" data-ids="${b.ids.map(escAttr).join(",")}"${b.log ? " data-log" : ""}${b.note ? ` data-note="${escAttr(b.note)}"` : ""}></div>`;
		case "tabs":
			return tabHtml(b.items, b.start);
	}
}

/** Chapter body. wrap: "auto" (default) gives one block a ui-card and several a shared
 *  ui-stage; "stage" forces the stage; "none" renders the blocks bare (they carry their own cards). */
export function blocksBody(spec: PageSpec, blocks: BlockSpec[] | undefined, wrap?: "stage" | "none"): string {
	if (!blocks?.length) return "";
	const inner = blocks.map((b) => blockInner(spec, b));
	if (wrap === "none") return inner.join("\n          ") + "\n";
	if (wrap !== "stage" && inner.length === 1) return `          <div class="ui-card mt-4 p-4">${inner[0]}</div>\n`;
	const parts = inner.map((x, i) => `<div${i ? ` class="border-t ui-line pt-4"` : ""}>${x}</div>`);
	return `          <div class="ui-stage mt-4 space-y-5 p-3 sm:p-4">${parts.join("")}</div>\n`;
}
