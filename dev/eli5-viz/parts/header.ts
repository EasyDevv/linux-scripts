/** Header part: eyebrow row + theme toggle, the story title, the lead, the prologue scene. */
import { escAttr, checkCopy } from "./tokens.ts";
import type { PageSpec } from "./spec.ts";

export function header(spec: PageSpec): string {
	const { meta, ui } = spec;
	const eyebrow = checkCopy("meta.eyebrow", meta.eyebrow);
	const h1 = checkCopy("meta.h1", meta.h1);
	return `<header>
        <div class="flex items-center justify-between gap-4">
          <p class="ui-eyebrow">${eyebrow}</p>
          <button type="button" data-theme-toggle class="ui-ctl ui-ink-2" aria-label="${escAttr(ui.themeToggle)}"><i data-ic="sun" class="h-4 w-4 show-dark"></i><i data-ic="moon" class="h-4 w-4 show-light"></i></button>
        </div>
        <h1 id="title" class="mt-4 text-[2rem] leading-[1.25] sm:text-[2.6rem]">${h1}</h1>
        <p class="ui-prose mt-4">${meta.prose}</p>
        <p class="ui-scene mt-4">${meta.scene}</p>
      </header>`;
}
