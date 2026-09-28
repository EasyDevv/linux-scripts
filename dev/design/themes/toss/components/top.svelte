<!-- TDS Top (components/top). Screen title block.
     column, padding upperGap 24 / lowerGap 24
     upper       asset row (60 / 40px) inset 0 24, 16px above the title
     title       t3 22/31/700 grey800 (heading level 1); large = 28/37/700 (st2)
     subtitle    top or bottom of the title: t5 17/25.5/500 grey700, padding-top 4
     right       wrapper centred (or end), 8px gap from the title column: Button medium with margin 0 24 0 8,
                 or a 24px grey600 RightArrow
     lower       Button small (margin-left 20) or a 2-button CTA, 16px under the title -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		title,
		subtitleTop,
		subtitleBottom,
		size = "medium",
		upper,
		right,
		lower,
		upperGap = 24,
		lowerGap = 24,
		rightVerticalAlign = "center",
	}: {
		title: string;
		subtitleTop?: string;
		subtitleBottom?: string;
		size?: "medium" | "large";
		upper?: Snippet;
		right?: Snippet;
		lower?: Snippet;
		upperGap?: number;
		lowerGap?: number;
		rightVerticalAlign?: "center" | "end";
	} = $props();
</script>

<header
	class="tds-top"
	data-tds-mobile-component="Top"
	data-size={size}
	data-align={rightVerticalAlign}
	style:padding-top={`${upperGap}px`}
	style:padding-bottom={`${lowerGap}px`}
>
	{#if upper}<div class="upper">{@render upper()}</div>{/if}
	<div class="main">
		<div class="texts">
			{#if subtitleTop}<p class="sub top" role="heading" aria-level={2}>{subtitleTop}</p>{/if}
			<h1 class="title">{title}</h1>
			{#if subtitleBottom}<p class="sub" role="heading" aria-level={2}>{subtitleBottom}</p>{/if}
		</div>
		{#if right}<div class="right">{@render right()}</div>{/if}
	</div>
	{#if lower}<div class="lower">{@render lower()}</div>{/if}
</header>

<style>
	.tds-top {
		display: flex;
		flex-direction: column;
	}
	.upper {
		display: flex;
		margin: 0 var(--row-inset) 16px;
	}
	.main {
		display: flex;
		gap: 8px;
	}
	.texts {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		min-width: 0;
		padding: 0 var(--row-inset);
	}
	.main:has(.right) .texts {
		padding-right: 0;
	}
	.title {
		margin: 0;
		font-size: var(--text-t3);
		line-height: var(--text-t3--line-height);
		font-weight: 700;
		color: var(--ink);
		word-break: keep-all;
	}
	[data-size="large"] .title {
		font-size: var(--text-st2);
		line-height: var(--text-st2--line-height);
	}
	.sub {
		margin: 0;
		padding-top: 4px;
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		font-weight: 500;
		color: var(--ink-soft);
	}
	.sub.top {
		padding: 0 0 4px;
	}
	.right {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		margin-right: var(--row-inset);
	}
	[data-align="end"] .right {
		align-items: flex-end;
	}
	.lower {
		display: flex;
		gap: 8px;
		margin: 16px 0 0;
		padding: 0 var(--cta-inset);
	}
</style>
