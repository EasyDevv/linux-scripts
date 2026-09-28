<!-- TDS TableRow (components/table-row). Key / value rows (영수증, 이체 정보).
     li 42h flex; left cell padding 10px 8px 10px 24px, right cell padding 10px 24px 10px 8px.
     Text 16/21.6 (x1.35): left grey700 (label), right grey900 (data).
     align space-between = value pushed right (default); left = value follows at leftRatio of the row. -->
<script lang="ts">
	type Row = { left: string; right: string };

	let {
		rows,
		align = "space-between",
		leftRatio = 35,
	}: { rows: Row[]; align?: "left" | "space-between"; leftRatio?: number } = $props();
</script>

<ul class="tds-table" data-tds-mobile-component="TableRow" data-align={align} style:--ratio={`${leftRatio}%`}>
	{#each rows as row (row.left)}
		<li>
			<span class="left">{row.left}</span>
			<span class="right">{row.right}</span>
		</li>
	{/each}
</ul>

<style>
	.tds-table {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		justify-content: space-between;
		font-size: var(--text-st10);
		line-height: 21.6px;
	}
	.left {
		flex-shrink: 0;
		padding: 10px 8px 10px var(--row-inset);
		color: var(--ink-soft);
	}
	.right {
		padding: 10px var(--row-inset) 10px 8px;
		color: var(--ink-strong);
		text-align: right;
	}
	[data-align="left"] li {
		justify-content: flex-start;
	}
	[data-align="left"] .left {
		flex-basis: var(--ratio);
	}
	[data-align="left"] .right {
		text-align: left;
	}
</style>
