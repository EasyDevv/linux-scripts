<!-- TDS Tab (components/tab).
     large  bar 47h (+1px hairline under), list inset 0 0 0 20px, item padding 0 8px,
            text 17 at 1.252 with 12px/14px vertical padding; selected 700 grey800, idle 600 grey600
     small  bar 37h, 15px text
     indicator 2px, grey800, r1, inset 10px inside the selected item's box
     redBean = 6px red dot after the label. role=tablist / role=tab + aria-selected. -->
<script lang="ts">
	type Item = { key: string; label: string; redBean?: boolean };

	let {
		items,
		value = $bindable(items[0]?.key),
		size = "large",
		fluid = false,
		label = "탭",
	}: { items: Item[]; value?: string; size?: "large" | "small"; fluid?: boolean; label?: string } = $props();
</script>

<div class="tds-tab" data-tds-mobile-component="Tab" data-size={size} data-fluid={fluid}>
	<ul role="tablist" aria-label={label} aria-orientation="horizontal">
		{#each items as item (item.key)}
			<li
				role="tab"
				aria-selected={item.key === value}
				tabindex={item.key === value ? 0 : -1}
				onclick={() => (value = item.key)}
				onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (value = item.key)}
			>
				<span class="text">
					{item.label}
					{#if item.redBean}<i class="bean" aria-label="새 소식"></i>{/if}
				</span>
			</li>
		{/each}
	</ul>
</div>

<style>
	.tds-tab {
		--fs: var(--text-control);
		--pt: 12px;
		--pb: 14px;
		position: relative;
		background: var(--surface-base);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tds-tab[data-size="small"] {
		--fs: var(--text-control-md);
		--pt: 8px;
		--pb: 10px;
	}
	.tds-tab::after {
		content: "";
		position: absolute;
		inset: auto 0 0;
		height: 1px;
		background: var(--hairline);
	}
	ul {
		display: flex;
		margin: 0;
		padding: 0 var(--tab-inset) 0 var(--tab-inset);
		list-style: none;
	}
	[data-fluid="false"] li {
		flex: 1 1 0;
	}
	li {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 var(--tab-item-padding);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	.text {
		position: relative;
		padding: var(--pt) 0 var(--pb);
		font-size: var(--fs);
		line-height: var(--control-label-leading);
		font-weight: 600;
		color: var(--ink-subtle);
		white-space: nowrap;
	}
	[aria-selected="true"] .text {
		font-weight: 700;
		color: var(--ink);
	}
	[aria-selected="true"]::after {
		content: "";
		position: absolute;
		inset: auto var(--tab-indicator-inset) 0;
		z-index: 1;
		height: var(--tab-indicator-height);
		border-radius: 1px;
		background: var(--ink);
	}
	.bean {
		position: absolute;
		top: calc(var(--pt) - 1px);
		right: -8px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--red-500);
	}
</style>
