<!-- TDS Asset.Frame (components/Asset/frame). Frame presets measured on the docs:
     square     small 40 r10 · medium 52 r12                         content at 55%
     squircle   40 r12                                               content at 55%
     rectangle  small 80x54 r10 · medium 100x68 r10                  content at 60%
     circle     30 · 36 · 40 (r 9999)                                content at 55%
     card       24x36 r3 · 28x42 r3 · 32x48 r4                       content at 70%
     Frame fill grey100 (backgroundColor); acc = a badge pinned to a corner (bottom-right default),
     accMasking circle cuts a ring out of the frame under it. -->
<script lang="ts" module>
	export const frameShape = {
		SquareSmall: { w: 40, h: 40, r: 10, s: 0.55 },
		SquareMedium: { w: 52, h: 52, r: 12, s: 0.55 },
		Squircle: { w: 40, h: 40, r: 12, s: 0.55 },
		RectangleSmall: { w: 80, h: 54, r: 10, s: 0.6 },
		RectangleMedium: { w: 100, h: 68, r: 10, s: 0.6 },
		CircleSmall: { w: 30, h: 30, r: 9999, s: 0.55 },
		CircleMedium: { w: 36, h: 36, r: 9999, s: 0.55 },
		CircleLarge: { w: 40, h: 40, r: 9999, s: 0.55 },
		CardSmall: { w: 24, h: 36, r: 3, s: 0.7 },
		CardMedium: { w: 28, h: 42, r: 3, s: 0.7 },
		CardLarge: { w: 32, h: 48, r: 4, s: 0.7 },
	} as const;
	export type FrameShape = (typeof frameShape)[keyof typeof frameShape];
</script>

<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		shape = frameShape.SquareSmall,
		src,
		alt = "",
		backgroundColor = "var(--grey-100)",
		acc,
		accPosition = "bottom-right",
		children,
	}: {
		shape?: FrameShape;
		src?: string;
		alt?: string;
		backgroundColor?: string;
		acc?: Snippet;
		accPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
		children?: Snippet;
	} = $props();
</script>

<span
	class="tds-asset-frame"
	data-tds-mobile-component="Asset.Frame"
	data-acc={accPosition}
	style:--w={`${shape.w}px`}
	style:--h={`${shape.h}px`}
	style:--r={`${shape.r}px`}
	style:--s={shape.s}
	style:--bg={backgroundColor}
>
	<span class="frame">
		{#if src}<img {src} {alt} />{:else if children}<span class="content">{@render children()}</span>{/if}
	</span>
	{#if acc}<span class="acc">{@render acc()}</span>{/if}
</span>

<style>
	.tds-asset-frame {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
	}
	.frame {
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--w);
		height: var(--h);
		border-radius: min(var(--r), 50%);
		overflow: hidden;
		background: var(--bg);
		color: var(--ink-soft);
	}
	img,
	.content {
		width: calc(var(--w) * var(--s));
		height: calc(var(--h) * var(--s));
		object-fit: contain;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.content :global(svg) {
		width: 100%;
		height: 100%;
	}
	.acc {
		position: absolute;
		display: flex;
		translate: 25% 25%;
		right: 0;
		bottom: 0;
	}
	[data-acc="top-right"] .acc {
		top: 0;
		bottom: auto;
		translate: 25% -25%;
	}
	[data-acc="top-left"] .acc {
		top: 0;
		left: 0;
		right: auto;
		bottom: auto;
		translate: -25% -25%;
	}
	[data-acc="bottom-left"] .acc {
		left: 0;
		right: auto;
		translate: -25% 25%;
	}
</style>
