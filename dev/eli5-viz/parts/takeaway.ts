/** Takeaway part: the epilogue, the chapter chain (derived from chapters), and the one-page
 *  summary (derived from the cast). Nothing here is re-typed by hand. */
import { escAttr, TONE_ICON } from "./tokens.ts";
import type { PageSpec } from "./spec.ts";
import { chapterKey } from "./spec.ts";
import { recapLabel } from "./chapter.ts";

export function takeaway(spec: PageSpec): string {
	const t = spec.takeaway;
	if (!t) return "";
	const recap = spec.chapters
		.map(
			(c, i) =>
				`<li><a href="#${chapterKey(i)}" class="ui-recap"><span class="font-mono text-xs ui-ink-3">${i + 1}</span><span>${recapLabel(c)}</span></a></li>`,
		)
		.join("");
	const members = spec.cast?.members ?? [];
	const summary = members
		.map((m) => {
			const reading = m.reading ?? m.story;
			return `<div class="flex items-center gap-3 border-t ui-line py-2.5 k-${m.id}"><dt class="flex w-[6.5rem] flex-none items-center gap-2 font-mono text-sm k-ink"><i data-ic="${m.icon}" class="h-4 w-4"></i>${m.short ?? m.term}</dt><dd class="flex flex-1 items-center justify-between gap-2 text-sm"><span>${m.label} <span class="ui-ink-3">· ${reading}</span></span><span class="tone-ink" style="--tone:var(--${m.tone})"><i data-ic="${TONE_ICON[m.tone]}" class="h-4 w-4" aria-label="${escAttr(spec.ui.tone[m.tone])}"></i></span></dd></div>`;
		})
		.join("");
	return `      <section id="takeaway" class="ui-card p-6 sm:p-8">
        <p class="ui-scene">${t.scene}</p>
        <h2 class="mt-6 text-[1.75rem] leading-snug sm:text-[1.9rem]">${t.claim}</h2>${t.prose ? `\n        <p class="ui-prose mt-3">${t.prose}</p>` : ""}${t.recapTitle ? `\n        <h3 class="mt-8 text-sm font-medium ui-ink-2">${t.recapTitle}</h3>` : ""}
        <ol class="ui-recap-list mt-3">${recap}</ol>${t.summaryTitle ? `\n        <h3 class="mt-8 text-sm font-medium ui-ink-2">${t.summaryTitle}</h3>` : ""}${summary ? `\n        <dl class="mt-3 grid gap-x-6 sm:grid-cols-2">${summary}</dl>` : ""}
      </section>
`;
}
