<!-- SEED ContextualFloatingButton (seed-design.io/react/components/contextual-floating-button).
     variant solid (neutral-inverted) · layer (floating layer + s2 shadow); withText / iconOnly
     loading keeps the width under an inherited ProgressCircle. Docs place it bottom-center, offset x4. -->
<script lang="ts">
	import type { Component, Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import ProgressCircle from "./progress-circle.svelte";
	import { scaleFeedback, states, variants } from "./seed.ts";

	let {
		variant = "solid",
		loading = false,
		disabled = false,
		prefixIcon: PrefixIcon,
		icon: IconOnly,
		children,
		...rest
	}: {
		variant?: "solid" | "layer";
		loading?: boolean;
		disabled?: boolean;
		prefixIcon?: Component;
		/** icon-only layout; give the button an aria-label */
		icon?: Component;
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
	{/if}
{/snippet}

<button
	type="button"
	{...rest}
	{disabled}
	class="seed-contextual-floating-button seed-scale-feedback"
	{...variants({ variant, layout })}
	{...states({ loading, disabled })}
	{@attach scaleFeedback}
>
	{#if loading}
		<span class="seed-loading-indicator" {...states({ loading, disabled })}><ProgressCircle size="inherit" tone="inherit" /></span>
		<span style="opacity: 0; display: inherit; gap: inherit">{@render content()}</span>
	{:else}
		{@render content()}
	{/if}
</button>

<style>
	/* @recipe contextual-floating-button */
	/* SEED recipe: contextual-floating-button */
	:global(.seed-contextual-floating-button) {
		display: inline-flex;
		box-sizing: border-box;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		border: none;
		text-transform: none;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		text-decoration: none;
		font-family: inherit;
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-contextual-floating-button:is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-contextual-floating-button:is(:disabled, [disabled], [data-disabled])) {
		cursor: not-allowed;
	}
	:global(.seed-contextual-floating-button) {
		border-radius: var(--radius-full);
		box-shadow: var(--shadow-s3);
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
		font-weight: var(--font-weight-medium);
		--seed-box-z-index: initial;
		z-index: var(--seed-box-z-index);
		--seed-box-position: initial;
		position: var(--seed-box-position);
		--seed-box-top: initial;
		--seed-box-right: initial;
		--seed-box-bottom: initial;
		--seed-box-left: initial;
		top: var(--seed-box-top);
		right: var(--seed-box-right);
		bottom: var(--seed-box-bottom);
		left: var(--seed-box-left);
		--seed-icon-size: 22px;
		--size: 16px;
		--thickness: 2px;
	}
	:global(.seed-contextual-floating-button:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
		scale: var(--feedback-scale);
	}
	:global(.seed-contextual-floating-button) {
		transition: background-color var(--duration-color-transition) var(--ease-easing), scale var(--duration-pressed-scale) var(--ease-pressed-scale), outline-color var(--duration-d3) var(--ease-easing);
	}
	:global(.seed-contextual-floating-button[data-variant="solid"]) {
		background: var(--bg-neutral-inverted);
		color: var(--fg-neutral-inverted);
		--seed-icon-color: var(--fg-neutral-inverted);
		--seed-prefix-icon-color: var(--fg-neutral-inverted);
		--track-color: var(--palette-gray-700);
		--range-color: var(--fg-neutral-inverted);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-contextual-floating-button[data-variant="solid"]:is(:hover, [data-hover])) {
			background: var(--bg-neutral-inverted-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-contextual-floating-button[data-variant="solid"]:is(:active, [data-active])) {
			background: var(--bg-neutral-inverted-pressed);
		}
	}
	:global(.seed-contextual-floating-button[data-variant="solid"]:is(:disabled, [disabled], [data-disabled])) {
		background: var(--bg-disabled);
		color: var(--fg-disabled);
		--seed-prefix-icon-color: var(--fg-disabled);
		--seed-icon-color: var(--fg-disabled);
	}
	:global(.seed-contextual-floating-button[data-variant="solid"][data-loading]) {
		background: var(--bg-neutral-inverted-pressed);
	}
	:global(.seed-contextual-floating-button[data-variant="layer"]) {
		background: var(--bg-layer-floating);
		color: var(--fg-neutral);
		--seed-icon-color: var(--fg-neutral);
		--seed-prefix-icon-color: var(--fg-neutral);
		--track-color: var(--palette-gray-500);
		--range-color: var(--fg-neutral);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-contextual-floating-button[data-variant="layer"]:is(:hover, [data-hover])) {
			background: var(--bg-layer-floating-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-contextual-floating-button[data-variant="layer"]:is(:active, [data-active])) {
			background: var(--bg-layer-floating-pressed);
		}
	}
	:global(.seed-contextual-floating-button[data-variant="layer"]:is(:disabled, [disabled], [data-disabled])) {
		background: var(--bg-disabled);
		color: var(--fg-disabled);
		--seed-prefix-icon-color: var(--fg-disabled);
		--seed-icon-color: var(--fg-disabled);
	}
	:global(.seed-contextual-floating-button[data-variant="layer"][data-loading]) {
		background: var(--bg-layer-floating-pressed);
	}
	:global(.seed-contextual-floating-button[data-layout="withText"]) {
		min-height: 36px;
		padding-inline: var(--dimension-x3-5);
		padding-block: var(--dimension-x2);
		gap: var(--dimension-x1);
		--seed-prefix-icon-size: 16px;
	}
	:global(.seed-contextual-floating-button[data-layout="iconOnly"]) {
		width: 44px;
		height: 44px;
		--seed-icon-size: 22px;
	}
	/* @end recipe */
</style>
