<!-- SEED Checkmark: the bare checkbox mark (square r4 / ghost) for custom rows such as list items. -->
<script lang="ts">
	import { glyph, scaleFeedback, states, variants } from "./seed.ts";
	let {
		checked = false,
		indeterminate = false,
		variant = "square",
		tone = "brand",
		size = "medium",
		disabled = false,
	}: { checked?: boolean; indeterminate?: boolean; variant?: "square" | "ghost"; tone?: "brand" | "neutral"; size?: "medium" | "large"; disabled?: boolean } = $props();
	const v = $derived(variants({ variant, tone, size }));
	const s = $derived(states({ checked: checked || indeterminate, indeterminate, disabled }));
	const icon = $derived(indeterminate ? glyph.minus : checked || variant === "ghost" ? glyph.check : null);
</script>

<div class="seed-checkmark__root seed-scale-feedback" {...v} {...s} aria-hidden="true" {@attach scaleFeedback}>
	{#if icon}<svg class="seed-checkmark__icon" {...v} {...s} viewBox="0 0 24 24" aria-hidden="true"><path d={icon} fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" /></svg>{/if}
</div>

<style>
	/* @recipe checkmark */
	/* SEED recipe: checkmark */
	:global(.seed-checkmark__root) {
		position: relative;
		box-sizing: border-box;
		flex: none;
		margin-top: var(--checkmark-margin-top, 0);
	}
	:global(.seed-checkmark__root:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
		scale: var(--seed-checkmark-feedback-scale, var(--feedback-scale));
	}
	:global(.seed-checkmark__root) {
		transition: background-color var(--duration-color-transition) var(--ease-easing), scale var(--duration-pressed-scale) var(--ease-pressed-scale), outline-color var(--duration-d3) var(--ease-easing);
		outline: var(--seed-focus-ring, var(--dimension-x0-5) solid transparent);
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-checkmark__root:is(:focus-visible, [data-focus-visible])) {
		outline: var(--seed-focus-ring, var(--dimension-x0-5) solid var(--stroke-focus-ring));
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-checkmark__icon) {
		display: none;
		content: "";
		position: absolute;
		margin: auto;
		inset: 0;
		text-align: center;
		overflow: initial;
	}
	:global(.seed-checkmark__root[data-variant="square"]) {
		border-width: 1px;
		border-style: solid;
		border-color: var(--stroke-neutral-weak);
	}
	:global(.seed-checkmark__root[data-variant="square"]:is(:checked, :indeterminate, [data-checked], [data-indeterminate])) {
		border-width: 0;
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-checkmark__root[data-variant="square"]:not(:is(:disabled, [disabled], [data-disabled])):is(:hover, [data-hover])) {
			background: var(--bg-transparent-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-checkmark__root[data-variant="square"]:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
			background: var(--bg-transparent-pressed);
		}
	}
	:global(.seed-checkmark__root[data-variant="square"]:is(:disabled, [disabled], [data-disabled])) {
		background: var(--bg-disabled);
		border-color: var(--stroke-neutral-muted);
	}
	:global(.seed-checkmark__icon[data-variant="square"]:is(:checked, :indeterminate, [data-checked], [data-indeterminate])) {
		display: block;
	}
	:global(.seed-checkmark__icon[data-variant="square"]:is(:disabled, [disabled], [data-disabled]):is(:checked, :indeterminate, [data-checked], [data-indeterminate])) {
		color: var(--fg-disabled);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-checkmark__root[data-variant="ghost"]:not(:is(:disabled, [disabled], [data-disabled])):is(:hover, [data-hover])) {
			background: var(--bg-transparent-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-checkmark__root[data-variant="ghost"]:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
			background: var(--bg-transparent-pressed);
		}
	}
	:global(.seed-checkmark__icon[data-variant="ghost"]) {
		display: block;
		color: var(--fg-placeholder);
		transition: color var(--duration-color-transition) var(--ease-easing);
	}
	:global(.seed-checkmark__icon[data-variant="ghost"]:is(:disabled, [disabled], [data-disabled])) {
		color: var(--fg-disabled);
	}
	:global(.seed-checkmark__icon[data-variant="ghost"]:is(:disabled, [disabled], [data-disabled]):is(:checked, :indeterminate, [data-checked], [data-indeterminate])) {
		color: var(--fg-disabled);
	}
	:global(.seed-checkmark__root[data-size="large"]) {
		border-radius: var(--radius-r1);
		width: var(--dimension-x6);
		height: var(--dimension-x6);
	}
	:global(.seed-checkmark__root[data-size="medium"]) {
		border-radius: var(--radius-r1);
		width: var(--dimension-x5);
		height: var(--dimension-x5);
	}
	:global(.seed-checkmark__root[data-variant="square"][data-tone="neutral"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, :indeterminate, [data-checked], [data-indeterminate])) {
		background: var(--bg-neutral-inverted);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-checkmark__root[data-variant="square"][data-tone="neutral"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, :indeterminate, [data-checked], [data-indeterminate]):is(:hover, [data-hover])) {
			background: var(--bg-neutral-inverted-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-checkmark__root[data-variant="square"][data-tone="neutral"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, :indeterminate, [data-checked], [data-indeterminate]):is(:active, [data-active])) {
			background: var(--bg-neutral-inverted-pressed);
		}
	}
	:global(.seed-checkmark__icon[data-variant="square"][data-tone="neutral"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, :indeterminate, [data-checked], [data-indeterminate])) {
		color: var(--fg-neutral-inverted);
	}
	:global(.seed-checkmark__root[data-variant="square"][data-tone="brand"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, :indeterminate, [data-checked], [data-indeterminate])) {
		background: var(--bg-brand-solid);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-checkmark__root[data-variant="square"][data-tone="brand"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, :indeterminate, [data-checked], [data-indeterminate]):is(:hover, [data-hover])) {
			background: var(--bg-brand-solid-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-checkmark__root[data-variant="square"][data-tone="brand"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, :indeterminate, [data-checked], [data-indeterminate]):is(:active, [data-active])) {
			background: var(--bg-brand-solid-pressed);
		}
	}
	:global(.seed-checkmark__icon[data-variant="square"][data-tone="brand"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, :indeterminate, [data-checked], [data-indeterminate])) {
		color: var(--palette-static-white);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-checkmark__root[data-variant="ghost"][data-tone="neutral"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, :indeterminate, [data-checked], [data-indeterminate]):is(:hover, [data-hover])) {
			background: var(--palette-gray-200);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-checkmark__root[data-variant="ghost"][data-tone="neutral"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, :indeterminate, [data-checked], [data-indeterminate]):is(:active, [data-active])) {
			background: var(--palette-gray-200);
		}
	}
	:global(.seed-checkmark__icon[data-variant="ghost"][data-tone="neutral"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, :indeterminate, [data-checked], [data-indeterminate])) {
		color: var(--fg-neutral);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-checkmark__root[data-variant="ghost"][data-tone="brand"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, :indeterminate, [data-checked], [data-indeterminate]):is(:hover, [data-hover])) {
			background: var(--palette-carrot-200);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-checkmark__root[data-variant="ghost"][data-tone="brand"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, :indeterminate, [data-checked], [data-indeterminate]):is(:active, [data-active])) {
			background: var(--palette-carrot-200);
		}
	}
	:global(.seed-checkmark__icon[data-variant="ghost"][data-tone="brand"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, :indeterminate, [data-checked], [data-indeterminate])) {
		color: var(--fg-brand);
	}
	:global(.seed-checkmark__icon[data-size="medium"][data-variant="ghost"]) {
		width: 14px;
		height: 14px;
	}
	:global(.seed-checkmark__icon[data-size="large"][data-variant="ghost"]) {
		width: 18px;
		height: 18px;
	}
	:global(.seed-checkmark__icon[data-size="medium"][data-variant="square"]) {
		width: 12px;
		height: 12px;
	}
	:global(.seed-checkmark__icon[data-size="large"][data-variant="square"]) {
		width: 14px;
		height: 14px;
	}
	/* @end recipe */
</style>
