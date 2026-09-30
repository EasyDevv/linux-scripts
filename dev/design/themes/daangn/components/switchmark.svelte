<!-- SEED Switchmark: the bare switch track + thumb (32 / 24 / 16) for custom rows. -->
<script lang="ts">
	import { scaleFeedback, states, variants } from "./seed.ts";
	let { checked = false, tone = "brand", size = "32", disabled = false }: { checked?: boolean; tone?: "brand" | "neutral"; size?: "16" | "24" | "32"; disabled?: boolean } = $props();
	const v = $derived(variants({ tone, size }));
	const s = $derived(states({ checked, disabled }));
</script>

<div class="seed-switchmark__root seed-scale-feedback" {...v} {...s} aria-hidden="true" {@attach scaleFeedback}>
	<div class="seed-switchmark__thumb" {...v} {...s} aria-hidden="true"></div>
</div>

<style>
	/* @recipe switchmark */
	/* SEED recipe: switchmark */
	:global(.seed-switchmark__root) {
		box-sizing: border-box;
		display: block;
		position: relative;
		border-radius: var(--radius-full);
		background: var(--palette-gray-600);
		margin: var(--switchmark-margin-top, 0) 0;
		transition: background-color var(--duration-d1) var(--ease-easing) 20ms, opacity var(--duration-d1) var(--ease-easing), scale var(--duration-pressed-scale) var(--ease-pressed-scale), outline-color var(--duration-d3) var(--ease-easing);
	}
	:global(.seed-switchmark__root:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
		scale: var(--seed-switchmark-feedback-scale, var(--feedback-scale));
	}
	:global(.seed-switchmark__root:is(:disabled, [disabled], [data-disabled])) {
		opacity: 0.38;
	}
	:global(.seed-switchmark__root) {
		outline: var(--seed-focus-ring, var(--dimension-x0-5) solid transparent);
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-switchmark__root:is(:focus-visible, [data-focus-visible])) {
		outline: var(--seed-focus-ring, var(--dimension-x0-5) solid var(--stroke-focus-ring));
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-switchmark__thumb) {
		border-radius: var(--radius-full);
		transition: transform var(--duration-d3) var(--ease-easing), background-color var(--duration-d1) var(--ease-easing) 20ms;
		transform: scale(0.8);
	}
	:global(.seed-switchmark__root[data-tone="neutral"]:is(:checked, [data-checked])) {
		background: var(--bg-neutral-inverted);
	}
	:global(.seed-switchmark__root[data-tone="neutral"]:is(:disabled, [disabled], [data-disabled]):is(:checked, [data-checked])) {
		background: var(--palette-gray-600);
	}
	:global(.seed-switchmark__thumb[data-tone="neutral"]) {
		background: var(--fg-neutral-inverted);
	}
	:global(.seed-switchmark__thumb[data-tone="neutral"]:is(:disabled, [disabled], [data-disabled])) {
		background: var(--palette-static-black-alpha-700);
	}
	:global(.seed-switchmark__root[data-tone="brand"]:is(:checked, [data-checked])) {
		background: var(--bg-brand-solid);
	}
	:global(.seed-switchmark__thumb[data-tone="brand"]) {
		background: var(--palette-static-white);
	}
	:global(.seed-switchmark__root[data-size="16"]) {
		min-width: 26px;
		min-height: 16px;
		padding: 2px 2px;
	}
	:global(.seed-switchmark__thumb[data-size="16"]) {
		width: 12px;
		height: 12px;
	}
	:global(.seed-switchmark__thumb[data-size="16"]:is(:checked, [data-checked])) {
		transform: scale(1) translateX(calc(26px - 16px));
	}
	:global(.seed-switchmark__root[data-size="24"]) {
		min-width: 38px;
		min-height: 24px;
		padding: 2px 2px;
	}
	:global(.seed-switchmark__thumb[data-size="24"]) {
		width: 20px;
		height: 20px;
	}
	:global(.seed-switchmark__thumb[data-size="24"]:is(:checked, [data-checked])) {
		transform: scale(1) translateX(calc(38px - 24px));
	}
	:global(.seed-switchmark__root[data-size="32"]) {
		min-width: 52px;
		min-height: 32px;
		padding: 3px 3px;
	}
	:global(.seed-switchmark__thumb[data-size="32"]) {
		width: 26px;
		height: 26px;
	}
	:global(.seed-switchmark__thumb[data-size="32"]:is(:checked, [data-checked])) {
		transform: scale(1) translateX(calc(52px - 32px));
	}
	/* @end recipe */
</style>
