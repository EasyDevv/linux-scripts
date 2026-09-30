<!-- SEED ImageFrameIndicator ("+9" count pill over an image) and ImageFrameIcon (white icon). -->
<script lang="ts">
	import type { Component, Snippet } from "svelte";
	let { icon: Icon, children }: { icon?: Component; children?: Snippet } = $props();
</script>

{#if Icon}
	<span class="seed-image-frame-icon"><Icon class="seed-icon" aria-hidden="true" style="--seed-icon-size: var(--dimension-x6)" /></span>
{:else}
	<span class="seed-image-frame-indicator">{@render children?.()}</span>
{/if}

<style>
	/* @recipe image-frame-indicator, image-frame-icon */
	/* SEED recipe: image-frame-indicator */
	:global(.seed-image-frame-indicator) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		background-color: var(--palette-static-black-alpha-800);
		color: var(--palette-static-white);
		border-radius: var(--radius-full);
		padding-inline: var(--dimension-x1-5);
		padding-block: var(--dimension-x0-5);
		font-size: var(--text-t1);
		line-height: var(--text-t1--line-height);
		font-weight: var(--font-weight-medium);
	}

	/* SEED recipe: image-frame-icon */
	:global(.seed-image-frame-icon) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--palette-static-white);
	}
	/* @end recipe */
</style>
