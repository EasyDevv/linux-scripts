<!-- TDS ListFooter (components/list-footer). "더 보기" at the end of a list.
     li 59h (min), base surface; 1px hairline on top: border full | indented (from x 24) | none.
     Content 58h, padding 0 24, centred; text 17 at 1.252, weight 500, blue500 by default
     (textColor grey600 for a neutral footer, fontWeight bold uses blue400 700 in the docs). -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		border = "full",
		tone = "link",
		weight = "medium",
		onclick,
		icon,
		children,
	}: {
		border?: "full" | "indented" | "none";
		tone?: "link" | "subtle";
		weight?: "medium" | "bold";
		onclick?: () => void;
		icon?: Snippet;
		children: Snippet;
	} = $props();
</script>

<li class="tds-list-footer" data-tds-mobile-component="ListFooter" data-border={border} data-tone={tone} data-weight={weight}>
	<button type="button" class="content" {onclick}>
		{#if icon}{@render icon()}{/if}
		<span class="text">{@render children()}</span>
	</button>
</li>

<style>
	.tds-list-footer {
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: 59px;
		list-style: none;
		background: var(--surface-base);
	}
	.tds-list-footer::before {
		content: "";
		height: 1px;
		background: var(--hairline);
	}
	[data-border="indented"]::before {
		margin-left: var(--row-inset);
	}
	[data-border="none"]::before {
		background: transparent;
	}
	.content {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		height: var(--list-footer-height);
		padding: 0 var(--row-inset);
		border: 0;
		background: none;
		color: var(--ink-link);
		font: inherit;
		cursor: pointer;
	}
	[data-tone="subtle"] .content {
		color: var(--ink-subtle);
	}
	.text {
		font-size: var(--text-control);
		line-height: var(--control-label-leading);
		font-weight: 500;
	}
	[data-weight="bold"] .text {
		font-weight: 700;
	}
	[data-weight="bold"][data-tone="link"] .content {
		color: var(--blue-400);
	}
</style>
