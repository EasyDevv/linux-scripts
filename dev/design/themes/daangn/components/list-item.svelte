<!-- SEED List item (seed-design.io/react/components/list).
     Row py12 px16, prefix pr12, title t5 + detail t3 subtle (gap 2), suffix; pressed paints a r10 pill
     inset 6px (margin-x on :active), highlighted = bg-brand-weak.
     as     "li" (static) · "button" (the content becomes a <button>, suffix stays separately clickable)
            · "label" (the whole row toggles a control; put a mark in prefix/suffix and pass the input)
     slots  prefix / suffix / titleContent snippets; `input` snippet for the label row's hidden control. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { states, variants } from "./seed.ts";

	let {
		as = "li",
		title,
		detail,
		highlighted = false,
		disabled = false,
		checked = false,
		alignItems,
		radius,
		prefix,
		suffix,
		titleContent,
		input,
		onclick,
	}: {
		as?: "li" | "button" | "label";
		title?: string;
		detail?: string;
		highlighted?: boolean;
		disabled?: boolean;
		checked?: boolean;
		alignItems?: "flex-start" | "center" | "flex-end";
		/** row radius for inset card-style lists, e.g. "--radius-r3" */
		radius?: string;
		prefix?: Snippet;
		suffix?: Snippet;
		titleContent?: Snippet;
		input?: Snippet;
		onclick?: () => void;
	} = $props();

	const v = $derived(variants({ highlighted: highlighted ? "true" : undefined }));
	const s = $derived(states({ disabled, checked }));
	const style = $derived([alignItems && `--seed-box-align-items: ${alignItems}; align-items: ${alignItems}`, radius && `border-radius: var(${radius})`].filter(Boolean).join("; ") || undefined);
</script>

{#snippet body()}
	<div class="seed-list-item__title" {...v} {...s}>{#if titleContent}{@render titleContent()}{:else}{title}{/if}</div>
	{#if detail}<div class="seed-list-item__detail" {...v} {...s}>{detail}</div>{/if}
{/snippet}

<svelte:element this={as === "label" ? "label" : "li"} class="seed-list-item__root" {...v} {...s} {style}>
	{#if prefix}<div class="seed-list-item__prefix" {...v} {...s}>{@render prefix()}</div>{/if}
	{#if as === "button"}
		<button type="button" class="seed-list-item__content" {...v} {...s} {disabled} {onclick}>{@render body()}</button>
	{:else}
		<div class="seed-list-item__content" {...v} {...s}>{@render body()}</div>
	{/if}
	{#if suffix}<div class="seed-list-item__suffix" {...v} {...s}>{@render suffix()}</div>{/if}
	{@render input?.()}
</svelte:element>

<style>
	/* @recipe list-item */
	/* SEED recipe: list-item */
	:global(.seed-list-item__root) {
		box-sizing: border-box;
		border: none;
		font-family: inherit;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		position: relative;
		display: flex;
		width: 100%;
		isolation: isolate;
		padding-inline: var(--spacing-global-gutter);
		padding-block: var(--dimension-x3);
		--seed-box-align-items: center;
		align-items: var(--seed-box-align-items);
	}
	:global(.seed-list-item__prefix) {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		--seed-box-padding-right-base: var(--dimension-x3);
		--seed-box-padding-right-sm: var(--seed-box-padding-right-base, initial);
		--seed-box-padding-right-md: var(--seed-box-padding-right-sm, initial);
		--seed-box-padding-right-lg: var(--seed-box-padding-right-md, initial);
		--seed-box-padding-right-xl: var(--seed-box-padding-right-lg, initial);
		--seed-box-padding-right: var(--seed-box-padding-right-base, initial);
		padding-right: var(--seed-box-padding-right);
		--seed-focus-ring: none;
		--seed-checkmark-feedback-scale: 1;
		--seed-radiomark-feedback-scale: 1;
		--seed-switchmark-feedback-scale: 1;
		--seed-icon-size: 22px;
		--seed-icon-color: var(--fg-neutral);
	}
	:global(.seed-list-item__prefix:is(:disabled, [disabled], [data-disabled])) {
		--seed-icon-color: var(--fg-disabled);
	}
	:global(.seed-list-item__suffix) {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		--seed-box-position: initial;
		position: var(--seed-box-position);
		--seed-box-gap-base: var(--dimension-x1);
		--seed-box-gap-sm: var(--seed-box-gap-base, initial);
		--seed-box-gap-md: var(--seed-box-gap-sm, initial);
		--seed-box-gap-lg: var(--seed-box-gap-md, initial);
		--seed-box-gap-xl: var(--seed-box-gap-lg, initial);
		--seed-box-gap: var(--seed-box-gap-base, initial);
		gap: var(--seed-box-gap);
		--seed-focus-ring: none;
		--seed-checkmark-feedback-scale: 1;
		--seed-radiomark-feedback-scale: 1;
		--seed-switchmark-feedback-scale: 1;
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		font-weight: var(--font-weight-regular);
		color: var(--fg-neutral-subtle);
		--seed-icon-size: 18px;
		--seed-icon-color: var(--fg-neutral-subtle);
	}
	:global(.seed-list-item__suffix:is(:disabled, [disabled], [data-disabled])) {
		--seed-icon-color: var(--fg-disabled);
	}
	:global(.seed-list-item__content) {
		display: inline-flex;
		box-sizing: border-box;
		text-align: start;
		flex-direction: column;
		align-items: flex-start;
		flex-grow: 1;
		background-color: transparent;
		border: none;
		font-family: inherit;
		--seed-box-gap-base: var(--dimension-x0-5);
		--seed-box-gap-sm: var(--seed-box-gap-base, initial);
		--seed-box-gap-md: var(--seed-box-gap-sm, initial);
		--seed-box-gap-lg: var(--seed-box-gap-md, initial);
		--seed-box-gap-xl: var(--seed-box-gap-lg, initial);
		--seed-box-gap: var(--seed-box-gap-base, initial);
		gap: var(--seed-box-gap);
		--seed-box-padding-right-base: var(--dimension-x2-5);
		--seed-box-padding-right-sm: var(--seed-box-padding-right-base, initial);
		--seed-box-padding-right-md: var(--seed-box-padding-right-sm, initial);
		--seed-box-padding-right-lg: var(--seed-box-padding-right-md, initial);
		--seed-box-padding-right-xl: var(--seed-box-padding-right-lg, initial);
		--seed-box-padding-right: var(--seed-box-padding-right-base, initial);
		padding: 0 var(--seed-box-padding-right) 0 0;
		text-decoration: none;
	}
	:global(.seed-list-item__content::after) {
		content: '';
		position: absolute;
		inset: 0;
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: calc(var(--dimension-x0-5) * -1);
		transition: outline-color var(--duration-d3) var(--ease-easing);
	}
	:global(.seed-list-item__content:is(:focus, [data-focus])) {
		outline: none;
	}
	:global(.seed-list-item__content:is(:focus-visible, [data-focus-visible])::after) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: calc(var(--dimension-x0-5) * -1);
	}
	:global(.seed-list-item__content::before) {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		transition-property: background-color, inset-inline, border-radius;
		transition-duration: var(--duration-color-transition);
		transition-timing-function: var(--ease-easing);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-list-item__content:is(button, a):not(:is(:disabled, [disabled], [data-disabled])):is(:hover, [data-hover])::before) {
			background-color: var(--bg-transparent-pressed);
			inset-inline: var(--dimension-x1-5);
			border-radius: var(--list-item-border-radius, var(--dimension-x2-5));
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-list-item__content:is(button, a):not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])::before) {
			background-color: var(--bg-transparent-pressed);
			inset-inline: var(--dimension-x1-5);
			border-radius: var(--list-item-border-radius, var(--dimension-x2-5));
		}
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-list-item__content:not(:is(:disabled, [disabled], [data-disabled]))[data-hover]::before) {
			background-color: var(--bg-transparent-pressed);
			inset-inline: var(--dimension-x1-5);
			border-radius: var(--list-item-border-radius, var(--dimension-x2-5));
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-list-item__content:not(:is(:disabled, [disabled], [data-disabled]))[data-active]::before) {
			background-color: var(--bg-transparent-pressed);
			inset-inline: var(--dimension-x1-5);
			border-radius: var(--list-item-border-radius, var(--dimension-x2-5));
		}
	}
	:global(.seed-list-item__title) {
		flex-shrink: 0;
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		font-weight: var(--font-weight-regular);
		color: var(--fg-neutral);
	}
	:global(.seed-list-item__title:is(:disabled, [disabled], [data-disabled])) {
		color: var(--fg-disabled);
	}
	:global(.seed-list-item__detail) {
		font-size: var(--text-t3);
		line-height: var(--text-t3--line-height);
		font-weight: var(--font-weight-regular);
		color: var(--fg-neutral-subtle);
	}
	:global(.seed-list-item__detail:is(:disabled, [disabled], [data-disabled])) {
		color: var(--fg-disabled);
	}
	:global(.seed-list-item__content[data-highlighted="true"]::before) {
		background-color: var(--bg-brand-weak);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-list-item__content[data-highlighted="true"]:is(button, a):not(:is(:disabled, [disabled], [data-disabled])):is(:hover, [data-hover])::before) {
			background-color: var(--bg-brand-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-list-item__content[data-highlighted="true"]:is(button, a):not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])::before) {
			background-color: var(--bg-brand-weak-pressed);
		}
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-list-item__content[data-highlighted="true"]:not(:is(:disabled, [disabled], [data-disabled]))[data-hover]::before) {
			background-color: var(--bg-brand-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-list-item__content[data-highlighted="true"]:not(:is(:disabled, [disabled], [data-disabled]))[data-active]::before) {
			background-color: var(--bg-brand-weak-pressed);
		}
	}
	@media (min-width: 480px) {
		:global(.seed-list-item__prefix) {
			--seed-box-padding-right: var(--seed-box-padding-right-sm, initial);
		}
		:global(.seed-list-item__suffix) {
			--seed-box-gap: var(--seed-box-gap-sm, initial);
		}
		:global(.seed-list-item__content) {
			--seed-box-gap: var(--seed-box-gap-sm, initial);
			--seed-box-padding-right: var(--seed-box-padding-right-sm, initial);
		}
	}
	@media (min-width: 768px) {
		:global(.seed-list-item__prefix) {
			--seed-box-padding-right: var(--seed-box-padding-right-md, initial);
		}
		:global(.seed-list-item__suffix) {
			--seed-box-gap: var(--seed-box-gap-md, initial);
		}
		:global(.seed-list-item__content) {
			--seed-box-gap: var(--seed-box-gap-md, initial);
			--seed-box-padding-right: var(--seed-box-padding-right-md, initial);
		}
	}
	@media (min-width: 1280px) {
		:global(.seed-list-item__prefix) {
			--seed-box-padding-right: var(--seed-box-padding-right-lg, initial);
		}
		:global(.seed-list-item__suffix) {
			--seed-box-gap: var(--seed-box-gap-lg, initial);
		}
		:global(.seed-list-item__content) {
			--seed-box-gap: var(--seed-box-gap-lg, initial);
			--seed-box-padding-right: var(--seed-box-padding-right-lg, initial);
		}
	}
	@media (min-width: 1440px) {
		:global(.seed-list-item__prefix) {
			--seed-box-padding-right: var(--seed-box-padding-right-xl, initial);
		}
		:global(.seed-list-item__suffix) {
			--seed-box-gap: var(--seed-box-gap-xl, initial);
		}
		:global(.seed-list-item__content) {
			--seed-box-gap: var(--seed-box-gap-xl, initial);
			--seed-box-padding-right: var(--seed-box-padding-right-xl, initial);
		}
	}
	/* @end recipe */
</style>
