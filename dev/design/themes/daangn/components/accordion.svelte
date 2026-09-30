<!-- SEED Accordion (seed-design.io/react/components/accordion).
     variant inline (hairline rows) · separated (spaced cards); size medium · large · responsive
     Each item: <h3> header > trigger button (prefix icon, title + description, chevron), and a
     region that collapses to 0 using --collapsible-content-height. `multiple` lets several stay open. -->
<script lang="ts">
	import type { Component, Snippet } from "svelte";
	import { collapsibleHeight, nextId, states, variants } from "./seed.ts";

	type Item = { value: string; title: string; description?: string; prefixIcon?: Component; disabled?: boolean; content?: string };
	let {
		items,
		value = $bindable([]),
		multiple = false,
		collapsible = true,
		variant = "inline",
		size = "medium",
		headingLevel = 3,
		content,
	}: {
		items: Item[];
		/** open item values */
		value?: string[];
		multiple?: boolean;
		/** false = one item must stay open (single mode) */
		collapsible?: boolean;
		variant?: "inline" | "separated";
		size?: "medium" | "large" | "responsive";
		headingLevel?: 2 | 3 | 4 | 5 | 6;
		/** custom region body; receives the item */
		content?: Snippet<[Item]>;
	} = $props();

	const id = nextId("accordion");
	const v = $derived(variants({ variant, size }));
	function toggle(item: Item) {
		if (item.disabled) return;
		const open = value.includes(item.value);
		if (open && !collapsible && !multiple && value.length === 1) return;
		value = open ? value.filter((x) => x !== item.value) : multiple ? [...value, item.value] : [item.value];
	}
</script>

<div class="seed-accordion__root" {...v}>
	{#each items as item (item.value)}
		{@const open = value.includes(item.value)}
		{@const s = states({ open, disabled: item.disabled })}
		<div class="seed-accordion__item" {...v} {...s} data-collapsible="" data-value={item.value} data-state={open ? "open" : "closed"}>
			<svelte:element this={`h${headingLevel}`} class="seed-accordion__header" {...v} {...s}>
				<button type="button" class="seed-accordion__trigger" {...v} {...s} id="{id}-{item.value}-trigger" aria-expanded={open} aria-controls="{id}-{item.value}-content" aria-disabled={!!item.disabled} data-value={item.value} onclick={() => toggle(item)}>
					{#if item.prefixIcon}<div class="seed-accordion__prefix" {...v} {...s}><item.prefixIcon class="seed-icon" aria-hidden="true" /></div>{/if}
					<div class="seed-accordion__body" {...v} {...s}>
						<span class="seed-accordion__title" {...v} {...s}>{item.title}</span>
						{#if item.description}<span class="seed-accordion__description" {...v} {...s}>{item.description}</span>{/if}
					</div>
					<div class="seed-accordion__suffixIcon" {...v} {...s}>
						<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5.5 9l6.5 6.5L18.5 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
					</div>
				</button>
			</svelte:element>
			<div class="seed-accordion__content" {...v} {...s} data-collapsible="" data-state={open ? "open" : "closed"} hidden={!open} role="region" id="{id}-{item.value}-content" aria-labelledby="{id}-{item.value}-trigger" {@attach collapsibleHeight}>
				<div>{#if content}{@render content(item)}{:else}<p>{item.content}</p>{/if}</div>
			</div>
		</div>
	{/each}
</div>

<style>
	/* @recipe accordion */
	/* SEED recipe: accordion */
	:global(.seed-accordion__root) {
		display: flex;
		flex-direction: column;
		width: 100%;
	}
	:global(.seed-accordion__item) {
		display: flex;
		flex-direction: column;
		width: 100%;
	}
	:global(.seed-accordion__header) {
		display: flex;
		margin: 0;
		padding: 0;
		font: inherit;
	}
	:global(.seed-accordion__trigger) {
		position: relative;
		isolation: isolate;
		display: flex;
		align-items: center;
		width: 100%;
		cursor: pointer;
		background: transparent;
		border: none;
		padding: 0;
		font-family: inherit;
		text-align: start;
		padding-inline: var(--spacing-global-gutter);
		transition: outline-color var(--duration-d3) var(--ease-easing);
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-accordion__trigger:is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-accordion__trigger:is(:disabled, [disabled], [data-disabled])) {
		cursor: not-allowed;
	}
	:global(.seed-accordion__prefix) {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		--seed-icon-color: var(--fg-neutral);
	}
	:global(.seed-accordion__prefix:is(:disabled, [disabled], [data-disabled])) {
		--seed-icon-color: var(--fg-disabled);
	}
	:global(.seed-accordion__body) {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--dimension-x0-5);
		min-width: 0;
	}
	:global(.seed-accordion__title) {
		color: var(--fg-neutral);
		font-weight: var(--font-weight-medium);
	}
	:global(.seed-accordion__title:is(:disabled, [disabled], [data-disabled])) {
		color: var(--fg-disabled);
	}
	:global(.seed-accordion__description) {
		color: var(--fg-neutral-subtle);
		font-weight: var(--font-weight-medium);
	}
	:global(.seed-accordion__description:is(:disabled, [disabled], [data-disabled])) {
		color: var(--fg-disabled);
	}
	:global(.seed-accordion__suffixIcon) {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		margin-left: auto;
		color: var(--fg-neutral-subtle);
		transform: rotate(0deg);
		transition: transform var(--duration-d6) var(--ease-easing);
	}
	:global(.seed-accordion__suffixIcon:is([data-state="open"], [data-open])) {
		transform: rotate(180deg);
	}
	:global(.seed-accordion__suffixIcon:is(:disabled, [disabled], [data-disabled])) {
		color: var(--fg-disabled);
	}
	:global(.seed-accordion__content) {
		overflow: hidden;
		height: 0;
		opacity: 0;
		transition: height var(--duration-d6) var(--ease-easing), opacity var(--duration-d6) var(--ease-easing);
	}
	:global(.seed-accordion__content:is([data-state="open"], [data-open])) {
		height: var(--collapsible-content-height);
		opacity: 1;
		transition: height var(--duration-d6) var(--ease-easing), opacity var(--duration-d6) var(--ease-easing);
	}
	:global(.seed-accordion__item[data-variant="inline"]) {
		position: relative;
	}
	:global(.seed-accordion__item[data-variant="inline"]:not(:last-child)::after) {
		content: '';
		position: absolute;
		bottom: 0;
		inset-inline: var(--dimension-x3);
		height: 1px;
		background-color: var(--stroke-neutral-subtle);
	}
	:global(.seed-accordion__trigger[data-variant="inline"]::before) {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		transition-property: background-color, inset-inline, border-radius;
		transition-duration: var(--duration-color-transition);
		transition-timing-function: var(--ease-easing);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-accordion__trigger[data-variant="inline"]:not(:is(:disabled, [disabled], [data-disabled])):is(:hover, [data-hover])::before) {
			background-color: var(--bg-transparent-pressed);
			inset-inline: var(--dimension-x1-5);
			border-radius: var(--dimension-x2-5);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-accordion__trigger[data-variant="inline"]:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])::before) {
			background-color: var(--bg-transparent-pressed);
			inset-inline: var(--dimension-x1-5);
			border-radius: var(--dimension-x2-5);
		}
	}
	:global(.seed-accordion__item[data-variant="separated"]) {
		box-shadow: inset 0 0 0 1px var(--stroke-neutral-weak);
		border-radius: var(--radius-r3);
		overflow: hidden;
	}
	:global(.seed-accordion__trigger[data-variant="separated"]::before) {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		transition-property: background-color;
		transition-duration: var(--duration-color-transition);
		transition-timing-function: var(--ease-easing);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-accordion__trigger[data-variant="separated"]:not(:is(:disabled, [disabled], [data-disabled])):is(:hover, [data-hover])::before) {
			background-color: var(--bg-transparent-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-accordion__trigger[data-variant="separated"]:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])::before) {
			background-color: var(--bg-transparent-pressed);
		}
	}
	:global(.seed-accordion__trigger[data-size="medium"]) {
		padding-block: var(--dimension-x4);
	}
	:global(.seed-accordion__prefix[data-size="medium"]) {
		margin-right: var(--dimension-x3);
		--seed-icon-size: 22px;
	}
	:global(.seed-accordion__title[data-size="medium"]) {
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
	}
	:global(.seed-accordion__description[data-size="medium"]) {
		font-size: var(--text-t3);
		line-height: var(--text-t3--line-height);
	}
	:global(.seed-accordion__suffixIcon[data-size="medium"]) {
		--seed-suffix-icon-size: var(--dimension-x5);
		--seed-suffix-icon-margin-left: var(--dimension-x3);
	}
	:global(.seed-accordion__trigger[data-size="large"]) {
		padding-block: var(--dimension-x5);
	}
	:global(.seed-accordion__prefix[data-size="large"]) {
		margin-right: var(--dimension-x3);
		--seed-icon-size: 22px;
	}
	:global(.seed-accordion__title[data-size="large"]) {
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
	}
	:global(.seed-accordion__description[data-size="large"]) {
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
	}
	:global(.seed-accordion__suffixIcon[data-size="large"]) {
		--seed-suffix-icon-size: var(--dimension-x6);
		--seed-suffix-icon-margin-left: var(--dimension-x3);
	}
	:global(.seed-accordion__trigger[data-size="responsive"]) {
		padding-block: var(--dimension-x4);
	}
	@media (min-width: 768px) {
		:global(.seed-accordion__trigger[data-size="responsive"]) {
			padding-block: var(--dimension-x5);
		}
	}
	:global(.seed-accordion__prefix[data-size="responsive"]) {
		margin-right: var(--dimension-x3);
		--seed-icon-size: 22px;
	}
	@media (min-width: 768px) {
		:global(.seed-accordion__prefix[data-size="responsive"]) {
			margin-right: var(--dimension-x3);
			--seed-icon-size: 22px;
		}
	}
	:global(.seed-accordion__title[data-size="responsive"]) {
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
	}
	@media (min-width: 768px) {
		:global(.seed-accordion__title[data-size="responsive"]) {
			font-size: var(--text-t7);
			line-height: var(--text-t7--line-height);
		}
	}
	:global(.seed-accordion__description[data-size="responsive"]) {
		font-size: var(--text-t3);
		line-height: var(--text-t3--line-height);
	}
	@media (min-width: 768px) {
		:global(.seed-accordion__description[data-size="responsive"]) {
			font-size: var(--text-t5);
			line-height: var(--text-t5--line-height);
		}
	}
	:global(.seed-accordion__suffixIcon[data-size="responsive"]) {
		--seed-suffix-icon-size: var(--dimension-x5);
		--seed-suffix-icon-margin-left: var(--dimension-x3);
	}
	@media (min-width: 768px) {
		:global(.seed-accordion__suffixIcon[data-size="responsive"]) {
			--seed-suffix-icon-size: var(--dimension-x6);
			--seed-suffix-icon-margin-left: var(--dimension-x3);
		}
	}
	:global(.seed-accordion__root[data-variant="separated"][data-size="medium"]) {
		gap: var(--dimension-x3);
	}
	:global(.seed-accordion__root[data-variant="separated"][data-size="large"]) {
		gap: var(--dimension-x4);
	}
	:global(.seed-accordion__root[data-variant="separated"][data-size="responsive"]) {
		gap: var(--dimension-x3);
	}
	@media (min-width: 768px) {
		:global(.seed-accordion__root[data-variant="separated"][data-size="responsive"]) {
			gap: var(--dimension-x4);
		}
	}
	/* @end recipe */
</style>
