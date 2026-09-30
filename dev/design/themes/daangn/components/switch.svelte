<!-- SEED Switch (seed-design.io/react/components/switch).
     size   32: 52x32 track, 26 thumb, pad 3, label t5 · 24: 38x24 / 20, label t4 · 16: 26x16 / 12, label t3
     tone   brand (checked = bg-brand-solid) · neutral (checked = bg-neutral-inverted)
     Root is a <label> around the switchmark, the label text and a visually hidden
     <input role=switch>; every slot carries data-checked / data-disabled like SEED's headless hook. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { scaleFeedback, states, variants, visuallyHidden } from "./seed.ts";

	let {
		checked = $bindable(false),
		size = "32",
		tone = "brand",
		disabled = false,
		label,
		name,
		children,
	}: {
		checked?: boolean;
		size?: "16" | "24" | "32";
		tone?: "brand" | "neutral";
		disabled?: boolean;
		label?: string;
		name?: string;
		/** custom label content (the docs' CustomSwitch stacks Switchmark over it) */
		children?: Snippet;
	} = $props();

	const s = $derived(states({ checked, disabled }));
</script>

<label class={children ? undefined : "seed-switch__root"} {...variants({ size })} {...s} style={children ? "display: flex; flex-direction: column; align-items: center; gap: var(--dimension-x2)" : undefined}>
	<div class="seed-switchmark__root seed-scale-feedback" {...variants({ tone, size })} {...s} aria-hidden="true" {@attach scaleFeedback}>
		<div class="seed-switchmark__thumb" {...variants({ tone, size })} {...s} aria-hidden="true"></div>
	</div>
	{#if children}{@render children()}{:else if label}<span class="seed-switch__label" {...variants({ size })} {...s}>{label}</span>{/if}
	<input type="checkbox" role="switch" {name} {disabled} bind:checked aria-label={label ? undefined : name} style={visuallyHidden} {...s} />
</label>

<style>
	/* @recipe switch, switchmark */
	/* SEED recipe: switch */
	:global(.seed-switch__root) {
		box-sizing: border-box;
		display: inline-flex;
		align-items: flex-start;
		justify-content: space-between;
		position: relative;
		vertical-align: top;
		isolation: isolate;
		cursor: pointer;
	}
	:global(.seed-switch__root:is(:disabled, [disabled], [data-disabled])) {
		cursor: not-allowed;
	}
	:global(.seed-switch__label) {
		font-weight: var(--font-weight-medium);
		color: var(--fg-neutral);
		transition: opacity var(--duration-d1) var(--ease-easing);
	}
	:global(.seed-switch__label:is(:disabled, [disabled], [data-disabled])) {
		opacity: 0.58;
	}
	:global(.seed-switch__root[data-size="16"]) {
		min-height: var(--dimension-x6);
		gap: var(--dimension-x1-5);
		--switchmark-margin-top: calc((var(--dimension-x6) - 16px) / 2);
	}
	:global(.seed-switch__label[data-size="16"]) {
		font-size: var(--text-t3);
		line-height: var(--text-t3--line-height);
		margin-top: calc(var(--dimension-x6) / 2 - var(--text-t3--line-height) / 2);
	}
	:global(.seed-switch__root[data-size="24"]) {
		min-height: var(--dimension-x6);
		gap: var(--dimension-x2);
		--switchmark-margin-top: calc((var(--dimension-x6) - 24px) / 2);
	}
	:global(.seed-switch__label[data-size="24"]) {
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
		margin-top: calc(var(--dimension-x6) / 2 - var(--text-t4--line-height) / 2);
	}
	:global(.seed-switch__root[data-size="32"]) {
		min-height: var(--dimension-x8);
		gap: var(--dimension-x2-5);
		--switchmark-margin-top: calc((var(--dimension-x8) - 32px) / 2);
	}
	:global(.seed-switch__label[data-size="32"]) {
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		margin-top: calc(var(--dimension-x8) / 2 - var(--text-t5--line-height) / 2);
	}

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
