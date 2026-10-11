/** Shell part: assembles the whole document skeleton from a page spec — the shadcn-style
 *  composition point. Sections are the parts (header, cast, hero, chapters, takeaway, footer);
 *  custom stage content arrives through <template data-body> fragments keyed by name. */
import type { PageSpec } from "./spec.ts";
import { chapterKey } from "./spec.ts";
import { escAttr } from "./tokens.ts";
import { header } from "./header.ts";
import { storeBar } from "./store-bar.ts";
import { cast } from "./cast.ts";
import { hero } from "./hero.ts";
import { stepsSection } from "./chapter.ts";
import { takeaway } from "./takeaway.ts";
import { footer } from "./footer.ts";
import { kindCss } from "./kinds.ts";

const MERMAID_IMPORT = `<script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      window.mermaid = mermaid; window.dispatchEvent(new Event("mermaid-ready"));
    </script>`;

export interface Built {
	/** Extras for <head>: page kind colors and the Mermaid import when the page needs it. */
	head: string;
	/** The <main> skeleton. */
	main: string;
}

export function shell(spec: PageSpec, bodies: Record<string, string>): Built {
	const sections = [
		header(spec),
		spec.quiz?.predict ? predict(spec) : "",
		cast(spec),
		storeBar(spec),
		hero(spec, bodies),
		stepsSection(spec, bodies),
		takeaway(spec),
		footer(spec),
	].filter(Boolean);
	return {
		head: [kindCss(spec), spec.mermaid ? MERMAID_IMPORT : ""].filter(Boolean).join("\n    "),
		main: `    <main class="mx-auto max-w-[50rem] space-y-16 px-4 pb-24 pt-14 sm:px-6">\n${sections.map((s) => (s.endsWith("\n") ? s : s + "\n")).join("")}    </main>`,
	};
}

const predict = (spec: PageSpec) =>
	`      <section id="predict" class="ui-card p-4 sm:p-6" data-w="quiz" data-q="predict"${spec.predict?.title ? ` data-title="${escAttr(spec.predict.title)}"` : ""}></section>
`;

export { chapterKey };
