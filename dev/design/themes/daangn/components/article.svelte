<!-- SEED Article: long-form container that restores text selection (user-select: text) and
     Korean-friendly line breaking (word-break: keep-all) for its paragraphs. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	let { as = "article", style, children }: { as?: string; style?: string; children: Snippet } = $props();
</script>

<svelte:element this={as} class="seed-box seed-article" {style}>{@render children()}</svelte:element>

<style>
	/* @recipe article */
	/* SEED recipe: article */
	:global(.seed-article) {
		user-select: text;
		word-break: normal;
		overflow-wrap: break-word;
		line-break: strict;
	}
	:global(.seed-article:lang(ko)) {
		word-break: keep-all;
	}
	/* @end recipe */
</style>
