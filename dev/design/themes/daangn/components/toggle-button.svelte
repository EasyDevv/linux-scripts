<!-- SEED ToggleButton (seed-design.io/react/components/toggle-button).
     size    xsmall 32 / small 36, pill; label bold
     variant brandSolid (pressed = carrot fill) · neutralWeak (pressed = neutral-inverted)
     state   aria-pressed + data-pressed; disabled keeps aria-disabled; loading keeps the width
             under an inherited ProgressCircle. -->
<script lang="ts">
	import type { Component, Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import ProgressCircle from "./progress-circle.svelte";
	import { scaleFeedback, states, variants } from "./seed.ts";

	let {
		pressed = $bindable(false),
		variant = "brandSolid",
		size = "small",
		loading = false,
		disabled = false,
		prefixIcon: PrefixIcon,
		onPressedChange,
		children,
		...rest
	}: {
		pressed?: boolean;
		variant?: "brandSolid" | "neutralWeak";
		size?: "xsmall" | "small";
		loading?: boolean;
		disabled?: boolean;
		prefixIcon?: Component;
		/** called instead of flipping `pressed` (e.g. to await a request first) */
		onPressedChange?: (next: boolean) => void;
		children?: Snippet;
	} & HTMLButtonAttributes = $props();

	function toggle() {
		if (disabled) return;
		if (onPressedChange) onPressedChange(!pressed);
		else pressed = !pressed;
	}
</script>

{#snippet content()}
	{#if PrefixIcon}<PrefixIcon class="seed-prefix-icon" aria-hidden="true" />{/if}
	{@render children?.()}
{/snippet}

<button
	type="button"
	{...rest}
	class="seed-toggle-button seed-scale-feedback"
	{...variants({ variant, size })}
	{...states({ pressed, disabled, loading })}
	aria-pressed={pressed}
	aria-disabled={disabled || undefined}
	onclick={toggle}
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
	/* @recipe toggle-button */
	/* SEED recipe: toggle-button */
	:global(.seed-toggle-button) {
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
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-toggle-button:is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-toggle-button:is(:disabled, [disabled], [data-disabled])) {
		cursor: not-allowed;
	}
	:global(.seed-toggle-button:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
		scale: var(--feedback-scale);
	}
	:global(.seed-toggle-button) {
		transition: background-color var(--duration-color-transition) var(--ease-easing), scale var(--duration-pressed-scale) var(--ease-pressed-scale), outline-color var(--duration-d3) var(--ease-easing);
		font-weight: var(--font-weight-bold);
	}
	:global(.seed-toggle-button[data-variant="brandSolid"]) {
		background: var(--bg-brand-solid);
		color: var(--palette-static-white);
		--track-color: var(--palette-static-white-alpha-300);
		--range-color: var(--palette-static-white);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-toggle-button[data-variant="brandSolid"]:is(:hover, [data-hover])) {
			background: var(--bg-brand-solid-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-toggle-button[data-variant="brandSolid"]:is(:active, [data-active])) {
			background: var(--bg-brand-solid-pressed);
		}
	}
	:global(.seed-toggle-button[data-variant="brandSolid"]:is([aria-pressed=true], [data-pressed])) {
		background: var(--bg-neutral-weak);
		color: var(--fg-neutral);
		--track-color: var(--palette-gray-500);
		--range-color: var(--fg-neutral);
		--seed-prefix-icon-color: var(--fg-neutral);
		--seed-suffix-icon-color: var(--fg-neutral);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-toggle-button[data-variant="brandSolid"]:is([aria-pressed=true], [data-pressed]):is(:hover, [data-hover])) {
			background: var(--bg-neutral-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-toggle-button[data-variant="brandSolid"]:is([aria-pressed=true], [data-pressed]):is(:active, [data-active])) {
			background: var(--bg-neutral-weak-pressed);
		}
	}
	:global(.seed-toggle-button[data-variant="brandSolid"]:is(:disabled, [disabled], [data-disabled])) {
		background: var(--bg-disabled);
		color: var(--fg-disabled);
		--seed-prefix-icon-color: var(--fg-disabled);
		--seed-suffix-icon-color: var(--fg-disabled);
	}
	:global(.seed-toggle-button[data-variant="brandSolid"][data-loading]) {
		background: var(--bg-brand-solid-pressed);
	}
	:global(.seed-toggle-button[data-variant="brandSolid"]:is([aria-pressed=true], [data-pressed])[data-loading]) {
		background: var(--bg-neutral-weak-pressed);
	}
	:global(.seed-toggle-button[data-variant="brandSolid"]) {
		--seed-prefix-icon-color: var(--palette-static-white);
		--seed-suffix-icon-color: var(--palette-static-white);
	}
	:global(.seed-toggle-button[data-variant="neutralWeak"]) {
		background: var(--bg-neutral-weak);
		color: var(--fg-neutral);
		--track-color: var(--palette-gray-500);
		--range-color: var(--fg-neutral);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-toggle-button[data-variant="neutralWeak"]:is(:hover, [data-hover])) {
			background: var(--bg-neutral-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-toggle-button[data-variant="neutralWeak"]:is(:active, [data-active])) {
			background: var(--bg-neutral-weak-pressed);
		}
	}
	:global(.seed-toggle-button[data-variant="neutralWeak"]:is([aria-pressed=true], [data-pressed])) {
		background: var(--bg-neutral-weak);
		color: var(--fg-neutral);
		--track-color: var(--palette-gray-500);
		--range-color: var(--fg-neutral);
		--seed-prefix-icon-color: var(--fg-neutral);
		--seed-suffix-icon-color: var(--fg-neutral);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-toggle-button[data-variant="neutralWeak"]:is([aria-pressed=true], [data-pressed]):is(:hover, [data-hover])) {
			background: var(--bg-neutral-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-toggle-button[data-variant="neutralWeak"]:is([aria-pressed=true], [data-pressed]):is(:active, [data-active])) {
			background: var(--bg-neutral-weak-pressed);
		}
	}
	:global(.seed-toggle-button[data-variant="neutralWeak"]:is(:disabled, [disabled], [data-disabled])) {
		background: var(--bg-disabled);
		color: var(--fg-disabled);
		--seed-prefix-icon-color: var(--fg-disabled);
		--seed-suffix-icon-color: var(--fg-disabled);
	}
	:global(.seed-toggle-button[data-variant="neutralWeak"][data-loading]) {
		background: var(--bg-neutral-weak-pressed);
	}
	:global(.seed-toggle-button[data-variant="neutralWeak"]:is([aria-pressed=true], [data-pressed])[data-loading]) {
		background: var(--bg-neutral-weak-pressed);
	}
	:global(.seed-toggle-button[data-variant="neutralWeak"]) {
		--seed-prefix-icon-color: var(--fg-neutral);
		--seed-suffix-icon-color: var(--fg-neutral);
	}
	:global(.seed-toggle-button[data-size="xsmall"]) {
		height: var(--dimension-x8);
		border-radius: var(--radius-full);
		gap: var(--dimension-x1);
		padding-inline: var(--dimension-x3-5);
		padding-block: var(--dimension-x1-5);
		font-size: var(--text-t3);
		line-height: var(--text-t3--line-height);
		--size: 14px;
		--thickness: 2px;
		--seed-prefix-icon-size: var(--dimension-x3-5);
		--seed-suffix-icon-size: var(--dimension-x3-5);
	}
	:global(.seed-toggle-button[data-size="small"]) {
		height: var(--dimension-x9);
		border-radius: var(--radius-full);
		gap: var(--dimension-x1);
		padding-inline: var(--dimension-x4);
		padding-block: var(--dimension-x2);
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
		--size: 14px;
		--thickness: 2px;
		--seed-prefix-icon-size: var(--dimension-x3-5);
		--seed-suffix-icon-size: var(--dimension-x3-5);
	}
	/* @end recipe */
</style>
