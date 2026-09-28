<!-- TDS BoardRow (components/board-row). FAQ-style disclosure row.
     header   56h, padding 16px 16px 16px 24px, base surface, role=button + aria-expanded
              prefix (e.g. "Q") 17/22.95/500 blue500, 8px before the title; title 17/22.95/500
              (blue500 when open, grey700 closed); 24px grey400 chevron rotates on open
     divider  closed rows keep a 1px hairline from x 24 at the bottom
     content  blue500 at 4% wash, padding 16px 0, text 15/22.5 grey700 inset 0 24 -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		title,
		prefix,
		open = $bindable(false),
		children,
	}: { title: string; prefix?: string; open?: boolean; children: Snippet } = $props();

	const id = `board-${Math.random().toString(36).slice(2, 8)}`;
</script>

<li class="tds-board-row" data-tds-mobile-component="BoardRow" data-open={open}>
	<div
		class="header"
		role="button"
		tabindex="0"
		aria-controls={id}
		aria-expanded={open}
		onclick={() => (open = !open)}
		onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (open = !open)}
	>
		<div class="title">
			{#if prefix}<span class="prefix">{prefix}</span>{/if}
			<span>{title}</span>
		</div>
		<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
	</div>
	<div class="content" {id} aria-hidden={!open} hidden={!open}>
		<div class="inner">{@render children()}</div>
	</div>
</li>

<style>
	.tds-board-row {
		position: relative;
		list-style: none;
	}
	.header {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 16px 16px var(--row-inset);
		background: var(--surface-base);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	[data-open="false"] .header::after {
		content: "";
		position: absolute;
		inset: auto 0 0 var(--row-inset);
		height: 1px;
		background: var(--hairline);
	}
	.title {
		display: flex;
		align-items: flex-start;
		margin-right: 16px;
		font-size: var(--text-row);
		line-height: var(--text-row--line-height);
		font-weight: 500;
		color: var(--ink-soft);
	}
	[data-open="true"] .title {
		color: var(--status-info);
	}
	.prefix {
		margin-right: 8px;
		color: var(--status-info);
	}
	.arrow {
		flex-shrink: 0;
		width: 24px;
		height: 24px;
		fill: none;
		stroke: var(--grey-400);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: rotate 0.2s var(--panel-fold-ease);
	}
	[data-open="true"] .arrow {
		rotate: 180deg;
	}
	.content {
		background: color-mix(in srgb, var(--blue-500) 4%, var(--surface-base));
	}
	.inner {
		padding: 16px var(--row-inset);
		font-size: var(--text-t6);
		line-height: var(--text-t6--line-height);
		color: var(--ink-soft);
	}
</style>
