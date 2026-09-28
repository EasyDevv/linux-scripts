<!-- TDS ListHeader (components/list-header).
     Column, padding 24px 0 8px.
     description   13/19.5 grey600, padding 0 24, above the title (descriptionPosition top) or below
     title row     margin-top 4, space-between; title 17/25.5/700 grey800 (t5 bold) inside a 0 4px / -4px hit
                   box starting at x 24; titleWidthRatio caps the title column (default 0.66)
     right         text 13/19.5 grey700 (+ grey400 chevron for RightArrow), margin-right 24,
                   rightAlignment center | bottom -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		title,
		description,
		descriptionPosition = "top",
		right,
		rightText,
		rightArrow = false,
		rightAlignment = "center",
		titleWidthRatio = 0.66,
		onRightClick,
	}: {
		title: string;
		description?: string;
		descriptionPosition?: "top" | "bottom";
		right?: Snippet;
		rightText?: string;
		rightArrow?: boolean;
		rightAlignment?: "center" | "bottom";
		titleWidthRatio?: number;
		onRightClick?: () => void;
	} = $props();
</script>

<div class="tds-list-header" data-tds-mobile-component="ListHeader" data-align={rightAlignment}>
	{#if description && descriptionPosition === "top"}<p class="desc">{description}</p>{/if}
	<div class="row">
		<div class="title-col" style:max-width={`${titleWidthRatio * 100}%`}>
			<h2 class="title">{title}</h2>
		</div>
		{#if right}
			<div class="right">{@render right()}</div>
		{:else if rightText}
			<button type="button" class="right text" onclick={onRightClick}>
				{rightText}
				{#if rightArrow}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" /></svg>{/if}
			</button>
		{/if}
	</div>
	{#if description && descriptionPosition === "bottom"}<p class="desc bottom">{description}</p>{/if}
</div>

<style>
	.tds-list-header {
		display: flex;
		flex-direction: column;
		padding: var(--list-header-padding);
	}
	.desc {
		margin: 0;
		padding: 0 var(--row-inset);
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		color: var(--ink-subtle);
	}
	.desc.bottom {
		margin-top: 4px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 4px;
	}
	[data-align="bottom"] .row {
		align-items: flex-end;
	}
	.tds-list-header > .row:first-child {
		margin-top: 0;
	}
	.title-col {
		display: flex;
		align-items: center;
		padding-left: var(--row-inset);
	}
	.title {
		margin: 0 -4px;
		padding: 0 4px;
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		font-weight: 700;
		color: var(--ink);
	}
	.right {
		display: flex;
		align-items: center;
		margin-right: var(--row-inset);
	}
	.text {
		gap: 2px;
		padding: 1px 0;
		border: 0;
		background: none;
		color: var(--ink-soft);
		font: inherit;
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		cursor: pointer;
	}
	.text svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: var(--grey-400);
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
