<!-- SEED AspectRatio: padding-box ratio (iOS 14-safe) — children fill the box, images cover. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	let { ratio = 4 / 3, radius, style = "", children }: { ratio?: number; radius?: string; style?: string; children: Snippet } = $props();
</script>

<div class="seed-box seed-aspect-ratio" style="position: relative; overflow: hidden; --seed-aspect-ratio-padding: {(1 / ratio) * 100}%;{radius ? ` border-radius: var(${radius});` : ''} {style}">
	{@render children()}
</div>

<style>
	/* @recipe aspect-ratio */
	/* SEED recipe: aspect-ratio */
	:global(.seed-aspect-ratio) {
		--seed-aspect-ratio-padding: 75%;
	}
	:global(.seed-aspect-ratio::before) {
		content: '';
		display: block;
		height: 0;
		padding-bottom: var(--seed-aspect-ratio-padding);
	}
	:global(.seed-aspect-ratio > *:not(style)) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: flex;
		justify-content: center;
		align-items: center;
	}
	:global(.seed-aspect-ratio > img),
	:global(.seed-aspect-ratio > video) {
		object-fit: cover;
	}
	/* @end recipe */
</style>
