/** Tokens shared by the build-time parts. core/runtime.js carries the same maps for the browser;
 *  keep the two in sync (the runtime owns tone words and icon names at mount time). */
export const TONES = ["pass", "go", "stop"] as const;
export type Tone = (typeof TONES)[number];

/** Tone = meaning, and each tone also has a shape: never color alone. */
export const TONE_ICON: Record<Tone, string> = {
	pass: "circle-check",
	go: "circle-arrow-right",
	stop: "octagon-x",
};

export const ICON_NAME = /^[a-z0-9-]+$/;

/** Spec strings are authored HTML fragments (prose, panels, scenes); attributes are not. */
export const escAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const isTone = (v: unknown): v is Tone => typeof v === "string" && (TONES as readonly string[]).includes(v);

/** A name must be a real Lucide icon: inline.ts fails the build on unknown names, so fail here with context. */
export const checkIcon = (where: string, v: unknown): string => {
	if (typeof v !== "string" || !ICON_NAME.test(v)) throw new Error(`spec: ${where}: icon "${String(v)}" is not a Lucide name ([a-z0-9-])`);
	return v;
};

/** Non-empty visible copy. Missing copy is a spec error, never a blank slot in the page. */
export const checkCopy = (where: string, v: unknown): string => {
	if (typeof v !== "string" || !v.trim()) throw new Error(`spec: ${where}: copy is empty`);
	return v;
};
