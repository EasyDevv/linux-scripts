/** Cast part: the parallel cases the reader compares, plus the tone legend.
 *  One k-<id> kind color per member (see kinds.ts), tone marks carry shape + word. */
import { escAttr, TONE_ICON } from "./tokens.ts";
import type { PageSpec } from "./spec.ts";

const toneMark = (tone: "pass" | "go" | "stop", spec: PageSpec) => {
	const word = spec.ui.tone[tone];
	const help = spec.ui.toneHelp?.[tone];
	return `<span class="tone-ink" title="${escAttr(help || word)}"><i data-ic="${TONE_ICON[tone]}" class="h-4 w-4" aria-label="${escAttr(word)}"></i></span>`;
};

const legendItems = (spec: PageSpec) => {
	const legend =
		spec.cast?.legend ??
		(["pass", "go", "stop"] as const).map((tone) => ({
			tone,
			text: spec.ui.toneHelp?.[tone] ?? spec.ui.tone[tone],
		}));
	return legend
		.map(
			(l) =>
				`<li class="flex items-center gap-1.5"><span class="tone-ink" style="--tone:var(--${l.tone})"><i data-ic="${TONE_ICON[l.tone]}" class="h-3.5 w-3.5"></i></span>${l.text}</li>`,
		)
		.join("");
};

export function cast(spec: PageSpec): string {
	const c = spec.cast;
	if (!c) return "";
	const cards = c.members
		.map(
			(m) => `<div class="ui-card k-${m.id} p-4" style="--tone:var(--${m.tone})">
            <div class="flex items-center justify-between"><span class="k-ink"><i data-ic="${m.icon}" class="h-7 w-7"></i></span>${toneMark(m.tone, spec)}</div>
            <p class="mt-3 font-medium">${m.label}</p>
            <p class="whitespace-nowrap font-mono text-sm k-ink">${m.term}</p>
            <p class="mt-1.5 text-sm leading-snug ui-ink-2">${m.story}</p>
            <p class="mt-3 border-t ui-line pt-2 text-xs tabular-nums ui-ink-3">${m.stat}</p>
          </div>`,
		)
		.join("\n          ");
	return `      <section id="cast" aria-labelledby="cast-h">
        <h2 id="cast-h" class="text-[1.5rem] leading-snug">${c.title}</h2>${c.lead ? `\n        <p class="mt-2 text-[15px] leading-relaxed ui-ink-2">${c.lead}</p>` : ""}
        <div class="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          ${cards}
        </div>
        <ul class="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs ui-ink-3">${legendItems(spec)}</ul>
      </section>
`;
}
