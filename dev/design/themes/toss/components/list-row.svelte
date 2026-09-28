<!-- TDS ListRow (components/ListRow). li, min-height 44.
     padding    verticalPadding small 8 · medium 12 · large 16 · xlarge 24, inline 24 (--row-inset)
     layout     left asset → 12px → texts (flex 1) → 16px gap → right; texts column centred
     texts      type 1 row: 17/22.95/500 grey700
                type 2 rows: title 17/22.95/700 grey800 + sub 15/20.25/400 grey600
                caption 13/17.55/500 grey600 (third row)
     divider    border "indented" = 1px hairline from x 24 on the row's top edge; "none" hides it
     pressable  withTouchEffect = greyOpacity50 press layer, r12 inset 6px (hover well)
     right      a Button small weak, a Switch, TextButton, or text: pass the right snippet;
                withArrow adds the 24px grey400 chevron. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		title,
		description,
		caption,
		left,
		right,
		withArrow = false,
		padding = "medium",
		border = "none",
		onclick,
	}: {
		title: string;
		description?: string;
		caption?: string;
		left?: Snippet;
		right?: Snippet;
		withArrow?: boolean;
		padding?: "small" | "medium" | "large" | "xlarge";
		border?: "indented" | "none";
		onclick?: () => void;
	} = $props();

	const twoRow = $derived(Boolean(description || caption));
</script>

<li
	class="tds-list-row"
	data-tds-mobile-component="ListRow"
	data-padding={padding}
	data-border={border}
	data-pressable={Boolean(onclick)}
	role={onclick ? "button" : undefined}
	tabindex={onclick ? 0 : undefined}
	{onclick}
	onkeydown={onclick ? (e) => (e.key === "Enter" || e.key === " ") && onclick() : undefined}
>
	<div class="content">
		{#if left}<span class="left">{@render left()}</span>{/if}
		<span class="body">
			<span class="texts" data-rows={twoRow ? 2 : 1}>
				<span class="title" role="text">{title}</span>
				{#if description}<span class="sub" role="text">{description}</span>{/if}
				{#if caption}<span class="caption" role="text">{caption}</span>{/if}
			</span>
			{#if right}<span class="right">{@render right()}</span>{/if}
			{#if withArrow}
				<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" /></svg>
			{/if}
		</span>
	</div>
</li>

<style>
	.tds-list-row {
		--pv: var(--list-row-padding);
		position: relative;
		display: flex;
		align-items: center;
		min-height: 44px;
		list-style: none;
		-webkit-tap-highlight-color: transparent;
	}
	.tds-list-row[data-padding="small"] {
		--pv: var(--list-row-padding-sm);
	}
	.tds-list-row[data-padding="large"] {
		--pv: var(--list-row-padding-lg);
	}
	.tds-list-row[data-padding="xlarge"] {
		--pv: var(--list-row-padding-xl);
	}
	.tds-list-row[data-border="indented"]::before {
		content: "";
		position: absolute;
		inset: 0 0 auto var(--row-inset);
		height: 1px;
		background: var(--hairline);
	}
	.tds-list-row[data-pressable="true"] {
		cursor: pointer;
	}
	.tds-list-row[data-pressable="true"]::after {
		content: "";
		position: absolute;
		inset: 0 6px;
		border-radius: var(--list-row-radius);
		background: transparent;
		transition: background-color 0.1s;
		pointer-events: none;
	}
	.tds-list-row[data-pressable="true"]:active::after {
		background: var(--grey-opacity-50);
	}
	.content {
		flex: 1;
		display: flex;
		align-items: center;
		min-width: 0;
		padding: var(--pv) var(--row-inset);
	}
	.left {
		display: flex;
		flex-shrink: 0;
		margin-right: 12px;
	}
	.body {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--list-row-gap);
		min-width: 0;
	}
	.texts {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		min-width: 0;
	}
	.title {
		font-size: var(--text-row);
		line-height: var(--text-row--line-height);
		font-weight: 500;
		color: var(--ink-soft);
	}
	[data-rows="2"] .title {
		font-weight: 700;
		color: var(--ink);
	}
	.sub {
		font-size: var(--text-row-sm);
		line-height: var(--text-row-sm--line-height);
		color: var(--ink-subtle);
	}
	.caption {
		font-size: var(--text-row-xs);
		line-height: var(--text-row-xs--line-height);
		font-weight: 500;
		color: var(--ink-subtle);
	}
	.right {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		justify-content: flex-end;
		max-width: calc(80% - 16px);
		color: var(--ink-soft);
		font-size: var(--text-row-sm);
		line-height: var(--text-row-sm--line-height);
	}
	.arrow {
		flex-shrink: 0;
		width: 24px;
		height: 24px;
		margin-left: -8px;
		fill: none;
		stroke: var(--grey-400);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
