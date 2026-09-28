<!-- TDS Tab. Bar 47px on white, inset 20px (14px at the small size), item padding 0 8px,
     2px indicator inset 10px from each item edge. role=tablist/tab + aria-selected. -->
<script lang="ts">
	let {
		items = ["홈", "장부", "별장"],
		selected = $bindable(0),
		compact = false,
	}: { items?: string[]; selected?: number; compact?: boolean } = $props();
</script>

<div style:background="var(--surface-float)">
	data-tds-mobile-component="Tab"
	<div style:padding-left={compact ? "14px" : "var(--tab-inset)"}>
		<ul
			role="tablist"
			aria-orientation="horizontal"
			style:display="flex"
			style:list-style="none"
			style:margin="0"
			style:padding="0"
		>
			{#each items as item, i (item)}
				<li
					role="tab"
					aria-selected={selected === i}
					tabindex={selected === i ? 0 : -1}
					style:height="var(--tab-height)"
					style:padding-inline="var(--tab-item-padding)"
					style:display="flex"
					style:align-items="center"
					style:font-size="var(--text-body)"
					style:line-height="var(--control-label-leading)"
					style:color={selected === i ? "var(--foreground)" : "var(--grey-600)"}
					onclick={() => (selected = i)}
				>
					{item}
				</li>
			{/each}
		</ul>
		<div
			role="presentation"
			style:height="var(--tab-indicator-height)"
			style:margin-inline="var(--tab-indicator-inset)"
			style:background="var(--foreground)"
			style:transform="translateX(calc({selected} * (100% + var(--tab-item-padding) * 2)))"
			style:transition="transform 0.2s cubic-bezier(0.33, 1, 0.68, 1)"
		></div>
	</div>
</div>
