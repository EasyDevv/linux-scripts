<!-- SEED ReactionButton (seed-design.io/react/components/reaction-button).
     size   xsmall 32 / small 36, pill, neutral-weak-alpha outline look; label + .seed-count (bold)
     state  aria-pressed / data-pressed paints the brand-weak fill + fg-brand; disabled, loading. -->
<script lang="ts">
	import type { Component, Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import ProgressCircle from "./progress-circle.svelte";
	import { scaleFeedback, states, variants } from "./seed.ts";

	let {
		pressed = $bindable(false),
		size = "small",
		count,
		loading = false,
		disabled = false,
		prefixIcon: PrefixIcon,
		onPressedChange,
		children,
		...rest
	}: {
		pressed?: boolean;
		size?: "xsmall" | "small";
		count?: number | string;
		loading?: boolean;
		disabled?: boolean;
		prefixIcon?: Component;
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
	{#if count !== undefined}<span class="seed-count">{count}</span>{/if}
{/snippet}

<button
	type="button"
	{...rest}
	class="seed-reaction-button seed-scale-feedback"
	{...variants({ size })}
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
	/* @recipe reaction-button */
	/* SEED recipe: reaction-button */
	:global(.seed-reaction-button) {
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
	:global(.seed-reaction-button:is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-reaction-button:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
		scale: var(--feedback-scale);
	}
	:global(.seed-reaction-button) {
		transition: background-color var(--duration-color-transition) var(--ease-easing), box-shadow var(--duration-color-transition) var(--ease-easing), scale var(--duration-pressed-scale) var(--ease-pressed-scale), outline-color var(--duration-d3) var(--ease-easing);
		background: var(--bg-transparent);
		font-weight: var(--font-weight-medium);
		color: var(--fg-neutral);
		box-shadow: inset 0 0 0 1px var(--stroke-neutral-muted);
		--track-color: var(--palette-gray-500);
		--range-color: var(--fg-neutral);
		--seed-count-font-weight: var(--font-weight-bold);
		--seed-count-color: var(--fg-neutral);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-reaction-button:is(:hover, [data-hover])) {
			background: var(--bg-transparent-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-reaction-button:is(:active, [data-active])) {
			background: var(--bg-transparent-pressed);
		}
	}
	:global(.seed-reaction-button:is([aria-pressed=true], [data-pressed])) {
		background: var(--bg-transparent);
		color: var(--fg-brand);
		box-shadow: inset 0 0 0 1px var(--stroke-brand-weak);
		--seed-prefix-icon-color: var(--fg-brand);
		--seed-count-color: var(--fg-brand);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-reaction-button:is([aria-pressed=true], [data-pressed]):is(:hover, [data-hover])) {
			background: var(--bg-transparent-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-reaction-button:is([aria-pressed=true], [data-pressed]):is(:active, [data-active])) {
			background: var(--bg-transparent-pressed);
		}
	}
	:global(.seed-reaction-button:is(:disabled, [disabled], [data-disabled])) {
		cursor: not-allowed;
		background: var(--bg-disabled);
		color: var(--fg-disabled);
		box-shadow: inset 0 0 0 0px var(--stroke-brand-weak);
		--seed-prefix-icon-color: var(--fg-disabled);
		--seed-count-color: var(--fg-disabled);
	}
	:global(.seed-reaction-button[data-loading]) {
		background: var(--bg-neutral-weak-pressed);
	}
	:global(.seed-reaction-button:is([aria-pressed=true], [data-pressed])[data-loading]) {
		background: var(--bg-transparent-pressed);
		box-shadow: inset 0 0 0 1px var(--stroke-brand-weak);
		--track-color: var(--palette-carrot-200);
		--range-color: var(--fg-brand);
	}
	:global(.seed-reaction-button[data-size="xsmall"]) {
		height: var(--dimension-x8);
		padding-inline: var(--dimension-x3);
		padding-block: var(--dimension-x1-5);
		gap: var(--dimension-x1);
		border-radius: var(--radius-full);
		font-size: var(--text-t3);
		line-height: var(--text-t3--line-height);
		--size: 14px;
		--thickness: 2px;
		--seed-count-font-size: var(--text-t3);
		--seed-count-line-height: var(--text-t3--line-height);
		--seed-prefix-icon-size: 18px;
	}
	:global(.seed-reaction-button[data-size="small"]) {
		height: var(--dimension-x9);
		padding-inline: var(--dimension-x3-5);
		padding-block: var(--dimension-x2);
		gap: var(--dimension-x1);
		border-radius: var(--radius-full);
		font-size: var(--text-t3);
		line-height: var(--text-t3--line-height);
		--size: 14px;
		--thickness: 2px;
		--seed-count-font-size: var(--text-t3);
		--seed-count-line-height: var(--text-t3--line-height);
		--seed-prefix-icon-size: 18px;
	}
	/* @end recipe */
</style>
