<!-- SEED Checkbox (seed-design.io/react/components/checkbox).
     size    medium 20 box, label t4 · large 24 box, label t5; root gap 8
     variant square (r4, 1px stroke-neutral-weak; checked = tone fill) · ghost (bare glyph, grey unchecked)
     tone    brand · neutral;  weight regular | bold;  indeterminate shows a minus
     A <label> root wraps the checkmark, the label and a visually hidden <input type=checkbox>. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { glyph, scaleFeedback, states, variants, visuallyHidden } from "./seed.ts";

	let {
		checked = $bindable(false),
		indeterminate = false,
		variant = "square",
		tone = "brand",
		size = "medium",
		weight = "regular",
		disabled = false,
		label,
		name,
		value,
		children,
	}: {
		checked?: boolean;
		indeterminate?: boolean;
		variant?: "square" | "ghost";
		tone?: "brand" | "neutral";
		size?: "medium" | "large";
		weight?: "regular" | "bold";
		disabled?: boolean;
		label?: string;
		name?: string;
		value?: string;
		/** custom label content instead of `label` */
		children?: Snippet;
	} = $props();

	const s = $derived(states({ checked: checked || indeterminate, indeterminate, disabled }));
	const mark = $derived(variants({ variant, tone, size }));
	const icon = $derived(indeterminate ? glyph.minus : checked || variant === "ghost" ? glyph.check : null);
</script>

<label class={children ? undefined : "seed-checkbox__root"} {...variants({ size, weight })} {...s} style={children ? "display: flex; flex-direction: column; align-items: center; gap: var(--dimension-x2)" : undefined}>
	<div class="seed-checkmark__root seed-scale-feedback" {...mark} {...s} aria-hidden="true" {@attach scaleFeedback}>
		{#if icon}
			<svg class="seed-checkmark__icon" {...mark} {...s} viewBox="0 0 24 24" aria-hidden="true"><path d={icon} fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
		{/if}
	</div>
	{#if children}{@render children()}{:else if label}<span class="seed-checkbox__label" {...variants({ size, weight })} {...s}>{label}</span>{/if}
	<input type="checkbox" {name} {value} {disabled} bind:checked {indeterminate} style={visuallyHidden} {...s} />
</label>

<style>
	/* @recipe checkbox, checkmark */
	/* SEED recipe: checkbox */
	:global(.seed-checkbox__root) {
		display: inline-flex;
		align-items: flex-start;
		position: relative;
		max-width: 100%;
		vertical-align: top;
		isolation: isolate;
		cursor: pointer;
		gap: var(--dimension-x2);
	}
	:global(.seed-checkbox__root:is(:disabled, [disabled], [data-disabled])) {
		cursor: not-allowed;
	}
	:global(.seed-checkbox__label) {
		color: var(--fg-neutral);
	}
	:global(.seed-checkbox__label:is(:disabled, [disabled], [data-disabled])) {
		color: var(--fg-disabled);
	}
	:global(.seed-checkbox__label[data-weight="regular"]) {
		font-weight: var(--font-weight-regular);
	}
	:global(.seed-checkbox__label[data-weight="bold"]) {
		font-weight: var(--font-weight-bold);
	}
	:global(.seed-checkbox__root[data-size="large"]) {
		min-height: var(--dimension-x9);
		--checkmark-margin-top: calc((var(--dimension-x9) - var(--dimension-x6)) / 2);
	}
	:global(.seed-checkbox__label[data-size="large"]) {
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		margin-top: calc(var(--dimension-x9) / 2 - var(--text-t5--line-height) / 2);
	}
	:global(.seed-checkbox__root[data-size="medium"]) {
		min-height: var(--dimension-x8);
		--checkmark-margin-top: calc((var(--dimension-x8) - var(--dimension-x5)) / 2);
	}
	:global(.seed-checkbox__label[data-size="medium"]) {
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
		margin-top: calc(var(--dimension-x8) / 2 - var(--text-t4--line-height) / 2);
	}

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
