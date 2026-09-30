<!-- SEED ActionButton (seed-design.io/react/components/action-button).
     size    xsmall 32 pill · small 36 r8 · medium 40 r8 · large 52 r12 (withText / iconOnly)
     variant brandSolid · neutralSolid · neutralWeak · criticalSolid · brandOutline · neutralOutline · ghost
     label   bold; t3 (xsmall) / t4 (small, medium) / t6 (large)
     pressed *-pressed fill + scale feedback (h - 2) / h; loading keeps the width, hides the label
             under a ProgressCircle that inherits the button's colour and --size.
     Icons: pass Svelte icon components (e.g. lucide) as prefixIcon / suffixIcon / icon. -->
<script lang="ts">
	import type { Component, Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import ProgressCircle from "./progress-circle.svelte";
	import { scaleFeedback, states, variants } from "./seed.ts";

	let {
		variant = "brandSolid",
		size = "medium",
		loading = false,
		disabled = false,
		prefixIcon: PrefixIcon,
		suffixIcon: SuffixIcon,
		icon: IconOnly,
		color,
		fontWeight,
		type = "button",
		children,
		...rest
	}: {
		variant?: "brandSolid" | "neutralSolid" | "neutralWeak" | "criticalSolid" | "brandOutline" | "neutralOutline" | "ghost";
		size?: "xsmall" | "small" | "medium" | "large";
		loading?: boolean;
		disabled?: boolean;
		prefixIcon?: Component;
		suffixIcon?: Component;
		/** icon-only layout; give the button an aria-label */
		icon?: Component;
		/** ghost only: label + icon colour as a theme token name, e.g. "--fg-brand" (default --fg-neutral) */
		color?: string;
		/** ghost only: label weight (default bold) */
		fontWeight?: "regular" | "medium" | "bold";
		children?: Snippet;
	} & HTMLButtonAttributes = $props();

	const layout = $derived(IconOnly ? "iconOnly" : "withText");
</script>

{#snippet content()}
	{#if IconOnly}
		<IconOnly class="seed-icon" aria-hidden="true" />
	{:else}
		{#if PrefixIcon}<PrefixIcon class="seed-prefix-icon" aria-hidden="true" />{/if}
		{@render children?.()}
		{#if SuffixIcon}<SuffixIcon class="seed-suffix-icon" aria-hidden="true" />{/if}
	{/if}
{/snippet}

<button
	{...rest}
	{type}
	{disabled}
	class="seed-action-button seed-scale-feedback"
	{...variants({ variant, size, layout })}
	{...states({ loading, disabled })}
	style="{color ? `--seed-box-color: var(${color});` : ''}{fontWeight ? `--seed-font-weight: var(--font-weight-${fontWeight});` : ''}{rest.style ?? ''}"
	{@attach scaleFeedback}
>
	{#if loading}
		<span class="seed-loading-indicator" {...states({ loading, disabled })}>
			<ProgressCircle size="inherit" tone="inherit" />
		</span>
		<span style="opacity: 0; display: inherit; gap: inherit">{@render content()}</span>
	{:else}
		{@render content()}
	{/if}
</button>

<style>
	/* @recipe action-button */
	/* SEED recipe: action-button */
	:global(.seed-action-button) {
		display: inline-flex;
		position: relative;
		box-sizing: border-box;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		border: none;
		text-transform: none;
		white-space: nowrap;
		vertical-align: middle;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		text-decoration: none;
		flex-shrink: 0;
		font-family: inherit;
		--seed-box-flex-grow: initial;
		flex-grow: var(--seed-box-flex-grow);
		--seed-box-min-width: initial;
		min-width: var(--seed-box-min-width);
		--seed-box-padding-bottom: initial;
		--seed-box-padding-top: initial;
		--seed-box-padding-left: initial;
		--seed-box-padding-right: initial;
		padding-top: var(--seed-box-padding-top);
		padding-bottom: var(--seed-box-padding-bottom);
		padding-left: var(--seed-box-padding-left);
		padding-right: var(--seed-box-padding-right);
		--seed-box-bleed-bottom-base: 0px;
		--seed-box-bleed-bottom-sm: var(--seed-box-bleed-bottom-base, initial);
		--seed-box-bleed-bottom-md: var(--seed-box-bleed-bottom-sm, initial);
		--seed-box-bleed-bottom-lg: var(--seed-box-bleed-bottom-md, initial);
		--seed-box-bleed-bottom-xl: var(--seed-box-bleed-bottom-lg, initial);
		--seed-box-bleed-bottom: var(--seed-box-bleed-bottom-base, initial);
		--seed-box-bleed-top-base: 0px;
		--seed-box-bleed-top-sm: var(--seed-box-bleed-top-base, initial);
		--seed-box-bleed-top-md: var(--seed-box-bleed-top-sm, initial);
		--seed-box-bleed-top-lg: var(--seed-box-bleed-top-md, initial);
		--seed-box-bleed-top-xl: var(--seed-box-bleed-top-lg, initial);
		--seed-box-bleed-top: var(--seed-box-bleed-top-base, initial);
		--seed-box-bleed-left-base: 0px;
		--seed-box-bleed-left-sm: var(--seed-box-bleed-left-base, initial);
		--seed-box-bleed-left-md: var(--seed-box-bleed-left-sm, initial);
		--seed-box-bleed-left-lg: var(--seed-box-bleed-left-md, initial);
		--seed-box-bleed-left-xl: var(--seed-box-bleed-left-lg, initial);
		--seed-box-bleed-left: var(--seed-box-bleed-left-base, initial);
		--seed-box-bleed-right-base: 0px;
		--seed-box-bleed-right-sm: var(--seed-box-bleed-right-base, initial);
		--seed-box-bleed-right-md: var(--seed-box-bleed-right-sm, initial);
		--seed-box-bleed-right-lg: var(--seed-box-bleed-right-md, initial);
		--seed-box-bleed-right-xl: var(--seed-box-bleed-right-lg, initial);
		--seed-box-bleed-right: var(--seed-box-bleed-right-base, initial);
		margin-top: calc(var(--seed-box-bleed-top) * -1);
		margin-bottom: calc(var(--seed-box-bleed-bottom) * -1);
		margin-left: calc(var(--seed-box-bleed-left) * -1);
		margin-right: calc(var(--seed-box-bleed-right) * -1);
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-action-button:is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-action-button:is(:disabled, [disabled], [data-disabled])) {
		cursor: not-allowed;
	}
	:global(.seed-action-button:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
		scale: var(--feedback-scale);
	}
	:global(.seed-action-button) {
		transition: background-color var(--duration-color-transition) var(--ease-easing), scale var(--duration-pressed-scale) var(--ease-pressed-scale), outline-color var(--duration-d3) var(--ease-easing);
	}
	:global(.seed-action-button[data-variant="brandSolid"]) {
		background: var(--bg-brand-solid);
		color: var(--palette-static-white);
		font-weight: var(--font-weight-bold);
		--seed-prefix-icon-color: var(--palette-static-white);
		--seed-suffix-icon-color: var(--palette-static-white);
		--seed-icon-color: var(--palette-static-white);
		--track-color: var(--palette-static-white-alpha-300);
		--range-color: var(--palette-static-white);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-action-button[data-variant="brandSolid"]:is(:hover, [data-hover])) {
			background: var(--bg-brand-solid-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-action-button[data-variant="brandSolid"]:is(:active, [data-active])) {
			background: var(--bg-brand-solid-pressed);
		}
	}
	:global(.seed-action-button[data-variant="brandSolid"]:is(:disabled, [disabled], [data-disabled])) {
		background: var(--bg-disabled);
		color: var(--fg-disabled);
		--seed-prefix-icon-color: var(--fg-disabled);
		--seed-suffix-icon-color: var(--fg-disabled);
		--seed-icon-color: var(--fg-disabled);
	}
	:global(.seed-action-button[data-variant="brandSolid"][data-loading]) {
		background: var(--bg-brand-solid-pressed);
	}
	:global(.seed-action-button[data-variant="neutralSolid"]) {
		background: var(--bg-neutral-inverted);
		color: var(--fg-neutral-inverted);
		font-weight: var(--font-weight-bold);
		--seed-prefix-icon-color: var(--fg-neutral-inverted);
		--seed-suffix-icon-color: var(--fg-neutral-inverted);
		--seed-icon-color: var(--fg-neutral-inverted);
		--track-color: var(--palette-static-white-alpha-300);
		--range-color: var(--palette-static-white);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-action-button[data-variant="neutralSolid"]:is(:hover, [data-hover])) {
			background: var(--bg-neutral-inverted-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-action-button[data-variant="neutralSolid"]:is(:active, [data-active])) {
			background: var(--bg-neutral-inverted-pressed);
		}
	}
	:global(.seed-action-button[data-variant="neutralSolid"]:is(:disabled, [disabled], [data-disabled])) {
		background: var(--bg-disabled);
		color: var(--fg-disabled);
		--seed-prefix-icon-color: var(--fg-disabled);
		--seed-suffix-icon-color: var(--fg-disabled);
		--seed-icon-color: var(--fg-disabled);
	}
	:global(.seed-action-button[data-variant="neutralSolid"][data-loading]) {
		background: var(--bg-neutral-inverted-pressed);
	}
	:global(.seed-action-button[data-variant="neutralWeak"]) {
		background: var(--bg-neutral-weak);
		color: var(--fg-neutral);
		font-weight: var(--font-weight-bold);
		--seed-prefix-icon-color: var(--fg-neutral);
		--seed-suffix-icon-color: var(--fg-neutral);
		--seed-icon-color: var(--fg-neutral);
		--track-color: var(--palette-gray-500);
		--range-color: var(--fg-neutral);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-action-button[data-variant="neutralWeak"]:is(:hover, [data-hover])) {
			background: var(--bg-neutral-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-action-button[data-variant="neutralWeak"]:is(:active, [data-active])) {
			background: var(--bg-neutral-weak-pressed);
		}
	}
	:global(.seed-action-button[data-variant="neutralWeak"]:is(:disabled, [disabled], [data-disabled])) {
		background: var(--bg-disabled);
		color: var(--fg-disabled);
		--seed-prefix-icon-color: var(--fg-disabled);
		--seed-suffix-icon-color: var(--fg-disabled);
		--seed-icon-color: var(--fg-disabled);
	}
	:global(.seed-action-button[data-variant="neutralWeak"][data-loading]) {
		background: var(--bg-neutral-weak-pressed);
	}
	:global(.seed-action-button[data-variant="criticalSolid"]) {
		background: var(--bg-critical-solid);
		color: var(--palette-static-white);
		font-weight: var(--font-weight-bold);
		--seed-prefix-icon-color: var(--palette-static-white);
		--seed-suffix-icon-color: var(--palette-static-white);
		--seed-icon-color: var(--palette-static-white);
		--track-color: var(--palette-static-white-alpha-300);
		--range-color: var(--palette-static-white);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-action-button[data-variant="criticalSolid"]:is(:hover, [data-hover])) {
			background: var(--bg-critical-solid-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-action-button[data-variant="criticalSolid"]:is(:active, [data-active])) {
			background: var(--bg-critical-solid-pressed);
		}
	}
	:global(.seed-action-button[data-variant="criticalSolid"]:is(:disabled, [disabled], [data-disabled])) {
		background: var(--bg-disabled);
		color: var(--fg-disabled);
		--seed-prefix-icon-color: var(--fg-disabled);
		--seed-suffix-icon-color: var(--fg-disabled);
		--seed-icon-color: var(--fg-disabled);
	}
	:global(.seed-action-button[data-variant="criticalSolid"][data-loading]) {
		background: var(--bg-critical-solid-pressed);
	}
	:global(.seed-action-button[data-variant="brandOutline"]) {
		border-style: solid;
		background: var(--bg-transparent);
		border-width: 1px;
		border-color: var(--stroke-neutral-muted);
		color: var(--fg-brand);
		font-weight: var(--font-weight-bold);
		--seed-prefix-icon-color: var(--fg-brand);
		--seed-suffix-icon-color: var(--fg-brand);
		--seed-icon-color: var(--fg-brand);
		--track-color: var(--palette-carrot-200);
		--range-color: var(--bg-brand-solid);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-action-button[data-variant="brandOutline"]:is(:hover, [data-hover])) {
			background: var(--bg-transparent-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-action-button[data-variant="brandOutline"]:is(:active, [data-active])) {
			background: var(--bg-transparent-pressed);
		}
	}
	:global(.seed-action-button[data-variant="brandOutline"]:is(:disabled, [disabled], [data-disabled])) {
		background: var(--bg-transparent);
		border-color: var(--stroke-neutral-muted);
		color: var(--fg-disabled);
		--seed-prefix-icon-color: var(--fg-disabled);
		--seed-suffix-icon-color: var(--fg-disabled);
		--seed-icon-color: var(--fg-disabled);
	}
	:global(.seed-action-button[data-variant="brandOutline"][data-loading]) {
		background: var(--bg-transparent);
	}
	:global(.seed-action-button[data-variant="neutralOutline"]) {
		border-style: solid;
		background: var(--bg-transparent);
		border-width: 1px;
		border-color: var(--stroke-neutral-muted);
		color: var(--fg-neutral);
		font-weight: var(--font-weight-bold);
		--seed-prefix-icon-color: var(--fg-neutral);
		--seed-suffix-icon-color: var(--fg-neutral);
		--seed-icon-color: var(--fg-neutral);
		--track-color: var(--palette-gray-500);
		--range-color: var(--fg-neutral);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-action-button[data-variant="neutralOutline"]:is(:hover, [data-hover])) {
			background: var(--bg-transparent-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-action-button[data-variant="neutralOutline"]:is(:active, [data-active])) {
			background: var(--bg-transparent-pressed);
		}
	}
	:global(.seed-action-button[data-variant="neutralOutline"]:is(:disabled, [disabled], [data-disabled])) {
		background: var(--bg-transparent);
		border-color: var(--stroke-neutral-muted);
		color: var(--fg-disabled);
		--seed-prefix-icon-color: var(--fg-disabled);
		--seed-suffix-icon-color: var(--fg-disabled);
		--seed-icon-color: var(--fg-disabled);
	}
	:global(.seed-action-button[data-variant="neutralOutline"][data-loading]) {
		background: var(--bg-transparent);
	}
	:global(.seed-action-button[data-variant="ghost"]) {
		background: #ffffff00;
		--seed-box-color: var(--fg-neutral);
		color: var(--seed-box-color);
		--seed-prefix-icon-color: var(--seed-box-color);
		--seed-suffix-icon-color: var(--seed-box-color);
		--seed-icon-color: var(--seed-box-color);
		--seed-font-weight: var(--font-weight-bold);
		font-weight: var(--seed-font-weight);
		--track-color: var(--palette-gray-500);
		--range-color: var(--fg-neutral);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-action-button[data-variant="ghost"]:is(:hover, [data-hover])) {
			background: var(--bg-transparent-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-action-button[data-variant="ghost"]:is(:active, [data-active])) {
			background: var(--bg-transparent-pressed);
		}
	}
	:global(.seed-action-button[data-variant="ghost"]:is(:disabled, [disabled], [data-disabled])) {
		background: #ffffff00;
		color: var(--fg-disabled);
		--seed-prefix-icon-color: var(--fg-disabled);
		--seed-suffix-icon-color: var(--fg-disabled);
		--seed-icon-color: var(--fg-disabled);
	}
	:global(.seed-action-button[data-variant="ghost"][data-loading]) {
		background: var(--bg-transparent-pressed);
	}
	:global(.seed-action-button[data-size="xsmall"]) {
		height: var(--dimension-x8);
		border-radius: var(--radius-full);
		--size: 14px;
		--thickness: 2px;
		--seed-prefix-icon-size: var(--dimension-x3-5);
		--seed-suffix-icon-size: var(--dimension-x3-5);
		--seed-icon-size: var(--dimension-x3-5);
	}
	:global(.seed-action-button[data-size="small"]) {
		height: var(--dimension-x9);
		border-radius: var(--radius-r2);
		--size: 14px;
		--thickness: 2px;
		--seed-prefix-icon-size: var(--dimension-x3-5);
		--seed-suffix-icon-size: var(--dimension-x3-5);
		--seed-icon-size: var(--dimension-x4);
	}
	:global(.seed-action-button[data-size="medium"]) {
		height: var(--dimension-x10);
		border-radius: var(--radius-r2);
		--size: 16px;
		--thickness: 2px;
		--seed-prefix-icon-size: var(--dimension-x4);
		--seed-suffix-icon-size: var(--dimension-x4);
		--seed-icon-size: 18px;
	}
	:global(.seed-action-button[data-size="large"]) {
		height: var(--dimension-x13);
		border-radius: var(--radius-r3);
		--size: 18px;
		--thickness: 2px;
		--seed-prefix-icon-size: 22px;
		--seed-suffix-icon-size: 22px;
		--seed-icon-size: 22px;
	}
	:global(.seed-action-button[data-layout="withText"]) {

	}
	:global(.seed-action-button[data-layout="iconOnly"]) {

	}
	:global(.seed-action-button[data-size="xsmall"][data-layout="withText"]) {
		gap: var(--dimension-x1);
		--seed-box-padding-left: var(--dimension-x3-5);
		--seed-box-padding-right: var(--dimension-x3-5);
		--seed-box-padding-top: var(--dimension-x1-5);
		--seed-box-padding-bottom: var(--dimension-x1-5);
		font-size: var(--text-t3);
		line-height: var(--text-t3--line-height);
	}
	:global(.seed-action-button[data-size="xsmall"][data-layout="iconOnly"]) {
		min-width: var(--dimension-x8);
		--seed-box-padding-left: var(--dimension-x1-5);
		--seed-box-padding-right: var(--dimension-x1-5);
		--seed-box-padding-top: var(--dimension-x1-5);
		--seed-box-padding-bottom: var(--dimension-x1-5);
	}
	:global(.seed-action-button[data-size="small"][data-layout="withText"]) {
		gap: var(--dimension-x1);
		--seed-box-padding-left: var(--dimension-x3-5);
		--seed-box-padding-right: var(--dimension-x3-5);
		--seed-box-padding-top: var(--dimension-x2);
		--seed-box-padding-bottom: var(--dimension-x2);
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
	}
	:global(.seed-action-button[data-size="small"][data-layout="iconOnly"]) {
		min-width: var(--dimension-x9);
		--seed-box-padding-left: var(--dimension-x2);
		--seed-box-padding-right: var(--dimension-x2);
		--seed-box-padding-top: var(--dimension-x2);
		--seed-box-padding-bottom: var(--dimension-x2);
	}
	:global(.seed-action-button[data-size="medium"][data-layout="withText"]) {
		gap: var(--dimension-x1-5);
		--seed-box-padding-left: var(--dimension-x4);
		--seed-box-padding-right: var(--dimension-x4);
		--seed-box-padding-top: var(--dimension-x2-5);
		--seed-box-padding-bottom: var(--dimension-x2-5);
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
	}
	:global(.seed-action-button[data-size="medium"][data-layout="iconOnly"]) {
		min-width: var(--dimension-x10);
		--seed-box-padding-left: var(--dimension-x2-5);
		--seed-box-padding-right: var(--dimension-x2-5);
		--seed-box-padding-top: var(--dimension-x2-5);
		--seed-box-padding-bottom: var(--dimension-x2-5);
	}
	:global(.seed-action-button[data-size="large"][data-layout="withText"]) {
		gap: var(--dimension-x2);
		--seed-box-padding-left: var(--dimension-x5);
		--seed-box-padding-right: var(--dimension-x5);
		--seed-box-padding-top: var(--dimension-x3-5);
		--seed-box-padding-bottom: var(--dimension-x3-5);
		font-size: var(--text-t6);
		line-height: var(--text-t6--line-height);
	}
	:global(.seed-action-button[data-size="large"][data-layout="iconOnly"]) {
		min-width: var(--dimension-x13);
		--seed-box-padding-left: var(--dimension-x3-5);
		--seed-box-padding-right: var(--dimension-x3-5);
		--seed-box-padding-top: var(--dimension-x3-5);
		--seed-box-padding-bottom: var(--dimension-x3-5);
	}
	@media (min-width: 480px) {
		:global(.seed-action-button) {
			--seed-box-bleed-bottom: var(--seed-box-bleed-bottom-sm, initial);
			--seed-box-bleed-top: var(--seed-box-bleed-top-sm, initial);
			--seed-box-bleed-left: var(--seed-box-bleed-left-sm, initial);
			--seed-box-bleed-right: var(--seed-box-bleed-right-sm, initial);
		}
	}
	@media (min-width: 768px) {
		:global(.seed-action-button) {
			--seed-box-bleed-bottom: var(--seed-box-bleed-bottom-md, initial);
			--seed-box-bleed-top: var(--seed-box-bleed-top-md, initial);
			--seed-box-bleed-left: var(--seed-box-bleed-left-md, initial);
			--seed-box-bleed-right: var(--seed-box-bleed-right-md, initial);
		}
	}
	@media (min-width: 1280px) {
		:global(.seed-action-button) {
			--seed-box-bleed-bottom: var(--seed-box-bleed-bottom-lg, initial);
			--seed-box-bleed-top: var(--seed-box-bleed-top-lg, initial);
			--seed-box-bleed-left: var(--seed-box-bleed-left-lg, initial);
			--seed-box-bleed-right: var(--seed-box-bleed-right-lg, initial);
		}
	}
	@media (min-width: 1440px) {
		:global(.seed-action-button) {
			--seed-box-bleed-bottom: var(--seed-box-bleed-bottom-xl, initial);
			--seed-box-bleed-top: var(--seed-box-bleed-top-xl, initial);
			--seed-box-bleed-left: var(--seed-box-bleed-left-xl, initial);
			--seed-box-bleed-right: var(--seed-box-bleed-right-xl, initial);
		}
	}
	/* @end recipe */
</style>
