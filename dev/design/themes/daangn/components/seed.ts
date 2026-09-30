/** Shared helpers for the SEED snippets in this folder. Copy this file with any snippet.
 *
 *  - `variants({ size: "medium", layout: "withText" })` → `{ "data-size": "medium", "data-layout": "withText" }`.
 *    SEED recipes key variants on classes (`seed-chip--size_medium`); the snippets carry the same
 *    variant as a data attribute on every slot, and `.build/recipes.ts` rewrote the selectors to match.
 *  - `states({ checked, disabled })` → `{ "data-checked": "", "data-disabled": "" }` for the true ones,
 *    the same presence attributes SEED's headless hooks put on each slot.
 *  - `scaleFeedback` is the `useScaleFeedback` hook: it writes the element's unitless height/width
 *    into `--seed-element-height` / `--seed-element-width`, which `.seed-scale-feedback` turns into
 *    the pressed scale (h - 2) / h. Attach it with `{@attach scaleFeedback}`.
 */
import type { Attachment } from "svelte/attachments";

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function variants(v: Record<string, string | number | boolean | undefined | null>) {
	const out: Record<string, string> = {};
	for (const [k, value] of Object.entries(v)) if (value !== undefined && value !== null && value !== false) out[`data-${kebab(k)}`] = String(value);
	return out;
}

export function states(s: Record<string, boolean | undefined>) {
	const out: Record<string, string> = {};
	for (const [k, on] of Object.entries(s)) if (on) out[`data-${kebab(k)}`] = "";
	return out;
}

export const scaleFeedback: Attachment<HTMLElement> = (node) => {
	const ro = new ResizeObserver(([entry]) => {
		const box = entry.borderBoxSize?.[0];
		node.style.setProperty("--seed-element-height", String(Math.round(box?.blockSize ?? node.offsetHeight)));
		node.style.setProperty("--seed-element-width", String(Math.round(box?.inlineSize ?? node.offsetWidth)));
	});
	ro.observe(node);
	return () => ro.disconnect();
};

/** SEED's visuallyHidden: keeps a native input focusable and announced while the slots paint the control. */
export const visuallyHidden =
	"border: 0; clip: rect(0 0 0 0); height: 1px; margin: -1px; overflow: hidden; padding: 0; position: absolute; width: 1px; white-space: nowrap; word-wrap: normal";

/** Glyphs for the selection marks. SEED draws these with Karrot's icon set (IconCheckmarkFatFill,
 *  IconMinusFatFill, IconExclamationmarkCircleFill), which this theme does not copy. `check` / `minus`
 *  are 24x24 centre lines stroked at 3.6 (round caps) to match the fat fill's weight;
 *  `alert` / `required` are filled shapes. */
export const glyph = {
	check: "M3.6 12.7l5.6 5.6L20.4 6.5",
	minus: "M4.6 12h14.8",
	alert: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 13.4a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm0-8.6a1.1 1.1 0 0 0-1.1 1.1v5.2a1.1 1.1 0 1 0 2.2 0V7.9A1.1 1.1 0 0 0 12 6.8Z",
	required:
		"M3.75002 1.55859L4.41318 1.09468C4.75243 0.857361 5.21982 0.939865 5.45732 1.27899C5.69499 1.61836 5.61243 2.08615 5.27295 2.32366L4.30763 2.99902L5.27372 3.67612C5.61285 3.91381 5.69517 4.38137 5.45761 4.72059C5.21999 5.0599 4.7523 5.14233 4.41299 4.90471L3.75002 4.44043V5.25C3.75002 5.66421 3.41423 6 3.00002 6C2.5858 6 2.25002 5.66421 2.25002 5.25V4.44043L1.58704 4.90471C1.24773 5.14233 0.780041 5.0599 0.542418 4.72059C0.304856 4.38137 0.387176 3.91381 0.726309 3.67612L1.6924 2.99902L0.727079 2.32366C0.387603 2.08615 0.305043 1.61836 0.542707 1.27899C0.780206 0.939865 1.2476 0.857361 1.58685 1.09468L2.25002 1.55859V0.75C2.25002 0.335786 2.5858 0 3.00002 0C3.41423 0 3.75002 0.335786 3.75002 0.75V1.55859Z",
};

let uid = 0;
/** Stable-per-instance id for label/description wiring (SSR-safe enough for snippets). */
export const nextId = (prefix: string) => `${prefix}-${++uid}`;

/** SEED's collapsible content: publishes the content's natural height as --collapsible-content-height
 *  so `[data-collapsible]` rules can animate height 0 ↔ that value. */
export const collapsibleHeight: Attachment<HTMLElement> = (node) => {
	const inner = node.firstElementChild as HTMLElement | null;
	if (!inner) return;
	const ro = new ResizeObserver(() => node.style.setProperty("--collapsible-content-height", `${inner.scrollHeight}px`));
	ro.observe(inner);
	return () => ro.disconnect();
};
