<!-- SEED ContentPlaceholder: a grey well with a centred type illustration (default, coupon, car,
     realty, food, image, group, post, business, buySell, jobs, commerce) for missing content. -->
<script lang="ts">
	import { CONTENT_PLACEHOLDER_ASSETS, type ContentPlaceholderType } from "./content-placeholder-assets.ts";
	let { type = "default" }: { type?: ContentPlaceholderType } = $props();
</script>

<div class="seed-content-placeholder__root" data-type={type}>
	<svg class="seed-content-placeholder__asset" data-type={type} viewBox="0 0 64 64" fill="none" aria-hidden="true">{@html CONTENT_PLACEHOLDER_ASSETS[type]}</svg>
</div>

<style>
	/* @recipe content-placeholder */
	/* SEED recipe: content-placeholder */
	:global(.seed-content-placeholder__root) {
		box-sizing: border-box;
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		vertical-align: top;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background-color: var(--palette-gray-200);
	}
	:global(.seed-content-placeholder__asset) {
		display: block;
		height: calc(0.5 * 100%);
		min-width: var(--dimension-x4);
		max-width: 160px;
		width: auto;
		aspect-ratio: 1 / 1;
		color: var(--palette-gray-400);
		fill: currentColor;
		stroke: currentColor;
		object-fit: contain;
	}
	/* @end recipe */
</style>
