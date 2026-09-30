<!-- SEED ImageFrameFloater (Float): pins children to a corner of the frame, offset x1.5 by default. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	let {
		placement = "top-end",
		offsetX = "--dimension-x1-5",
		offsetY = "--dimension-x1-5",
		children,
	}: { placement?: "top-start" | "top-end" | "bottom-start" | "bottom-end" | "top-center" | "bottom-center"; offsetX?: string; offsetY?: string; children: Snippet } = $props();
	const [y, x] = $derived(placement.split("-"));
	const style = $derived(
		`position: absolute; z-index: 1; ${y}: var(${offsetY}); ` +
			(x === "start" ? `left: var(${offsetX})` : x === "end" ? `right: var(${offsetX})` : "left: 50%; translate: -50% 0"),
	);
</script>

<div {style}>{@render children()}</div>
