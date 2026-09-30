<!-- SEED FloatingActionButton (seed-design.io/react/components/floating-action-button).
     extended  true = icon + label pill; false collapses to the round icon button (label fades)
     Place it with position: absolute/fixed (docs: Float bottom-end, offset x4). -->
<script lang="ts">
	import type { Component } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import { scaleFeedback } from "./seed.ts";

	let {
		icon: Icon,
		label,
		extended = true,
		...rest
	}: { icon: Component; label: string; extended?: boolean } & HTMLButtonAttributes = $props();
</script>

<button
	type="button"
	aria-label={extended ? undefined : label}
	{...rest}
	class="seed-floating-action-button__root seed-scale-feedback"
	data-extended={String(extended)}
	{@attach scaleFeedback}
>
	<Icon class="seed-floating-action-button__icon" data-extended={String(extended)} aria-hidden="true" />
	<span class="seed-floating-action-button__label" data-extended={String(extended)}>{label}</span>
</button>

<style>
	/* @recipe floating-action-button */
	/* SEED recipe: floating-action-button */
	:global(.seed-floating-action-button__root) {
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
	:global(.seed-floating-action-button__root:is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-floating-action-button__root:is(:disabled, [disabled], [data-disabled])) {
		cursor: not-allowed;
	}
	:global(.seed-floating-action-button__root) {
		position: relative;
		overflow: hidden;
		background: var(--bg-brand-solid);
		border-radius: var(--radius-full);
		box-shadow: var(--shadow-s3);
		color: var(--palette-static-white);
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		font-weight: var(--font-weight-bold);
	}
	:global(.seed-floating-action-button__root:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
		scale: var(--feedback-scale);
	}
	:global(.seed-floating-action-button__root) {
		transition: background-color var(--duration-color-transition) var(--ease-easing), max-width var(--duration-d4) var(--ease-easing), height var(--duration-d4) var(--ease-easing), padding var(--duration-d4) var(--ease-easing), scale var(--duration-pressed-scale) var(--ease-pressed-scale), outline-color var(--duration-d3) var(--ease-easing);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-floating-action-button__root:is(:hover, [data-hover])) {
			background: var(--bg-brand-solid-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-floating-action-button__root:is(:active, [data-active])) {
			background: var(--bg-brand-solid-pressed);
		}
	}
	:global(.seed-floating-action-button__icon) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--palette-static-white);
		transition: margin-right var(--duration-d4) var(--ease-easing), width var(--duration-d4) var(--ease-easing), height var(--duration-d4) var(--ease-easing);
	}
	:global(.seed-floating-action-button__label) {
		word-break: keep-all;
		white-space: nowrap;
		overflow: hidden;
	}
	:global(.seed-floating-action-button__root[data-extended="true"]) {
		padding-inline: var(--dimension-x4-5);
		height: 48px;
		width: fit-content;
		max-width: 999px;
	}
	:global(.seed-floating-action-button__icon[data-extended="true"]) {
		width: var(--dimension-x4);
		height: var(--dimension-x4);
		margin-right: var(--dimension-x1);
		transition: none;
	}
	:global(.seed-floating-action-button__root[data-extended="false"]) {
		padding: 0;
		min-width: 56px;
		max-width: 56px;
		height: 56px;
	}
	:global(.seed-floating-action-button__icon[data-extended="false"]) {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: var(--dimension-x6);
		height: var(--dimension-x6);
	}
	:global(.seed-floating-action-button__label[data-extended="false"]) {
		opacity: 0;
	}
	/* @end recipe */
</style>
