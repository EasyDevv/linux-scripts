<!-- TDS ListRow. Row padding 12px 24px, hover well radius 12, content gap 16px,
     accessory offset 12px, min height 44px. Composition order: leading, texts, trailing. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		title,
		support,
		leading,
		trailing,
		chevron = false,
	}: {
		title: string;
		support?: string;
		leading?: Snippet;
		trailing?: Snippet;
		chevron?: boolean;
	} = $props();
</script>

<li
	data-tds-mobile-component="ListRow"
	style:padding-block="var(--list-row-padding-block)" style:padding-inline="var(--row-inset)">
	<div
		style:border-radius="var(--list-row-radius)"
		style:display="flex"
		style:align-items="center"
		style:gap="var(--list-row-gap)"
		style:min-height="22px"
	>
		{#if leading}{@render leading()}{/if}
		<div style:display="grid" style:gap="2px" style:flex="1" style:min-width="0">
			<span
				style:font-size="var(--text-heading-sm)"
				style:line-height="22.95px"
				style:font-weight="500"
				style:color="var(--grey-700)"
			>
				{title}
			</span>
			{#if support}
				<span
					style:font-size="var(--text-body-sm)"
					style:line-height="var(--text-body-sm--line-height)"
					style:color="var(--grey-600)"
				>
					{support}
				</span>
			{/if}
		</div>
		{#if trailing}
			<span style:margin-left="12px" style:color="var(--grey-700)">{@render trailing()}</span>
		{/if}
		{#if chevron}
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" style:color="var(--grey-400)">
				<path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
			</svg>
		{/if}
	</div>
</li>
