<script lang="ts">
	import type { Snippet } from "svelte";

	/** Category of a settings/form dialog body (Linear Settings › Security `groupHeader` + well).
	 *  Rows inside are `setting-row.svelte`; the hairline between two rows is drawn here.
	 *  Stack sections with a 24px gap in a dialog (`betweenGroupsInDialog`), 48px on a page. */
	let {
		id,
		title,
		lede,
		children,
	}: {
		/** Heading id; the section is labelled by it. */
		id: string;
		title: string;
		/** One line under the heading. Use it when every row in the group shares one purpose. */
		lede?: string;
		children: Snippet;
	} = $props();
</script>

<section class="setting-section" aria-labelledby={id} data-role="setting-section">
	<h3 {id}>{title}</h3>
	{#if lede}
		<p class="lede">{lede}</p>
	{/if}
	<div class="well">
		{@render children()}
	</div>
</section>

<style>
	h3 {
		margin: 0;
		padding-inline: var(--well-row-inset, 16px);
		font-size: var(--text-heading-sm);
		line-height: var(--text-heading-sm--line-height);
		font-weight: 500;
		color: var(--ink-soft, var(--foreground));
	}
	.lede {
		margin: 4px 0 0;
		padding-inline: var(--well-row-inset, 16px);
		font-size: var(--text-body-base);
		line-height: 22px;
		font-weight: 450;
		color: var(--muted-foreground);
	}
	.well {
		margin-top: 12px;
		overflow: hidden;
		border-radius: var(--radius-md);
		background: var(--secondary);
	}
	/* Hairline inset by the row padding, at --foreground 0.1 (not --border). */
	.well > :global([data-role="setting-row"] + [data-role="setting-row"])::before {
		content: "";
		position: absolute;
		top: 0;
		left: var(--well-row-inset, 16px);
		right: var(--well-row-inset, 16px);
		height: var(--hairline-width);
		background: color-mix(in oklab, var(--foreground) 10%, transparent);
	}
</style>
