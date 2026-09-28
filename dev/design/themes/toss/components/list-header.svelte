<!-- TDS ListHeader. padding 24px 0 8px, inset 24px; support 13/19.5 grey600 above,
     title 20px with a 4px offset, accessory 13/19.5 grey700 at +24px. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		title,
		support,
		accessory,
		action,
	}: { title: string; support?: string; accessory?: string; action?: Snippet } = $props();
</script>

<div style:padding="var(--list-header-padding)">
	data-tds-mobile-component="ListHeader"
	{#if support}
		<p
			style:padding-inline="var(--row-inset)"
			style:margin="0"
			style:font-size="var(--text-label)"
			style:line-height="var(--text-label--line-height)"
			style:color="var(--grey-600)"
		>
			{support}
		</p>
	{/if}
	<div style:margin-top="4px" style:padding-inline="var(--row-inset)" style:display="flex" style:align-items="center">
		<h2
			style:margin="0"
			style:flex="1"
			style:font-size="20px"
			style:line-height="26px"
			style:font-weight="600"
			style:color="var(--grey-800)"
		>
			{title}
		</h2>
		{#if accessory}
			<span
				style:margin-left="24px"
				style:font-size="var(--text-label)"
				style:line-height="var(--text-label--line-height)"
				style:color="var(--grey-700)"
			>
				{accessory}
			</span>
		{/if}
		{#if action}{@render action()}{/if}
	</div>
</div>
