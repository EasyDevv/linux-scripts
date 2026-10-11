/** Hero part: the one stage that answers the page's question. Tabs, blocks, or a custom body. */
import type { PageSpec } from "./spec.ts";
import { blockInner } from "./blocks.ts";

export function hero(spec: PageSpec, bodies: Record<string, string>): string {
	const h = spec.hero;
	const icon = h.icon ? `<i data-ic="${h.icon}" class="h-4 w-4 ui-ink-3"></i>` : "";
	const mt = spec.storeBar ? " -mt-6" : "";
	const body = h.body
		? (bodies[h.body] ?? missing(h.body))
		: h.tabs
			? blockInner(spec, { w: "tabs", start: h.tabs.start, items: h.tabs.items })
			: (h.blocks ?? []).map((b) => blockInner(spec, b)).join("\n        ");
	const title = h.question ? `<h3 class="mb-3 flex items-center gap-2 text-sm font-medium">${icon}${h.question}</h3>\n        ` : "";
	return `      <section id="hero" class="ui-card${mt} p-4 sm:p-6">
        ${title}${body}
      </section>
`;
}

const missing = (id: string): never => {
	throw new Error(`spec: body "${id}" has no <template data-body="${id}"> in the source`);
};
