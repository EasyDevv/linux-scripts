<!-- SEED Callout (seed-design.io/react/components/callout).
     r10 box, p14, gap 12; title t4 bold + description t4; optional link button; tone neutral · informative
     · positive · warning · critical · magic (glow gradient).
     kind   static (div) · actionable (<button> + chevron) · dismissible (close button). -->
<script lang="ts">
	import type { Component } from "svelte";
	import { scaleFeedback, variants } from "./seed.ts";

	let {
		tone = "neutral",
		kind = "static",
		prefixIcon: PrefixIcon,
		title,
		description,
		link,
		onLink,
		onClick,
		onClose,
	}: {
		tone?: "neutral" | "informative" | "positive" | "warning" | "critical" | "magic";
		kind?: "static" | "actionable" | "dismissible";
		prefixIcon?: Component;
		title?: string;
		description: string;
		/** inline link label after the description */
		link?: string;
		onLink?: () => void;
		onClick?: () => void;
		onClose?: () => void;
	} = $props();

	const v = $derived(variants({ tone }));
</script>

{#snippet body()}
	{#if PrefixIcon}<PrefixIcon class="seed-prefix-icon" aria-hidden="true" />{/if}
	<div class="seed-callout__content" {...v}>
		{#if title}<span class="seed-callout__title" {...v}>{title}</span>{/if}
		<span class="seed-callout__description" {...v}>{description}</span>
		{#if link}<button type="button" class="seed-callout__link" {...v} onclick={onLink}>{link}</button>{/if}
	</div>
{/snippet}

{#if kind === "actionable"}
	<button type="button" class="seed-callout__root seed-scale-feedback" {...v} onclick={onClick} {@attach scaleFeedback}>
		{@render body()}
		<svg class="seed-suffix-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5.5l6.5 6.5L9 18.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
	</button>
{:else}
	<div class="seed-callout__root seed-scale-feedback" {...v} {@attach scaleFeedback}>
		{@render body()}
		{#if kind === "dismissible"}
			<button type="button" class="seed-callout__closeButton seed-scale-feedback" {...v} aria-label="닫기" onclick={onClose} {@attach scaleFeedback}>
				<svg class="seed-suffix-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
			</button>
		{/if}
	</div>
{/if}

<style>
	/* @recipe callout */
	/* SEED recipe: callout */
	:global(.seed-callout__root) {
		border: none;
		box-sizing: border-box;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		font-family: inherit;
		font-size: unset;
		display: flex;
		align-items: center;
		text-align: start;
		width: 100%;
		min-height: 50px;
		padding-inline: var(--dimension-x3-5);
		padding-block: var(--dimension-x3-5);
		gap: var(--dimension-x3);
		border-radius: var(--radius-r2-5);
		text-decoration: none;
		--seed-prefix-icon-size: var(--dimension-x4);
		--seed-suffix-icon-size: var(--dimension-x4);
	}
	:global(.seed-callout__root:is(button, a)) {
		cursor: pointer;
		transition: scale var(--duration-pressed-scale) var(--ease-pressed-scale), outline-color var(--duration-d3) var(--ease-easing);
	}
	:global(.seed-callout__root:is(button, a):is(:active, [data-active])) {
		scale: var(--feedback-scale);
	}
	:global(.seed-callout__root:is(button, a)) {
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-callout__root:is(button, a):is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-callout__content) {
		margin-right: auto;
		line-height: var(--text-t4--line-height);
	}
	:global(.seed-callout__title) {
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
		font-weight: var(--font-weight-bold);
	}
	:global(.seed-callout__title::after) {
		content: " ";
		white-space: pre;
	}
	:global(.seed-callout__description) {
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
		font-weight: var(--font-weight-regular);
	}
	:global(.seed-callout__description:not(:last-child)::after) {
		content: " ";
		white-space: pre;
	}
	:global(.seed-callout__link) {
		font-family: inherit;
		display: inline-block;
		background-color: transparent;
		padding: 0;
		border: none;
		cursor: pointer;
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
		font-weight: var(--font-weight-regular);
		text-decoration: underline;
		text-underline-offset: 2px;
		transition: outline-color var(--duration-d3) var(--ease-easing);
		border-radius: var(--radius-r1);
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-callout__link:is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-callout__closeButton) {
		border: none;
		background-color: var(--bg-transparent);
		padding: 0;
		cursor: pointer;
		flex-grow: 0;
		flex-shrink: 0;
		display: flex;
		justify-content: center;
		align-items: center;
		width: var(--dimension-x10);
		height: var(--dimension-x10);
		margin: calc((var(--dimension-x10) - var(--dimension-x4)) * -0.5);
		border-radius: var(--radius-r2);
		--seed-suffix-icon-size: var(--dimension-x4);
	}
	:global(.seed-callout__closeButton:is(:active, [data-active])) {
		scale: var(--feedback-scale);
	}
	:global(.seed-callout__closeButton) {
		transition: background-color var(--duration-color-transition) var(--ease-easing), scale var(--duration-pressed-scale) var(--ease-pressed-scale), outline-color var(--duration-d3) var(--ease-easing);
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-callout__closeButton:is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: var(--dimension-x0-5);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-callout__closeButton:is(:hover, [data-hover])) {
			background-color: var(--bg-transparent-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-callout__closeButton:is(:active, [data-active])) {
			background-color: var(--bg-transparent-pressed);
		}
	}
	:global(.seed-callout__root[data-tone="neutral"]) {
		background-color: var(--bg-neutral-weak);
		--seed-prefix-icon-color: var(--fg-neutral);
		--seed-suffix-icon-color: var(--fg-neutral);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-callout__root[data-tone="neutral"]:is(button, a):is(:hover, [data-hover])) {
			background-color: var(--bg-neutral-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-callout__root[data-tone="neutral"]:is(button, a):is(:active, [data-active])) {
			background-color: var(--bg-neutral-weak-pressed);
		}
	}
	:global(.seed-callout__title[data-tone="neutral"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-callout__description[data-tone="neutral"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-callout__link[data-tone="neutral"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-callout__closeButton[data-tone="neutral"]) {
		--seed-suffix-icon-color: var(--fg-neutral);
	}
	:global(.seed-callout__root[data-tone="informative"]) {
		background-color: var(--bg-informative-weak);
		--seed-prefix-icon-color: var(--fg-informative-contrast);
		--seed-suffix-icon-color: var(--fg-informative-contrast);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-callout__root[data-tone="informative"]:is(button, a):is(:hover, [data-hover])) {
			background-color: var(--bg-informative-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-callout__root[data-tone="informative"]:is(button, a):is(:active, [data-active])) {
			background-color: var(--bg-informative-weak-pressed);
		}
	}
	:global(.seed-callout__title[data-tone="informative"]) {
		color: var(--fg-informative-contrast);
	}
	:global(.seed-callout__description[data-tone="informative"]) {
		color: var(--fg-informative-contrast);
	}
	:global(.seed-callout__link[data-tone="informative"]) {
		color: var(--fg-informative-contrast);
	}
	:global(.seed-callout__closeButton[data-tone="informative"]) {
		--seed-suffix-icon-color: var(--fg-informative-contrast);
	}
	:global(.seed-callout__root[data-tone="positive"]) {
		background-color: var(--bg-positive-weak);
		--seed-prefix-icon-color: var(--fg-positive-contrast);
		--seed-suffix-icon-color: var(--fg-positive-contrast);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-callout__root[data-tone="positive"]:is(button, a):is(:hover, [data-hover])) {
			background-color: var(--bg-positive-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-callout__root[data-tone="positive"]:is(button, a):is(:active, [data-active])) {
			background-color: var(--bg-positive-weak-pressed);
		}
	}
	:global(.seed-callout__title[data-tone="positive"]) {
		color: var(--fg-positive-contrast);
	}
	:global(.seed-callout__description[data-tone="positive"]) {
		color: var(--fg-positive-contrast);
	}
	:global(.seed-callout__link[data-tone="positive"]) {
		color: var(--fg-positive-contrast);
	}
	:global(.seed-callout__closeButton[data-tone="positive"]) {
		--seed-suffix-icon-color: var(--fg-positive-contrast);
	}
	:global(.seed-callout__root[data-tone="warning"]) {
		background-color: var(--bg-warning-weak);
		--seed-prefix-icon-color: var(--fg-warning-contrast);
		--seed-suffix-icon-color: var(--fg-warning-contrast);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-callout__root[data-tone="warning"]:is(button, a):is(:hover, [data-hover])) {
			background-color: var(--bg-warning-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-callout__root[data-tone="warning"]:is(button, a):is(:active, [data-active])) {
			background-color: var(--bg-warning-weak-pressed);
		}
	}
	:global(.seed-callout__title[data-tone="warning"]) {
		color: var(--fg-warning-contrast);
	}
	:global(.seed-callout__description[data-tone="warning"]) {
		color: var(--fg-warning-contrast);
	}
	:global(.seed-callout__link[data-tone="warning"]) {
		color: var(--fg-warning-contrast);
	}
	:global(.seed-callout__closeButton[data-tone="warning"]) {
		--seed-suffix-icon-color: var(--fg-warning-contrast);
	}
	:global(.seed-callout__root[data-tone="critical"]) {
		background-color: var(--bg-critical-weak);
		--seed-prefix-icon-color: var(--fg-critical-contrast);
		--seed-suffix-icon-color: var(--fg-critical-contrast);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-callout__root[data-tone="critical"]:is(button, a):is(:hover, [data-hover])) {
			background-color: var(--bg-critical-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-callout__root[data-tone="critical"]:is(button, a):is(:active, [data-active])) {
			background-color: var(--bg-critical-weak-pressed);
		}
	}
	:global(.seed-callout__title[data-tone="critical"]) {
		color: var(--fg-critical-contrast);
	}
	:global(.seed-callout__description[data-tone="critical"]) {
		color: var(--fg-critical-contrast);
	}
	:global(.seed-callout__link[data-tone="critical"]) {
		color: var(--fg-critical-contrast);
	}
	:global(.seed-callout__closeButton[data-tone="critical"]) {
		--seed-suffix-icon-color: var(--fg-critical-contrast);
	}
	:global(.seed-callout__root[data-tone="magic"]) {
		background-image: linear-gradient(88deg, var(--gradient-glow-magic));
		--seed-prefix-icon-color: var(--fg-neutral);
		--seed-suffix-icon-color: var(--fg-neutral);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-callout__root[data-tone="magic"]:is(button, a):is(:hover, [data-hover])) {
			background-image: linear-gradient(88deg, var(--gradient-glow-magic-pressed));
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-callout__root[data-tone="magic"]:is(button, a):is(:active, [data-active])) {
			background-image: linear-gradient(88deg, var(--gradient-glow-magic-pressed));
		}
	}
	:global(.seed-callout__title[data-tone="magic"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-callout__description[data-tone="magic"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-callout__link[data-tone="magic"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-callout__closeButton[data-tone="magic"]) {
		--seed-suffix-icon-color: var(--fg-neutral);
	}
	/* @end recipe */
</style>
