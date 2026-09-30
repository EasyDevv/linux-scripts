<!-- SEED TagGroup (seed-design.io/react/components/tag-group): inline metadata ("500m · 서초4동 · 3분 전").
     size    t2 · t3 · t4 (item + separator type);  weight regular | bold
     tone    neutralSubtle (default) · neutral · brand;  truncate: one line with the last item ellipsised
     items   { label, prefixIcon?, suffixIcon?, tone?, weight? };  separator text defaults to "·". -->
<script lang="ts">
	import type { Component } from "svelte";
	import { variants } from "./seed.ts";

	type Item = {
		label: string;
		prefixIcon?: Component;
		suffixIcon?: Component;
		/** a plain .seed-icon before the label, optionally tinted with a theme token (e.g. "--fg-brand") */
		icon?: Component;
		iconColor?: string;
		tone?: "neutralSubtle" | "neutral" | "brand";
		weight?: "regular" | "bold";
		ariaLabel?: string;
		/** keep this item from shrinking when the group truncates */
		fixed?: boolean;
		/** flex-shrink weight when the group truncates */
		shrink?: number;
	};
	let {
		items,
		size = "t2",
		tone = "neutralSubtle",
		weight = "regular",
		truncate = false,
		separator = " · ",
	}: { items: Item[]; size?: "t2" | "t3" | "t4"; tone?: Item["tone"]; weight?: Item["weight"]; truncate?: boolean; separator?: string } = $props();
</script>

<span class="seed-tag-group__root" {...variants({ size, truncate: String(truncate) })}>
	{#each items as item, i (i)}
		{#if i > 0}<span class="seed-tag-group__separator" {...variants({ size, truncate: String(truncate) })} aria-hidden="true">{separator}</span>{/if}
		{@const v = variants({ size, weight: item.weight ?? weight, tone: item.tone ?? tone })}
		<span class="seed-tag-group-item__root" {...v} aria-label={item.ariaLabel} style={item.fixed ? "flex-shrink: 0" : item.shrink !== undefined ? `flex-shrink: ${item.shrink}` : undefined}>
			{#if item.icon}<item.icon class="seed-icon" aria-hidden="true" style={item.iconColor ? `--seed-icon-color: var(${item.iconColor})` : undefined} />{/if}
			{#if item.prefixIcon}<item.prefixIcon class="seed-prefix-icon" aria-hidden="true" />{/if}
			<span class="seed-tag-group-item__label" {...v}>{item.label}</span>
			{#if item.suffixIcon}<item.suffixIcon class="seed-suffix-icon" aria-hidden="true" />{/if}
		</span>
	{/each}
</span>

<style>
	/* @recipe tag-group, tag-group-item */
	/* SEED recipe: tag-group */
	:global(.seed-tag-group__separator) {
		color: var(--palette-gray-600);
		font-weight: var(--font-weight-regular);
		white-space: pre;
		user-select: none;
	}
	:global(.seed-tag-group__separator[data-size="t2"]) {
		font-size: var(--text-t2);
		line-height: var(--text-t2--line-height);
	}
	:global(.seed-tag-group__separator[data-size="t3"]) {
		font-size: var(--text-t3);
		line-height: var(--text-t3--line-height);
	}
	:global(.seed-tag-group__separator[data-size="t4"]) {
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
	}
	:global(.seed-tag-group__root[data-truncate="true"]) {
		display: inline-flex;
		align-items: center;
		max-width: 100%;
		--tag-group-item-display: inline-flex;
		--tag-group-item-overflow: hidden;
		--tag-group-item-text-overflow: ellipsis;
		--tag-group-item-white-space: nowrap;
		--tag-group-item-align-items: baseline;
	}
	:global(.seed-tag-group__root[data-truncate="true"] .seed-icon) {
		position: relative;
		top: var(--tag-group-item-icon-flex-offset, 0px);
	}
	:global(.seed-tag-group__root[data-truncate="true"] .seed-prefix-icon) {
		position: relative;
		top: var(--tag-group-item-prefix-icon-flex-offset, 0px);
	}
	:global(.seed-tag-group__root[data-truncate="true"] .seed-suffix-icon) {
		position: relative;
		top: var(--tag-group-item-suffix-icon-flex-offset, 0px);
	}
	:global(.seed-tag-group__root[data-truncate="false"]) {
		display: inline-block;
		font-size: 0;
		--tag-group-item-display: inline;
		--tag-group-item-overflow: visible;
		--tag-group-item-text-overflow: clip;
		--tag-group-item-white-space: normal;
		--tag-group-item-align-items: center;
	}
	:global(.seed-tag-group__root[data-truncate="false"] .seed-icon),
	:global(.seed-tag-group__root[data-truncate="false"] .seed-prefix-icon),
	:global(.seed-tag-group__root[data-truncate="false"] .seed-suffix-icon) {
		position: relative;
		top: var(--tag-group-item-inline-icon-offset, 0px);
	}
	:global(.seed-tag-group__separator[data-truncate="false"]) {
		vertical-align: middle;
	}
	:global(.seed-tag-group__root[data-size="t2"][data-truncate="false"]) {
		line-height: var(--text-t2--line-height);
	}
	:global(.seed-tag-group__root[data-size="t3"][data-truncate="false"]) {
		line-height: var(--text-t3--line-height);
	}
	:global(.seed-tag-group__root[data-size="t4"][data-truncate="false"]) {
		line-height: var(--text-t4--line-height);
	}

	/* SEED recipe: tag-group-item */
	:global(.seed-tag-group-item__root) {
		display: var(--tag-group-item-display);
		align-items: var(--tag-group-item-align-items, center);
		vertical-align: middle;
		flex-shrink: var(--seed-box-flex-shrink, 1);
		min-width: 0;
	}
	:global(.seed-tag-group-item__label) {
		display: inline;
		vertical-align: middle;
		min-width: 0;
		overflow: var(--tag-group-item-overflow);
		text-overflow: var(--tag-group-item-text-overflow);
		white-space: var(--tag-group-item-white-space);
		word-break: normal;
	}
	:global(.seed-tag-group-item__label:not(:first-child)) {
		margin-left: var(--dimension-x0-5);
	}
	:global(.seed-tag-group-item__label:not(:last-child)) {
		margin-right: var(--dimension-x0-5);
	}
	:global(.seed-tag-group-item__root[data-size="t2"]) {
		--tag-group-item-inline-icon-offset: calc(0.65em - var(--text-t2--line-height) / 2);
		--tag-group-item-icon-flex-offset: calc(var(--dimension-x3) / 2 - 0.35em);
		--tag-group-item-prefix-icon-flex-offset: calc(var(--dimension-x3) / 2 - 0.35em);
		--tag-group-item-suffix-icon-flex-offset: calc(var(--dimension-x3) / 2 - 0.35em);
		--seed-icon-size: var(--dimension-x3);
		--seed-icon-font-size: var(--text-t2);
		--seed-prefix-icon-size: var(--dimension-x3);
		--seed-prefix-icon-font-size: var(--text-t2);
		--seed-suffix-icon-size: var(--dimension-x3);
		--seed-suffix-icon-font-size: var(--text-t2);
	}
	@supports (top: 1cap) {
		:global(.seed-tag-group-item__root[data-size="t2"]) {
			--tag-group-item-inline-icon-offset: calc(1em - var(--text-t2--line-height) / 2 - 0.5cap);
			--tag-group-item-icon-flex-offset: calc(var(--dimension-x3) / 2 - 0.5cap);
			--tag-group-item-prefix-icon-flex-offset: calc(var(--dimension-x3) / 2 - 0.5cap);
			--tag-group-item-suffix-icon-flex-offset: calc(var(--dimension-x3) / 2 - 0.5cap);
		}
	}
	:global(.seed-tag-group-item__label[data-size="t2"]) {
		font-size: var(--text-t2);
		line-height: var(--text-t2--line-height);
	}
	:global(.seed-tag-group-item__root[data-size="t3"]) {
		--tag-group-item-inline-icon-offset: calc(0.65em - var(--text-t3--line-height) / 2);
		--tag-group-item-icon-flex-offset: calc(13px / 2 - 0.35em);
		--tag-group-item-prefix-icon-flex-offset: calc(13px / 2 - 0.35em);
		--tag-group-item-suffix-icon-flex-offset: calc(13px / 2 - 0.35em);
		--seed-icon-size: 13px;
		--seed-icon-font-size: var(--text-t3);
		--seed-prefix-icon-size: 13px;
		--seed-prefix-icon-font-size: var(--text-t3);
		--seed-suffix-icon-size: 13px;
		--seed-suffix-icon-font-size: var(--text-t3);
	}
	@supports (top: 1cap) {
		:global(.seed-tag-group-item__root[data-size="t3"]) {
			--tag-group-item-inline-icon-offset: calc(1em - var(--text-t3--line-height) / 2 - 0.5cap);
			--tag-group-item-icon-flex-offset: calc(13px / 2 - 0.5cap);
			--tag-group-item-prefix-icon-flex-offset: calc(13px / 2 - 0.5cap);
			--tag-group-item-suffix-icon-flex-offset: calc(13px / 2 - 0.5cap);
		}
	}
	:global(.seed-tag-group-item__label[data-size="t3"]) {
		font-size: var(--text-t3);
		line-height: var(--text-t3--line-height);
	}
	:global(.seed-tag-group-item__root[data-size="t4"]) {
		--tag-group-item-inline-icon-offset: calc(0.65em - var(--text-t4--line-height) / 2);
		--tag-group-item-icon-flex-offset: calc(var(--dimension-x3-5) / 2 - 0.35em);
		--tag-group-item-prefix-icon-flex-offset: calc(var(--dimension-x3-5) / 2 - 0.35em);
		--tag-group-item-suffix-icon-flex-offset: calc(var(--dimension-x3-5) / 2 - 0.35em);
		--seed-icon-size: var(--dimension-x3-5);
		--seed-icon-font-size: var(--text-t4);
		--seed-prefix-icon-size: var(--dimension-x3-5);
		--seed-prefix-icon-font-size: var(--text-t4);
		--seed-suffix-icon-size: var(--dimension-x3-5);
		--seed-suffix-icon-font-size: var(--text-t4);
	}
	@supports (top: 1cap) {
		:global(.seed-tag-group-item__root[data-size="t4"]) {
			--tag-group-item-inline-icon-offset: calc(1em - var(--text-t4--line-height) / 2 - 0.5cap);
			--tag-group-item-icon-flex-offset: calc(var(--dimension-x3-5) / 2 - 0.5cap);
			--tag-group-item-prefix-icon-flex-offset: calc(var(--dimension-x3-5) / 2 - 0.5cap);
			--tag-group-item-suffix-icon-flex-offset: calc(var(--dimension-x3-5) / 2 - 0.5cap);
		}
	}
	:global(.seed-tag-group-item__label[data-size="t4"]) {
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
	}
	:global(.seed-tag-group-item__root[data-weight="regular"]) {
		--seed-icon-font-weight: var(--font-weight-regular);
		--seed-prefix-icon-font-weight: var(--font-weight-regular);
		--seed-suffix-icon-font-weight: var(--font-weight-regular);
	}
	:global(.seed-tag-group-item__label[data-weight="regular"]) {
		font-weight: var(--font-weight-regular);
	}
	:global(.seed-tag-group-item__root[data-weight="bold"]) {
		--seed-icon-font-weight: var(--font-weight-bold);
		--seed-prefix-icon-font-weight: var(--font-weight-bold);
		--seed-suffix-icon-font-weight: var(--font-weight-bold);
	}
	:global(.seed-tag-group-item__label[data-weight="bold"]) {
		font-weight: var(--font-weight-bold);
	}
	:global(.seed-tag-group-item__root[data-tone="neutralSubtle"]) {
		--seed-prefix-icon-color: var(--fg-neutral-subtle);
		--seed-suffix-icon-color: var(--fg-neutral-subtle);
		--seed-icon-color: var(--fg-neutral-subtle);
	}
	:global(.seed-tag-group-item__label[data-tone="neutralSubtle"]) {
		color: var(--fg-neutral-subtle);
	}
	:global(.seed-tag-group-item__root[data-tone="neutral"]) {
		--seed-prefix-icon-color: var(--fg-neutral);
		--seed-suffix-icon-color: var(--fg-neutral);
		--seed-icon-color: var(--fg-neutral);
	}
	:global(.seed-tag-group-item__label[data-tone="neutral"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-tag-group-item__root[data-tone="brand"]) {
		--seed-prefix-icon-color: var(--fg-brand);
		--seed-suffix-icon-color: var(--fg-brand);
		--seed-icon-color: var(--fg-brand);
	}
	:global(.seed-tag-group-item__label[data-tone="brand"]) {
		color: var(--fg-brand);
	}
	/* @end recipe */
</style>
