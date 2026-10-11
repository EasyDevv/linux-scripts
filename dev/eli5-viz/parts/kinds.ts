/** Kind colors: one k-<id> class per cast entity, reusing its tone color.
 *  Generated from the spec, so a page never hand-writes a color block. */
import { kindColors, type PageSpec } from "./spec.ts";

export function kindCss(spec: PageSpec): string {
	const kinds = kindColors(spec);
	if (!kinds.length) return "";
	const vars = kinds.map((k) => `--c-${k.id}: var(--${k.tone});`).join(" ");
	const classes = kinds.map((k) => `.k-${k.id} { --k: var(--c-${k.id}); }`).join(" ");
	return `<style data-eli5-kinds>
      [data-theme] { ${vars} }
      ${classes}
    </style>`;
}
