<!-- SEED ListHeader: section title above a list — px16 py8, t4; mediumWeak (500, fg-neutral-subtle) · boldSolid (700, fg-neutral). -->
<script lang="ts">
	import type { Snippet } from "svelte";
	let { variant = "mediumWeak", as = "h2", children }: { variant?: "mediumWeak" | "boldSolid"; as?: string; children: Snippet } = $props();
</script>

<svelte:element this={as} class="seed-list-header" data-variant={variant}>{@render children()}</svelte:element>

<style>
	/* @recipe list-header */
	/* SEED recipe: list-header */
	:global(.seed-list-header) {
		display: flex;
		align-items: center;
		width: 100%;
		gap: var(--dimension-x2-5);
		justify-content: space-between;
		box-sizing: border-box;
		padding-inline: var(--spacing-global-gutter);
		padding-block: var(--dimension-x2);
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
	}
	:global(.seed-list-header[data-variant="mediumWeak"]) {
		font-weight: var(--font-weight-medium);
		color: var(--fg-neutral-subtle);
	}
	:global(.seed-list-header[data-variant="boldSolid"]) {
		font-weight: var(--font-weight-bold);
		color: var(--fg-neutral);
	}
	/* @end recipe */
</style>
