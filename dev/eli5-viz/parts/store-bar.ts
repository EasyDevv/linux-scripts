/** Store bar part: the one blurred sticky surface holding the shared-number slider + preset chips. */
import { escAttr } from "./tokens.ts";
import type { PageSpec } from "./spec.ts";

export function storeBar(spec: PageSpec): string {
	const bar = spec.storeBar;
	if (!bar) return "";
	const wide = bar.wide ? " data-presets-wide" : "";
	const presets = bar.presets ? ` data-presets="${escAttr(bar.presets)}"` : "";
	return `      <div id="nbar" class="ui-bar sticky top-0 z-20 -mx-4 px-4 py-3 sm:-mx-6 sm:px-6">
        <div data-w="slider"${presets}${wide}></div>
      </div>
`;
}
