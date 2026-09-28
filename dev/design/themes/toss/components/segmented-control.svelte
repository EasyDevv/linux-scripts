<!-- TDS SegmentedControl. Track radius 14 on a 5% well, inner padding 4px 5px,
     container padding 0 24px. Selected 17/25.5/600 grey800, idle /500 grey600.
     role=radiogroup, not role=tablist. -->
<script lang="ts">
	let { items = ["아이템1", "아이템2", "아이템3"], selected = $bindable(0) }: { items?: string[]; selected?: number } =
		$props();
</script>

<div style:padding-inline="var(--segment-inset)">
	data-tds-mobile-component="SegmentedControl"
	<div
		style:border-radius="var(--segment-radius)"
		style:background="var(--surface-hover)"
		style:padding="var(--segment-padding)"
	>
		<div role="radiogroup" aria-required="false" style:display="flex">
			{#each items as item, i (item)}
				<button
					type="button"
					role="radio"
					aria-checked={selected === i}
					style:flex="1"
					style:height="40px"
					style:border-radius="var(--control-radius-lg)"
					style:background={selected === i ? "var(--surface-float)" : "transparent"}
					style:font-size="var(--text-body)"
					style:line-height="var(--text-body--line-height)"
					style:font-weight={selected === i ? 600 : 500}
					style:color={selected === i ? "var(--grey-800)" : "var(--grey-600)"}
					onclick={() => (selected = i)}
				>
					{item}
				</button>
			{/each}
		</div>
	</div>
</div>
