<!-- SEED SegmentedControl (seed-design.io/react/components/segmented-control).
     Track: pad 4, pill, bg-neutral-weak-alpha; items min 86x34, px24, t5 bold (subtle → neutral).
     The white thumb (1px stroke-neutral-muted) slides by --segment-index / --segment-count. -->
<script lang="ts">
	import NotificationBadge from "./notification-badge.svelte";
	import { nextId, states, visuallyHidden } from "./seed.ts";

	type Item = { value: string; label: string; disabled?: boolean; notification?: boolean };
	let {
		value = $bindable(),
		items,
		disabled = false,
		ariaLabel,
		name = nextId("segmented"),
		style,
	}: { value?: string; items: Item[]; disabled?: boolean; ariaLabel: string; name?: string; style?: string } = $props();

	const index = $derived(Math.max(0, items.findIndex((i) => i.value === value)));
</script>

<div class="seed-segmented-control__root" role="radiogroup" aria-label={ariaLabel} {...states({ disabled })} style="--segment-index: {index}; --segment-count: {items.length};{style ?? ''}">
	{#each items as item (item.value)}
		{@const s = states({ checked: value === item.value, disabled: disabled || item.disabled })}
		<label class="seed-segmented-control__item" {...s} data-value={item.value}>
			<input type="radio" {name} value={item.value} bind:group={value} disabled={disabled || item.disabled} style={visuallyHidden} />
			{#if item.notification}
				<div style="position: relative; display: flex; align-items: flex-start">{item.label}<NotificationBadge size="small" attach="text" /></div>
			{:else}
				{item.label}
			{/if}
		</label>
	{/each}
	<div class="seed-segmented-control__indicator" {...states({ disabled })}></div>
</div>

<style>
	/* @recipe segmented-control */
	/* SEED recipe: segmented-control */
	:global(.seed-segmented-control__root) {
		display: grid;
		box-sizing: border-box;
		max-width: 100%;
		position: relative;
		padding: var(--dimension-x1);
		border-radius: var(--radius-full);
		background-color: var(--bg-neutral-weak-alpha);
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		grid-auto-rows: 1fr;
		align-items: center;
		isolation: isolate;
	}
	:global(.seed-segmented-control__indicator) {
		position: absolute;
		z-index: -1;
		will-change: transform;
		transform: translateX(calc(var(--segment-index) * 100%));
		inset-block: var(--dimension-x1);
		left: var(--dimension-x1);
		width: calc((100% - var(--dimension-x1) * 2) / var(--segment-count));
		border-radius: var(--radius-full);
		background-color: var(--palette-gray-00);
		box-shadow: inset 0 0 0 1px var(--stroke-neutral-muted);
		transition: transform var(--duration-d4) var(--ease-easing);
	}
	:global(.seed-segmented-control__item) {
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		cursor: pointer;
		user-select: none;
		box-sizing: border-box;
		overflow-wrap: break-word;
		min-width: 86px;
		min-height: 34px;
		gap: var(--dimension-x1-5);
		height: 100%;
		padding-inline: var(--dimension-x6);
		padding-block: var(--dimension-x1-5);
		border-radius: var(--radius-full);
		font-weight: var(--font-weight-bold);
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		color: var(--fg-neutral-subtle);
		transition: background-color var(--duration-color-transition) var(--ease-easing), color var(--duration-color-transition) var(--ease-easing), box-shadow var(--duration-color-transition) var(--ease-easing), outline-color var(--duration-d3) var(--ease-easing);
	}
	:global(.seed-segmented-control__item:is(:checked, [data-checked])) {
		color: var(--fg-neutral);
	}
	:global(.seed-segmented-control__item) {
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-segmented-control__item:is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-segmented-control__item:is(:disabled, [disabled], [data-disabled])) {
		cursor: not-allowed;
		color: var(--fg-disabled);
	}
	:global(.seed-segmented-control__item:is(:disabled, [disabled], [data-disabled]):is(:checked, [data-checked])) {
		background-color: var(--bg-disabled);
		box-shadow: inset 0 0 0 1px var(--stroke-neutral-muted);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-segmented-control__item:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, [data-checked]):is(:hover, [data-hover])) {
			background-color: var(--palette-gray-100);
			box-shadow: inset 0 0 0 1px var(--stroke-neutral-muted);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-segmented-control__item:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, [data-checked]):is(:active, [data-active])) {
			background-color: var(--palette-gray-100);
			box-shadow: inset 0 0 0 1px var(--stroke-neutral-muted);
		}
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-segmented-control__item:not(:is(:disabled, [disabled], [data-disabled])):not(:is(:checked, [data-checked])):is(:hover, [data-hover])) {
			background-color: var(--bg-neutral-weak-pressed);
			box-shadow: inset 0 0 0 1px var(--stroke-neutral-muted);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-segmented-control__item:not(:is(:disabled, [disabled], [data-disabled])):not(:is(:checked, [data-checked])):is(:active, [data-active])) {
			background-color: var(--bg-neutral-weak-pressed);
			box-shadow: inset 0 0 0 1px var(--stroke-neutral-muted);
		}
	}
	/* @end recipe */
</style>
