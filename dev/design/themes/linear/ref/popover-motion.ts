/**
 * Popover motion measured from the live app (linear.app, CDP 9201, 2026-09-14).
 *
 * The live popover's surface carries the animation inline
 * (`opacity: 2; transform: scale(1); transform-origin: 100% 0px` at rest) and is stepped per
 * frame from a spring, so the curve was sampled frame-by-frame instead of read off CSS:
 *
 *   enter (58ms)  φ: 0 → 0.1377 @13ms → 0.3149 @24.5ms → 0.432 @40.5ms → 1 @58ms
 *                 opacity = 2φ (the spring overshoots 1 so the fade reads fast; the resting
 *                 inline value 2 renders clamped to 1), scale = 0.98 + 0.02φ
 *   exit  (207ms) scale = 1 − 0.02ψ, ψ reaching 1 at 49ms and holding
 *                 opacity = exp decay, half-life ≈ 26ms (ratio 0.6369/frame at 60Hz), unmounted
 *                 once it passes ~1%
 *
 * Frames sampled per run (3 runs per direction, 60Hz, values repeat across runs):
 *   enter: 0/0.98 · 0.2753/0.982753 · 0.56–0.63/0.9856–0.98630 · 0.84–0.88/0.9884–0.98884 · 1/1
 *   exit : 1/1 · 1/0.996372 · 1/0.991618 · 0.764/0.98 · 0.4913/0.98 · 0.3132/0.98 · 0.199/0.98 …
 */

export type Sample = [number, number];

/** [ms, φ] of the enter spring. */
const enterPhi: Sample[] = [
	[0, 0],
	[13, 0.1377],
	[24.5, 0.3149],
	[40.5, 0.432],
	[58, 1],
];

/** [ms, ψ] of the exit scale (scale = 1 − 0.02ψ; holds after 49ms). */
const exitScalePsi: Sample[] = [
	[0, 0],
	[15, 0.1814],
	[32, 0.42],
	[49, 1],
];

/** [ms, opacity] of the exit fade (sampled while it decays). */
const exitOpacity: Sample[] = [
	[0, 1],
	[40, 1],
	[49, 0.764],
	[66, 0.4913],
	[83, 0.3132],
	[99, 0.199],
	[116, 0.1262],
	[133, 0.08],
	[149, 0.0507],
	[166, 0.0321],
	[183, 0.0204],
	[199, 0.0129],
	[207, 0],
];

export const popoverEnterDuration = 58;
export const popoverExitDuration = 207;
/** Measured scale endpoints and origin (`transform-origin: 100% 0px`). */
export const popoverScale = 0.98;
export const popoverOrigin = "100% 0";
/** The live surface rests at opacity 2 (clamped to 1 when painted). */
export const popoverOpacity = 2;
/** `linear()` easing traced from the sampled enter spring (φ over 58ms), for the CSS keyframes. */
export const popoverEnterEasing =
	"linear(0, 0.1377 22.4%, 0.3149 42.2%, 0.432 69.8%, 1 100%)";

function at(samples: Sample[], ms: number): number {
	if (ms <= samples[0][0]) return samples[0][1];
	for (let i = 1; i < samples.length; i++) {
		if (ms <= samples[i][0]) {
			const [t0, v0] = samples[i - 1];
			const [t1, v1] = samples[i];
			return v0 + ((v1 - v0) * (ms - t0)) / (t1 - t0);
		}
	}
	return samples[samples.length - 1][1];
}

/** Intro: the live enter spring. */
export function popoverIn(_node: Element, _params: Record<string, never> = {}) {
	return {
		duration: popoverEnterDuration,
		css: (t: number) => {
			const phi = at(enterPhi, t * popoverEnterDuration);
			return `opacity: ${popoverOpacity * phi}; transform: scale(${(popoverScale + (1 - popoverScale) * phi).toFixed(6)})`;
		},
	};
}

/** Outro: the live exit, incl. the ~207ms opacity tail that keeps the surface mounted. */
export function popoverOut(_node: Element, _params: Record<string, never> = {}) {
	return {
		duration: popoverExitDuration,
		// Svelte runs outro progress from 1 back to 0, so time = (1 − t) · duration.
		css: (t: number) => {
			const ms = (1 - t) * popoverExitDuration;
			const scale = 1 - (1 - popoverScale) * at(exitScalePsi, ms);
			return `opacity: ${at(exitOpacity, ms)}; transform: scale(${scale.toFixed(6)})`;
		},
	};
}
