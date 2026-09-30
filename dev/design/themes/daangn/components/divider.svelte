<!-- SEED Divider: a Box with a single border — 1px stroke-neutral-muted by default; `inset` adds the
     16px global gutter on both ends; `as="li"` inside lists. -->
<script lang="ts">
	let {
		as = "hr",
		orientation = "horizontal",
		inset = false,
		color = "--stroke-neutral-muted",
		thickness = 1,
	}: { as?: "hr" | "div" | "li"; orientation?: "horizontal" | "vertical"; inset?: boolean; color?: string; thickness?: number } = $props();

	const style = $derived(
		`display: block; margin: 0; border: 0 solid var(${color}); ${orientation === "vertical" ? `border-right-width: ${thickness}px; align-self: stretch` : `border-bottom-width: ${thickness}px`};` +
			(inset ? (orientation === "vertical" ? " margin-block: 16px;" : " margin-inline: 16px;") : ""),
	);
</script>

<svelte:element this={as} class="seed-box" {style} role={as === "hr" ? undefined : "separator"} aria-hidden={as === "li" ? "true" : undefined} aria-orientation={orientation === "vertical" ? "vertical" : undefined}></svelte:element>
