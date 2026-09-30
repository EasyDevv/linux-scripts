<!-- SEED Badge (seed-design.io/react/components/badge).
     size    medium 20 (r4, px6, t1) · large 24 (r6, px8, t2)
     variant weak (medium weight) · solid · outline (bold)
     tone    neutral · brand · informative · positive · warning · critical
             weak = bg-{tone}-weak + fg-{tone}-contrast · solid = bg-{tone}-solid + white · outline = stroke-{tone}-weak -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { variants } from "./seed.ts";

	let {
		size = "medium",
		variant = "solid",
		tone = "neutral",
		children,
	}: {
		size?: "medium" | "large";
		variant?: "weak" | "solid" | "outline";
		tone?: "neutral" | "brand" | "informative" | "positive" | "warning" | "critical";
		children: Snippet;
	} = $props();

	const v = $derived(variants({ size, variant, tone }));
</script>

<span class="seed-badge__root" {...v}><span class="seed-badge__label" {...v}>{@render children()}</span></span>

<style>
	/* @recipe badge */
	/* SEED recipe: badge */
	:global(.seed-badge__root) {
		display: inline-flex;
		box-sizing: border-box;
		align-items: center;
		text-transform: none;
		text-align: start;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		text-decoration: none;
	}
	:global(.seed-badge__label) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global(.seed-badge__root[data-size="medium"]) {
		max-width: clamp(calc(108px * var(--font-size-limit-min)), 7.5rem, calc(108px * var(--font-size-limit-max)));
		min-height: var(--dimension-x5);
		padding-inline: var(--dimension-x1-5);
		padding-block: var(--dimension-x0-5);
		border-radius: var(--radius-r1);
		font-size: var(--text-t1);
		line-height: var(--text-t1--line-height);
	}
	:global(.seed-badge__root[data-size="large"]) {
		max-width: clamp(calc(120px * var(--font-size-limit-min)), 6.75rem, calc(120px * var(--font-size-limit-max)));
		min-height: var(--dimension-x6);
		padding-inline: var(--dimension-x2);
		padding-block: var(--dimension-x1);
		border-radius: var(--radius-r1-5);
		font-size: var(--text-t2);
		line-height: var(--text-t2--line-height);
	}
	:global(.seed-badge__root[data-variant="weak"]) {
		font-weight: var(--font-weight-medium);
	}
	:global(.seed-badge__root[data-variant="solid"]) {
		font-weight: var(--font-weight-bold);
	}
	:global(.seed-badge__root[data-variant="outline"]) {
		font-weight: var(--font-weight-bold);
	}
	:global(.seed-badge__root[data-tone="neutral"][data-variant="weak"]) {
		background-color: var(--bg-neutral-weak);
		color: var(--fg-neutral-muted);
	}
	:global(.seed-badge__root[data-tone="neutral"][data-variant="solid"]) {
		background-color: var(--palette-gray-800);
		color: var(--fg-neutral-inverted);
	}
	:global(.seed-badge__root[data-tone="neutral"][data-variant="outline"]) {
		box-shadow: inset 0 0 0 1px var(--stroke-neutral-muted);
		color: var(--fg-neutral-muted);
	}
	:global(.seed-badge__root[data-tone="brand"][data-variant="weak"]) {
		background-color: var(--bg-brand-weak);
		color: var(--fg-brand-contrast);
	}
	:global(.seed-badge__root[data-tone="brand"][data-variant="solid"]) {
		background-color: var(--bg-brand-solid);
		color: var(--palette-static-white);
	}
	:global(.seed-badge__root[data-tone="brand"][data-variant="outline"]) {
		box-shadow: inset 0 0 0 1px var(--stroke-brand-weak);
		color: var(--fg-brand);
	}
	:global(.seed-badge__root[data-tone="informative"][data-variant="weak"]) {
		background-color: var(--bg-informative-weak);
		color: var(--fg-informative-contrast);
	}
	:global(.seed-badge__root[data-tone="informative"][data-variant="solid"]) {
		background-color: var(--bg-informative-solid);
		color: var(--palette-static-white);
	}
	:global(.seed-badge__root[data-tone="informative"][data-variant="outline"]) {
		box-shadow: inset 0 0 0 1px var(--stroke-informative-weak);
		color: var(--fg-informative);
	}
	:global(.seed-badge__root[data-tone="positive"][data-variant="weak"]) {
		background-color: var(--bg-positive-weak);
		color: var(--fg-positive-contrast);
	}
	:global(.seed-badge__root[data-tone="positive"][data-variant="solid"]) {
		background-color: var(--bg-positive-solid);
		color: var(--palette-static-white);
	}
	:global(.seed-badge__root[data-tone="positive"][data-variant="outline"]) {
		box-shadow: inset 0 0 0 1px var(--stroke-positive-weak);
		color: var(--fg-positive);
	}
	:global(.seed-badge__root[data-tone="warning"][data-variant="weak"]) {
		background-color: var(--bg-warning-weak);
		color: var(--fg-warning-contrast);
	}
	:global(.seed-badge__root[data-tone="warning"][data-variant="solid"]) {
		background-color: var(--bg-warning-solid);
		color: var(--palette-static-black-alpha-900);
	}
	:global(.seed-badge__root[data-tone="warning"][data-variant="outline"]) {
		box-shadow: inset 0 0 0 1px var(--stroke-warning-weak);
		color: var(--fg-warning);
	}
	:global(.seed-badge__root[data-tone="critical"][data-variant="weak"]) {
		background-color: var(--bg-critical-weak);
		color: var(--fg-critical-contrast);
	}
	:global(.seed-badge__root[data-tone="critical"][data-variant="solid"]) {
		background-color: var(--bg-critical-solid);
		color: var(--palette-static-white);
	}
	:global(.seed-badge__root[data-tone="critical"][data-variant="outline"]) {
		box-shadow: inset 0 0 0 1px var(--stroke-critical-weak);
		color: var(--fg-critical);
	}
	/* @end recipe */
</style>
