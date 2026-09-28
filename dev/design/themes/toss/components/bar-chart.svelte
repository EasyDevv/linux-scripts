<!-- TDS BarChart (components/Chart/bar-chart). height 205 (default), padding 12px 24px.
     Columns share the width (42 each at 253); bar 28 wide, r7; fill radial-gradient at the bottom-left
     corner from the 300 step to the 500 step of the theme hue (blue: 100,168,255 -> 49,130,246).
     Annotation above the bar: 12/18/600 in the 700 step, 6px side margin, 2px gap.
     Axis label under the chart: 11/16.5/500 grey600, margin-top 6.
     fill: all-bar paints every bar in the theme; single-bar paints only barIndex, the rest grey;
     auto highlights the last `count` bars. -->
<script lang="ts">
	type Theme = "blue" | "green" | "yellow" | "orange" | "red" | "grey";
	type Datum = { value: number; label?: string; annotation?: string | number; theme?: Theme };
	type Fill = { type: "all-bar"; theme: Theme } | { type: "single-bar"; theme: Theme; barIndex: number } | { type: "auto"; theme: Theme; count: number };

	let {
		data,
		fill = { type: "all-bar", theme: "blue" },
		height = 205,
		maxValue,
	}: { data: Datum[]; fill?: Fill; height?: number; maxValue?: number } = $props();

	const top = $derived(maxValue ?? Math.max(...data.map((d) => d.value), 1));
	function themeOf(d: Datum, i: number): Theme {
		if (d.theme) return d.theme;
		if (fill.type === "all-bar") return fill.theme;
		if (fill.type === "single-bar") return i === fill.barIndex ? fill.theme : "grey";
		return i >= data.length - fill.count ? fill.theme : "grey";
	}
</script>

<figure class="tds-bar-chart" data-tds-mobile-component="BarChart" style:height={`${height}px`}>
	<div class="plot">
		{#each data as d, i (i)}
			<div class="col" data-theme={themeOf(d, i)}>
				{#if d.annotation !== undefined}<span class="note">{d.annotation}</span>{/if}
				<div class="bar" style:height={`${(d.value / top) * 100}%`}></div>
			</div>
		{/each}
	</div>
	<div class="axis">
		{#each data as d, i (i)}<span>{d.label ?? ""}</span>{/each}
	</div>
</figure>

<style>
	.tds-bar-chart {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		margin: 0;
		padding: 12px var(--row-inset);
	}
	.plot {
		flex: 1;
		display: flex;
		justify-content: center;
		min-height: 0;
	}
	.col {
		--lo: var(--blue-300);
		--hi: var(--blue-500);
		--ink: var(--blue-700);
		flex: 1 1 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
	}
	.col[data-theme="green"] {
		--lo: var(--green-300);
		--hi: var(--green-500);
		--ink: var(--green-700);
	}
	.col[data-theme="yellow"] {
		--lo: var(--yellow-300);
		--hi: var(--yellow-500);
		--ink: var(--yellow-800);
	}
	.col[data-theme="orange"] {
		--lo: var(--orange-300);
		--hi: var(--orange-500);
		--ink: var(--orange-700);
	}
	.col[data-theme="red"] {
		--lo: var(--red-300);
		--hi: var(--red-500);
		--ink: var(--red-700);
	}
	.col[data-theme="grey"] {
		--lo: var(--grey-200);
		--hi: var(--grey-300);
		--ink: var(--grey-600);
	}
	.note {
		margin: 0 6px 2px;
		color: var(--ink);
		font-size: var(--text-st12);
		line-height: var(--text-st12--line-height);
		font-weight: 600;
	}
	.bar {
		width: 28px;
		min-height: 4px;
		border-radius: 7px;
		background: radial-gradient(circle at 0% 100%, var(--lo) 0%, var(--hi) 66%);
	}
	.axis {
		display: flex;
		justify-content: center;
		margin-top: 6px;
	}
	.axis span {
		flex: 1 1 0;
		margin: 0 2px;
		text-align: center;
		color: var(--ink-subtle);
		font-size: var(--text-st13);
		line-height: var(--text-st13--line-height);
		font-weight: 500;
	}
</style>
