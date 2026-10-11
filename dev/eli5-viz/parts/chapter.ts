/** Chapter part: one step = one card. The controls carry the words (say line, self-check);
 *  the card holds only the scene, the stage, and the bridge to the next chapter. */
import { escAttr, TONE_ICON } from "./tokens.ts";
import type { ChapterSpec, PageSpec } from "./spec.ts";
import { chapterKey, nextTarget } from "./spec.ts";
import { blocksBody } from "./blocks.ts";

/** Default recap label: the title without its leading "1장 · " chapter-number prefix
 *  (the recap chip already carries the number). Override per chapter with `recap`. */
export const recapLabel = (ch: ChapterSpec) => ch.recap ?? ch.title.replace(/^\s*\d+\s*[^\s·]*\s*·\s*/, "");

export function chapter(spec: PageSpec, ch: ChapterSpec, i: number, bodies: Record<string, string>): string {
	const key = chapterKey(i);
	const term = ch.term ? `<p class="text-xs ui-ink-3"><span class="font-mono">${ch.term}</span></p>` : "";
	const body = ch.body ? (bodies[ch.body] ?? missing(ch.body)) : blocksBody(spec, ch.blocks, ch.wrap);
	const gains = ch.gains ? `\n            <p class="text-xs leading-relaxed ui-ink-3">${ch.gains}</p>` : "";
	const target = nextTarget(spec, i);
	const bridge = target && ch.bridge
		? `\n            <a class="ui-next" href="${target}"><i data-ic="corner-down-right" class="h-4 w-4"></i><span>${ch.bridge}</span></a>`
		: "";
	return `        <article id="${key}" class="ui-chapter scroll-mt-28 p-4 sm:p-6">
          <div class="ui-chapter-head">
            <span class="ui-step-ic"><i data-ic="${ch.icon}" class="h-6 w-6"></i></span>
            <div class="min-w-0">
              ${term}
              <h2 class="mt-0.5 text-[1.4rem] leading-snug sm:text-[1.6rem]">${ch.title}</h2>
            </div>
          </div>
          <p class="ui-scene mt-4">${ch.scene}</p>
${body}          <p class="mt-4" data-w="say" data-say="${key}"></p>
          <div class="ui-quiz mt-4 p-4 sm:p-5" data-w="quiz" data-q="${key}"></div>
          <div class="ui-chapter-foot mt-5 pt-4">${gains}${bridge}
          </div>
        </article>`;
}

const missing = (id: string): never => {
	throw new Error(`spec: body "${id}" has no <template data-body="${id}"> in the source`);
};

export const stepsSection = (spec: PageSpec, bodies: Record<string, string>): string =>
	`      <section id="steps" class="pt-4">
${spec.chapters.map((c, i) => chapter(spec, c, i, bodies)).join("\n")}
      </section>
`;
