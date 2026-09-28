<!-- TDS GridList. 8px gap, 0 24px 8px padding, cell radius 9 on a 2% well,
     cell padding 12px 8px with a 6px internal gap, label 14/21/500. -->
<script lang="ts">
	let { items = [], columns = 3 }: { items?: { label: string; icon?: import("svelte").Snippet }[]; columns?: number } =
		$props();
</script>

<ul
	style:display="grid"
	data-tds-mobile-component="GridList"
	style:grid-template-columns="repeat({columns}, minmax(0, 1fr))"
	style:gap="var(--grid-gap)"
	style:padding="0 var(--row-inset) 8px"
	style:list-style="none"
	style:margin="0"
>
	{#each items as item (item.label)}
		<li>
			<div
				style:border-radius="var(--grid-cell-radius)"
				style:background="var(--surface-well)"
				style:padding="var(--grid-cell-padding)"
				style:display="grid"
				style:gap="6px"
			>
				{#if item.icon}{@render item.icon()}{/if}
				<span
					style:font-size="14px"
					style:line-height="21px"
					style:font-weight="500"
					style:color="var(--grey-900)"
				>
					{item.label}
				</span>
			</div>
		</li>
	{/each}
</ul>
