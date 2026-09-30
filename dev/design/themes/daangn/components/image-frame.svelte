<!-- SEED ImageFrame (seed-design.io/react/components/image-frame): AspectRatio (default 4:3, r8) +
     image with a ContentPlaceholder fallback, optional 1px inner stroke, and overlay slots pinned
     with the ImageFrameFloater offsets (x1.5). -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import AspectRatio from "./aspect-ratio.svelte";
	import ContentPlaceholder from "./content-placeholder.svelte";
	import type { ContentPlaceholderType } from "./content-placeholder-assets.ts";
	import { variants } from "./seed.ts";

	let {
		src,
		alt = "",
		ratio = 4 / 3,
		radius = "--radius-r2",
		stroke = false,
		fallback = "commerce",
		width,
		overlay,
	}: {
		src?: string;
		alt?: string;
		ratio?: number;
		radius?: string;
		stroke?: boolean;
		fallback?: ContentPlaceholderType | null;
		width?: string;
		/** floaters: absolutely positioned children (see image-frame-floater.svelte) */
		overlay?: Snippet;
	} = $props();

	let loaded = $state<"loaded" | "error" | null>(null);
	const state = $derived(loaded ?? (src ? "loading" : "error"));
	const v = $derived(variants({ stroke: stroke ? "true" : undefined }));
</script>

<AspectRatio {ratio} {radius} style={width ? `width: ${width}` : ""}>
	<div class="seed-image-frame__root" {...v} data-loading-state={state} style="border-radius: inherit">
		{#if src}<img class="seed-image-frame__content" {...v} {src} {alt} data-loading-state={state} data-visible={state === "loaded" ? "" : undefined} onload={() => (loaded = "loaded")} onerror={() => (loaded = "error")} />{/if}
		{#if fallback}<div class="seed-image-frame__fallback" {...v} data-loading-state={state} hidden={state === "loaded"}><ContentPlaceholder type={fallback} /></div>{/if}
		{@render overlay?.()}
	</div>
</AspectRatio>

<style>
	/* @recipe image-frame */
	/* SEED recipe: image-frame */
	:global(.seed-image-frame__root) {
		position: relative;
		overflow: hidden;
		border-radius: inherit;
		isolation: isolate;
	}
	:global(.seed-image-frame__content) {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: inherit;
	}
	:global(.seed-image-frame__content[data-loading-state='error']) {
		display: none;
	}
	:global(.seed-image-frame__content:is([hidden], [data-hidden])) {
		display: none;
	}
	:global(.seed-image-frame__content:not([data-loading-state='loaded'])) {
		pointer-events: none;
	}
	:global(.seed-image-frame__fallback) {
		position: absolute;
		inset: 0;
		z-index: -1;
		width: 100%;
		height: 100%;
	}
	:global(.seed-image-frame__fallback[data-loading-state='loaded']) {
		display: none;
	}
	:global(.seed-image-frame__root[data-stroke="true"]::after) {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: inherit;
		box-shadow: inset 0 0 0 1px var(--stroke-neutral-subtle);
	}
	/* @end recipe */
</style>
