<!-- TDS SegmentedControl (components/segmented-control), size small.
     Outer inset 0 24px. Track 48h r14 greyOpacity100, padding 4px 5px, role=radiogroup.
     Items 40h r12, label padding 7px 12px, 17/25.5: selected 600 grey800, idle 500 grey600.
     Thumb 40h r10 white (surface-float) + 0 1px 2px rgba(0,0,0,.09), slides under the selected item.
     alignment fixed = equal columns; fluid = items hug their labels. -->
<script lang="ts">
	type Item = { value: string; label: string };

	let {
		items,
		value = $bindable(items[0]?.value),
		alignment = "fixed",
		name = "segmented",
	}: { items: Item[]; value?: string; alignment?: "fixed" | "fluid"; name?: string } = $props();

	const index = $derived(Math.max(0, items.findIndex((i) => i.value === value)));
</script>

<div class="tds-segmented" data-tds-mobile-component="SegmentedControl" data-alignment={alignment}>
	<div class="track" role="radiogroup" style:--count={items.length} style:--index={index}>
		{#if alignment === "fixed"}<span class="thumb" aria-hidden="true"></span>{/if}
		{#each items as item (item.value)}
			<label class="item" aria-selected={item.value === value}>
				<input type="radio" {name} value={item.value} bind:group={value} />
				<span class="text">{item.label}</span>
			</label>
		{/each}
	</div>
</div>

<style>
	.tds-segmented {
		padding: 0 var(--row-inset);
	}
	.track {
		position: relative;
		display: flex;
		align-items: stretch;
		height: var(--segment-height);
		padding: var(--segment-padding);
		border-radius: var(--segment-radius);
		background: var(--grey-opacity-100);
	}
	.thumb {
		position: absolute;
		top: 4px;
		bottom: 4px;
		left: 5px;
		width: calc((100% - 10px) / var(--count));
		border-radius: var(--segment-thumb-radius);
		background: var(--surface-float);
		box-shadow: var(--shadow-thumb);
		translate: calc(100% * var(--index)) 0;
		transition: translate 0.25s var(--panel-fold-ease);
	}
	.item {
		position: relative;
		z-index: 1;
		flex: 1 1 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 7px 12px;
		border-radius: 12px;
		cursor: pointer;
	}
	[data-alignment="fluid"] .item {
		flex: 0 0 auto;
	}
	[data-alignment="fluid"] .item[aria-selected="true"] {
		border-radius: var(--segment-thumb-radius);
		background: var(--surface-float);
		box-shadow: var(--shadow-thumb);
	}
	.item input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.text {
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		font-weight: 500;
		color: var(--ink-subtle);
		white-space: nowrap;
	}
	.item[aria-selected="true"] .text {
		font-weight: 600;
		color: var(--ink);
	}
	.item:has(input:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
</style>
