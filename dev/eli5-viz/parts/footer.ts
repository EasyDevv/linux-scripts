/** Footer part: the path back to the source, and that the page is a map, not the spec. */
import type { PageSpec } from "./spec.ts";

export function footer(spec: PageSpec): string {
	const f = spec.footer;
	if (!f) return "";
	return `      <footer class="space-y-1 border-t ui-line pt-6 text-sm ui-ink-3">
        <p>${f.source}</p>
        <p>${f.note}</p>
      </footer>
`;
}
