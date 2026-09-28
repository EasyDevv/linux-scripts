<!-- TDS GridList (components/grid-list).
     ul grid, column 1 | 2 | 3 (default 3), gap 8px, padding 0 24px 8px.
     Item min-height 72: r9 greyOpacity50 cell, column flex centred, gap 6, padding 12px 8px;
     24px image, label 14/21/500 grey900. -->
<script lang="ts">
	type Item = { label: string; image?: string; onclick?: () => void };

	let { items, column = 3 }: { items: Item[]; column?: 1 | 2 | 3 } = $props();
</script>

<ul class="tds-grid-list" data-tds-mobile-component="GridList" style:--cols={column}>
	{#each items as item (item.label)}
		<li>
			<button type="button" class="cell" onclick={item.onclick}>
				{#if item.image}<img src={item.image} alt="" />{:else}<span class="ph" aria-hidden="true"></span>{/if}
				<span class="label">{item.label}</span>
			</button>
		</li>
	{/each}
</ul>

<style>
	.tds-grid-list {
		display: grid;
		grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
		gap: var(--grid-gap);
		margin: 0;
		padding: 0 var(--row-inset) 8px;
		list-style: none;
	}
	li {
		min-height: 72px;
	}
	.cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		width: 100%;
		height: 100%;
		padding: var(--grid-cell-padding);
		border: 0;
		border-radius: var(--grid-cell-radius);
		background: var(--surface-well);
		color: var(--ink-strong);
		font: inherit;
		cursor: pointer;
		transition: background-color 0.1s;
	}
	.cell:active {
		background: var(--grey-opacity-100);
	}
	img,
	.ph {
		width: 24px;
		height: 24px;
	}
	.ph {
		border-radius: 7px;
		background: var(--grey-200);
	}
	.label {
		font-size: var(--text-st11);
		line-height: var(--text-st11--line-height);
		font-weight: 500;
	}
</style>
