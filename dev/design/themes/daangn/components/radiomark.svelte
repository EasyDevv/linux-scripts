<!-- SEED Radiomark: the bare radio mark (20 / 24, inner dot when checked) for custom rows. -->
<script lang="ts">
	import { scaleFeedback, states, variants } from "./seed.ts";
	let { checked = false, tone = "brand", size = "medium", disabled = false }: { checked?: boolean; tone?: "brand" | "neutral"; size?: "medium" | "large"; disabled?: boolean } = $props();
	const v = $derived(variants({ tone, size }));
	const s = $derived(states({ checked, disabled }));
</script>

<div class="seed-radiomark__root seed-scale-feedback" {...v} {...s} aria-hidden="true" {@attach scaleFeedback}>
	{#if checked}<svg class="seed-radiomark__icon" {...v} {...s} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="currentColor" /></svg>{/if}
</div>

<style>
	/* @recipe radiomark */
	/* SEED recipe: radiomark */
	:global(.seed-radiomark__root) {
		border-style: solid;
		box-sizing: border-box;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		border-width: 1px;
		border-color: var(--stroke-neutral-weak);
		border-radius: var(--radius-full);
		margin-top: var(--radiomark-margin-top, 0);
	}
	:global(.seed-radiomark__root:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
		scale: var(--seed-radiomark-feedback-scale, var(--feedback-scale));
	}
	:global(.seed-radiomark__root) {
		transition: background-color var(--duration-color-transition) var(--ease-easing), scale var(--duration-pressed-scale) var(--ease-pressed-scale), outline-color var(--duration-d3) var(--ease-easing);
		outline: var(--seed-focus-ring, var(--dimension-x0-5) solid transparent);
		outline-offset: var(--dimension-x0-5);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-radiomark__root:not(:is(:disabled, [disabled], [data-disabled])):is(:hover, [data-hover])) {
			background-color: var(--bg-transparent-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-radiomark__root:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
			background-color: var(--bg-transparent-pressed);
		}
	}
	:global(.seed-radiomark__root:is(:checked, [data-checked])) {
		border-width: 0px;
	}
	:global(.seed-radiomark__root:is(:disabled, [disabled], [data-disabled])) {
		background-color: var(--palette-gray-300);
	}
	:global(.seed-radiomark__root:is(:disabled, [disabled], [data-disabled]):is(:checked, [data-checked])) {
		background-color: var(--bg-transparent);
		border-width: 1px;
		border-color: var(--palette-gray-300);
	}
	:global(.seed-radiomark__root:is(:focus-visible, [data-focus-visible])) {
		outline: var(--seed-focus-ring, var(--dimension-x0-5) solid var(--stroke-focus-ring));
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-radiomark__icon) {
		display: none;
		border-radius: var(--radius-full);
	}
	:global(.seed-radiomark__icon:is(:checked, [data-checked])) {
		display: block;
	}
	:global(.seed-radiomark__icon:is(:disabled, [disabled], [data-disabled]):is(:checked, [data-checked])) {
		color: var(--palette-gray-300);
	}
	:global(.seed-radiomark__root[data-tone="neutral"]:is(:checked, [data-checked])) {
		background-color: var(--bg-neutral-inverted);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-radiomark__root[data-tone="neutral"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, [data-checked]):is(:hover, [data-hover])) {
			background-color: var(--bg-neutral-inverted-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-radiomark__root[data-tone="neutral"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, [data-checked]):is(:active, [data-active])) {
			background-color: var(--bg-neutral-inverted-pressed);
		}
	}
	:global(.seed-radiomark__icon[data-tone="neutral"]:is(:checked, [data-checked])) {
		color: var(--fg-neutral-inverted);
	}
	:global(.seed-radiomark__root[data-tone="brand"]:is(:checked, [data-checked])) {
		background-color: var(--bg-brand-solid);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-radiomark__root[data-tone="brand"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, [data-checked]):is(:hover, [data-hover])) {
			background-color: var(--bg-brand-solid-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-radiomark__root[data-tone="brand"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, [data-checked]):is(:active, [data-active])) {
			background-color: var(--bg-brand-solid-pressed);
		}
	}
	:global(.seed-radiomark__icon[data-tone="brand"]:is(:checked, [data-checked])) {
		color: var(--palette-static-white);
	}
	:global(.seed-radiomark__root[data-size="large"]) {
		width: var(--dimension-x6);
		height: var(--dimension-x6);
	}
	:global(.seed-radiomark__icon[data-size="large"]) {
		width: var(--dimension-x2-5);
		height: var(--dimension-x2-5);
	}
	:global(.seed-radiomark__icon[data-size="large"]:is(:disabled, [disabled], [data-disabled])) {
		width: var(--dimension-x3);
		height: var(--dimension-x3);
	}
	:global(.seed-radiomark__root[data-size="medium"]) {
		width: var(--dimension-x5);
		height: var(--dimension-x5);
	}
	:global(.seed-radiomark__icon[data-size="medium"]) {
		width: var(--dimension-x2);
		height: var(--dimension-x2);
	}
	:global(.seed-radiomark__icon[data-size="medium"]:is(:disabled, [disabled], [data-disabled])) {
		width: var(--dimension-x2-5);
		height: var(--dimension-x2-5);
	}
	/* @end recipe */
</style>
