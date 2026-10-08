<script lang="ts">
	import type { Snippet } from "svelte";

	/** One row of a `setting-section.svelte` well (`settingRow`): title + one short description
	 *  line on the left, the control end-aligned on the right. The control keeps a fixed width
	 *  chosen for its values (select `w-16`/`w-28`/`w-36`, input `w-40`), never the rest of the row. */
	let {
		id,
		title,
		description,
		live = false,
		children,
	}: {
		/** The control's id: the title is its `<label for>`, the description `{id}-desc`. */
		id: string;
		title: string;
		/** One short line. Wraps mean the copy is too long, not the row too narrow. */
		description?: string;
		/** The description changes in place (a name check): announce it. */
		live?: boolean;
		/** The control. Give it `aria-describedby="{id}-desc"` when there is a description. */
		children: Snippet;
	} = $props();
</script>

<div class="setting-row" data-role="setting-row">
	<div class="text">
		<label for={id}>{title}</label>
		{#if description}
			<p id={`${id}-desc`} role={live ? "status" : undefined}>{description}</p>
		{/if}
	</div>
	{@render children()}
</div>

<style>
	.setting-row {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 16px;
	}
	.text {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 3px;
	}
	label {
		font-size: var(--text-heading-sm);
		line-height: var(--text-heading-sm--line-height);
		font-weight: 500;
		color: var(--foreground);
	}
	p {
		margin: 0;
		font-size: var(--text-body-sm);
		line-height: var(--text-body-sm--line-height);
		font-weight: 450;
		color: var(--muted-foreground);
	}
	.setting-row > :global(:last-child:not(.text)) {
		flex-shrink: 0;
	}
</style>
