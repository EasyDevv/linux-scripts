<!-- SEED PageBanner (seed-design.io/react/components/page-banner): full-width tinted strip under the
     app bar — px16 py12, title t4 bold + description t4, optional trailing button or close, tones like
     Callout. kind static · actionable (<button> + chevron) · dismissible. -->
<script lang="ts">
	import type { Component } from "svelte";
	import { variants } from "./seed.ts";

	let {
		tone = "neutral",
		variant = "weak",
		kind = "static",
		prefixIcon: PrefixIcon,
		title,
		description,
		button,
		onButton,
		onClick,
		onClose,
	}: {
		tone?: "neutral" | "informative" | "positive" | "warning" | "critical" | "magic";
		variant?: "weak" | "solid";
		kind?: "static" | "actionable" | "dismissible";
		prefixIcon?: Component;
		title?: string;
		description: string;
		/** trailing text button label */
		button?: string;
		onButton?: () => void;
		onClick?: () => void;
		onClose?: () => void;
	} = $props();

	const v = $derived(variants({ tone, variant }));
</script>

{#snippet body()}
	{#if PrefixIcon}<PrefixIcon class="seed-prefix-icon" aria-hidden="true" />{/if}
	<div class="seed-page-banner__content" {...v}>
		<div class="seed-page-banner__body" {...v}>
			{#if title}<span class="seed-page-banner__title" {...v}>{title}</span>{/if}
			<span class="seed-page-banner__description" {...v}>{description}</span>
		</div>
		{#if button}<button type="button" class="seed-page-banner__button" {...v} onclick={onButton}>{button}</button>{/if}
	</div>
{/snippet}

{#if kind === "actionable"}
	<button type="button" class="seed-page-banner__root" {...v} onclick={onClick}>
		{@render body()}
		<svg class="seed-suffix-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5.5l6.5 6.5L9 18.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
	</button>
{:else}
	<div class="seed-page-banner__root" {...v}>
		{@render body()}
		{#if kind === "dismissible"}
			<button type="button" class="seed-page-banner__closeButton" {...v} aria-label="닫기" onclick={onClose}>
				<svg class="seed-suffix-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
			</button>
		{/if}
	</div>
{/if}

<style>
	/* @recipe page-banner */
	/* SEED recipe: page-banner */
	:global(.seed-page-banner__root) {
		box-sizing: border-box;
		border: none;
		font-family: inherit;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		font-size: unset;
		display: flex;
		align-items: flex-start;
		text-align: start;
		width: 100%;
		min-height: var(--dimension-x10);
		padding-inline: var(--dimension-x4);
		padding-block: var(--dimension-x2-5);
		--seed-prefix-icon-size: var(--dimension-x4);
		--seed-prefix-icon-margin-right: var(--dimension-x2);
		--seed-prefix-icon-margin-top: calc((var(--dimension-x10) - var(--dimension-x4)) * 0.5 - var(--dimension-x2-5));
		--seed-suffix-icon-size: var(--dimension-x4);
		--seed-suffix-icon-margin-left: var(--dimension-x2);
		--seed-suffix-icon-align-self: center;
	}
	:global(.seed-page-banner__root:is(button)) {
		cursor: pointer;
		transition: outline-color var(--duration-d3) var(--ease-easing);
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: calc(var(--dimension-x0-5) * -1);
	}
	:global(.seed-page-banner__root:is(button):is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: calc(var(--dimension-x0-5) * -1);
	}
	:global(.seed-page-banner__content) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		flex-grow: 1;
		gap: var(--dimension-x1-5);
	}
	:global(.seed-page-banner__body) {
		line-height: var(--text-t4--line-height);
		flex-grow: 1;
	}
	:global(.seed-page-banner__title) {
		flex-shrink: 0;
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
		font-weight: var(--font-weight-bold);
	}
	:global(.seed-page-banner__title::after) {
		content: " ";
		white-space: pre;
	}
	:global(.seed-page-banner__description) {
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
		font-weight: var(--font-weight-medium);
	}
	:global(.seed-page-banner__button) {
		font-family: inherit;
		border: none;
		background-color: transparent;
		cursor: pointer;
		display: flex;
		align-items: center;
		margin: calc((var(--dimension-x10) - var(--text-t3--line-height)) * 0.5 * -1);
		padding: calc((var(--dimension-x10) - var(--text-t3--line-height)) * 0.5);
		font-size: var(--text-t3);
		line-height: var(--text-t3--line-height);
		font-weight: var(--font-weight-bold);
		border-radius: var(--radius-r1);
	}
	:global(.seed-page-banner__button:is(:active, [data-active])) {
		scale: var(--feedback-scale);
	}
	:global(.seed-page-banner__button) {
		transition: scale var(--duration-pressed-scale) var(--ease-pressed-scale), outline-color var(--duration-d3) var(--ease-easing);
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: calc(var(--dimension-x0-5) * -1);
	}
	:global(.seed-page-banner__button:is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: calc(var(--dimension-x0-5) * -1);
	}
	:global(.seed-page-banner__closeButton) {
		flex-shrink: 0;
		flex-grow: 0;
		display: flex;
		justify-content: center;
		align-items: center;
		width: var(--dimension-x10);
		height: var(--dimension-x10);
		margin: calc((var(--dimension-x10) - var(--dimension-x4)) * -0.5);
		margin-left: calc((var(--dimension-x10) - var(--dimension-x4)) * -0.5 + var(--dimension-x2));
		--seed-suffix-icon-margin-left: initial;
		align-self: center;
		border: none;
		background-color: var(--bg-transparent);
		padding: 0;
		cursor: pointer;
		border-radius: var(--radius-r2);
		--seed-suffix-icon-size: var(--dimension-x4);
	}
	:global(.seed-page-banner__closeButton:is(:active, [data-active])) {
		scale: var(--feedback-scale);
	}
	:global(.seed-page-banner__closeButton) {
		transition: background-color var(--duration-color-transition) var(--ease-easing), scale var(--duration-pressed-scale) var(--ease-pressed-scale), outline-color var(--duration-d3) var(--ease-easing);
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: calc(var(--dimension-x0-5) * -1);
	}
	:global(.seed-page-banner__closeButton:is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: calc(var(--dimension-x0-5) * -1);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__closeButton:is(:hover, [data-hover])) {
			background-color: var(--bg-transparent-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__closeButton:is(:active, [data-active])) {
			background-color: var(--bg-transparent-pressed);
		}
	}
	:global(.seed-page-banner__root[data-tone="neutral"][data-variant="weak"]) {
		background-color: var(--bg-neutral-weak);
		--seed-prefix-icon-color: var(--fg-neutral);
		--seed-suffix-icon-color: var(--fg-neutral);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="neutral"][data-variant="weak"]:is(button):is(:hover, [data-hover])) {
			background-color: var(--bg-neutral-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="neutral"][data-variant="weak"]:is(button):is(:active, [data-active])) {
			background-color: var(--bg-neutral-weak-pressed);
		}
	}
	:global(.seed-page-banner__title[data-tone="neutral"][data-variant="weak"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-page-banner__description[data-tone="neutral"][data-variant="weak"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-page-banner__button[data-tone="neutral"][data-variant="weak"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-page-banner__closeButton[data-tone="neutral"][data-variant="weak"]) {
		--seed-suffix-icon-color: var(--fg-neutral);
	}
	:global(.seed-page-banner__root[data-tone="neutral"][data-variant="solid"]) {
		background-color: var(--bg-neutral-inverted);
		--seed-prefix-icon-color: var(--fg-neutral-inverted);
		--seed-suffix-icon-color: var(--fg-neutral-inverted);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="neutral"][data-variant="solid"]:is(button):is(:hover, [data-hover])) {
			background-color: var(--bg-neutral-inverted-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="neutral"][data-variant="solid"]:is(button):is(:active, [data-active])) {
			background-color: var(--bg-neutral-inverted-pressed);
		}
	}
	:global(.seed-page-banner__title[data-tone="neutral"][data-variant="solid"]) {
		color: var(--fg-neutral-inverted);
	}
	:global(.seed-page-banner__description[data-tone="neutral"][data-variant="solid"]) {
		color: var(--fg-neutral-inverted);
	}
	:global(.seed-page-banner__button[data-tone="neutral"][data-variant="solid"]) {
		color: var(--fg-neutral-inverted);
	}
	:global(.seed-page-banner__closeButton[data-tone="neutral"][data-variant="solid"]) {
		--seed-suffix-icon-color: var(--fg-neutral-inverted);
	}
	:global(.seed-page-banner__root[data-tone="informative"][data-variant="weak"]) {
		background-color: var(--bg-informative-weak);
		--seed-prefix-icon-color: var(--fg-informative-contrast);
		--seed-suffix-icon-color: var(--fg-informative-contrast);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="informative"][data-variant="weak"]:is(button):is(:hover, [data-hover])) {
			background-color: var(--bg-informative-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="informative"][data-variant="weak"]:is(button):is(:active, [data-active])) {
			background-color: var(--bg-informative-weak-pressed);
		}
	}
	:global(.seed-page-banner__title[data-tone="informative"][data-variant="weak"]) {
		color: var(--fg-informative-contrast);
	}
	:global(.seed-page-banner__description[data-tone="informative"][data-variant="weak"]) {
		color: var(--fg-informative-contrast);
	}
	:global(.seed-page-banner__button[data-tone="informative"][data-variant="weak"]) {
		color: var(--fg-informative-contrast);
	}
	:global(.seed-page-banner__closeButton[data-tone="informative"][data-variant="weak"]) {
		--seed-suffix-icon-color: var(--fg-informative-contrast);
	}
	:global(.seed-page-banner__root[data-tone="informative"][data-variant="solid"]) {
		background-color: var(--bg-informative-solid);
		--seed-prefix-icon-color: var(--palette-static-white);
		--seed-suffix-icon-color: var(--palette-static-white);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="informative"][data-variant="solid"]:is(button):is(:hover, [data-hover])) {
			background-color: var(--bg-informative-solid-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="informative"][data-variant="solid"]:is(button):is(:active, [data-active])) {
			background-color: var(--bg-informative-solid-pressed);
		}
	}
	:global(.seed-page-banner__title[data-tone="informative"][data-variant="solid"]) {
		color: var(--palette-static-white);
	}
	:global(.seed-page-banner__description[data-tone="informative"][data-variant="solid"]) {
		color: var(--palette-static-white);
	}
	:global(.seed-page-banner__button[data-tone="informative"][data-variant="solid"]) {
		color: var(--palette-static-white);
	}
	:global(.seed-page-banner__closeButton[data-tone="informative"][data-variant="solid"]) {
		--seed-suffix-icon-color: var(--palette-static-white);
	}
	:global(.seed-page-banner__root[data-tone="positive"][data-variant="weak"]) {
		background-color: var(--bg-positive-weak);
		--seed-prefix-icon-color: var(--fg-positive-contrast);
		--seed-suffix-icon-color: var(--fg-positive-contrast);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="positive"][data-variant="weak"]:is(button):is(:hover, [data-hover])) {
			background-color: var(--bg-positive-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="positive"][data-variant="weak"]:is(button):is(:active, [data-active])) {
			background-color: var(--bg-positive-weak-pressed);
		}
	}
	:global(.seed-page-banner__title[data-tone="positive"][data-variant="weak"]) {
		color: var(--fg-positive-contrast);
	}
	:global(.seed-page-banner__description[data-tone="positive"][data-variant="weak"]) {
		color: var(--fg-positive-contrast);
	}
	:global(.seed-page-banner__button[data-tone="positive"][data-variant="weak"]) {
		color: var(--fg-positive-contrast);
	}
	:global(.seed-page-banner__closeButton[data-tone="positive"][data-variant="weak"]) {
		--seed-suffix-icon-color: var(--fg-positive-contrast);
	}
	:global(.seed-page-banner__root[data-tone="positive"][data-variant="solid"]) {
		background-color: var(--bg-positive-solid);
		--seed-prefix-icon-color: var(--palette-static-white);
		--seed-suffix-icon-color: var(--palette-static-white);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="positive"][data-variant="solid"]:is(button):is(:hover, [data-hover])) {
			background-color: var(--bg-positive-solid-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="positive"][data-variant="solid"]:is(button):is(:active, [data-active])) {
			background-color: var(--bg-positive-solid-pressed);
		}
	}
	:global(.seed-page-banner__title[data-tone="positive"][data-variant="solid"]) {
		color: var(--palette-static-white);
	}
	:global(.seed-page-banner__description[data-tone="positive"][data-variant="solid"]) {
		color: var(--palette-static-white);
	}
	:global(.seed-page-banner__button[data-tone="positive"][data-variant="solid"]) {
		color: var(--palette-static-white);
	}
	:global(.seed-page-banner__closeButton[data-tone="positive"][data-variant="solid"]) {
		--seed-suffix-icon-color: var(--palette-static-white);
	}
	:global(.seed-page-banner__root[data-tone="warning"][data-variant="weak"]) {
		background-color: var(--bg-warning-weak);
		--seed-prefix-icon-color: var(--fg-warning-contrast);
		--seed-suffix-icon-color: var(--fg-warning-contrast);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="warning"][data-variant="weak"]:is(button):is(:hover, [data-hover])) {
			background-color: var(--bg-warning-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="warning"][data-variant="weak"]:is(button):is(:active, [data-active])) {
			background-color: var(--bg-warning-weak-pressed);
		}
	}
	:global(.seed-page-banner__title[data-tone="warning"][data-variant="weak"]) {
		color: var(--fg-warning-contrast);
	}
	:global(.seed-page-banner__description[data-tone="warning"][data-variant="weak"]) {
		color: var(--fg-warning-contrast);
	}
	:global(.seed-page-banner__button[data-tone="warning"][data-variant="weak"]) {
		color: var(--fg-warning-contrast);
	}
	:global(.seed-page-banner__closeButton[data-tone="warning"][data-variant="weak"]) {
		--seed-suffix-icon-color: var(--fg-warning-contrast);
	}
	:global(.seed-page-banner__root[data-tone="warning"][data-variant="solid"]) {
		background-color: var(--bg-warning-solid);
		--seed-prefix-icon-color: var(--palette-static-black-alpha-900);
		--seed-suffix-icon-color: var(--palette-static-black-alpha-900);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="warning"][data-variant="solid"]:is(button):is(:hover, [data-hover])) {
			background-color: var(--bg-warning-solid-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="warning"][data-variant="solid"]:is(button):is(:active, [data-active])) {
			background-color: var(--bg-warning-solid-pressed);
		}
	}
	:global(.seed-page-banner__title[data-tone="warning"][data-variant="solid"]) {
		color: var(--palette-static-black-alpha-900);
	}
	:global(.seed-page-banner__description[data-tone="warning"][data-variant="solid"]) {
		color: var(--palette-static-black-alpha-900);
	}
	:global(.seed-page-banner__button[data-tone="warning"][data-variant="solid"]) {
		color: var(--palette-static-black-alpha-900);
	}
	:global(.seed-page-banner__closeButton[data-tone="warning"][data-variant="solid"]) {
		--seed-suffix-icon-color: var(--palette-static-black-alpha-900);
	}
	:global(.seed-page-banner__root[data-tone="critical"][data-variant="weak"]) {
		background-color: var(--bg-critical-weak);
		--seed-prefix-icon-color: var(--fg-critical-contrast);
		--seed-suffix-icon-color: var(--fg-critical-contrast);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="critical"][data-variant="weak"]:is(button):is(:hover, [data-hover])) {
			background-color: var(--bg-critical-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="critical"][data-variant="weak"]:is(button):is(:active, [data-active])) {
			background-color: var(--bg-critical-weak-pressed);
		}
	}
	:global(.seed-page-banner__title[data-tone="critical"][data-variant="weak"]) {
		color: var(--fg-critical-contrast);
	}
	:global(.seed-page-banner__description[data-tone="critical"][data-variant="weak"]) {
		color: var(--fg-critical-contrast);
	}
	:global(.seed-page-banner__button[data-tone="critical"][data-variant="weak"]) {
		color: var(--fg-critical-contrast);
	}
	:global(.seed-page-banner__closeButton[data-tone="critical"][data-variant="weak"]) {
		--seed-suffix-icon-color: var(--fg-critical-contrast);
	}
	:global(.seed-page-banner__root[data-tone="critical"][data-variant="solid"]) {
		background-color: var(--bg-critical-solid);
		--seed-prefix-icon-color: var(--palette-static-white);
		--seed-suffix-icon-color: var(--palette-static-white);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="critical"][data-variant="solid"]:is(button):is(:hover, [data-hover])) {
			background-color: var(--bg-critical-solid-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="critical"][data-variant="solid"]:is(button):is(:active, [data-active])) {
			background-color: var(--bg-critical-solid-pressed);
		}
	}
	:global(.seed-page-banner__title[data-tone="critical"][data-variant="solid"]) {
		color: var(--palette-static-white);
	}
	:global(.seed-page-banner__description[data-tone="critical"][data-variant="solid"]) {
		color: var(--palette-static-white);
	}
	:global(.seed-page-banner__button[data-tone="critical"][data-variant="solid"]) {
		color: var(--palette-static-white);
	}
	:global(.seed-page-banner__closeButton[data-tone="critical"][data-variant="solid"]) {
		--seed-suffix-icon-color: var(--palette-static-white);
	}
	:global(.seed-page-banner__root[data-tone="magic"][data-variant="weak"]) {
		background-image: linear-gradient(88deg, var(--gradient-glow-magic));
		--seed-prefix-icon-color: var(--fg-neutral);
		--seed-suffix-icon-color: var(--fg-neutral);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="magic"][data-variant="weak"]:is(button):is(:hover, [data-hover])) {
			background-image: linear-gradient(88deg, var(--gradient-glow-magic-pressed));
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-page-banner__root[data-tone="magic"][data-variant="weak"]:is(button):is(:active, [data-active])) {
			background-image: linear-gradient(88deg, var(--gradient-glow-magic-pressed));
		}
	}
	:global(.seed-page-banner__title[data-tone="magic"][data-variant="weak"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-page-banner__description[data-tone="magic"][data-variant="weak"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-page-banner__button[data-tone="magic"][data-variant="weak"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-page-banner__closeButton[data-tone="magic"][data-variant="weak"]) {
		--seed-suffix-icon-color: var(--fg-neutral);
	}
	/* @end recipe */
</style>
