<!-- TDS BoardRow (FAQ). Header padding 16px 16px 16px 24px, hover well radius 12 at
     4px 6px, title 17/22.95, chevron 24x24, body padding 16px 0 with a 24px inset.
     aria-expanded + aria-controls drive the fold. -->
<script lang="ts">
	let {
		title,
		body,
		open = $bindable(false),
	}: { title: string; body: string; open?: boolean } = $props();
</script>

<li>
	data-tds-mobile-component="BoardRow"
	<button
		type="button"
		role="button"
		aria-expanded={open}
		aria-controls="tds-board-body"
		style:width="100%"
		style:padding="16px 16px 16px 24px"
		style:background="var(--surface-float)"
		style:display="flex"
		style:align-items="center"
		onclick={() => (open = !open)}
	>
		<div style:border-radius="var(--list-row-radius)" style:padding="4px 6px" style:flex="1" style:text-align="left">
			<span
				style:font-size="var(--text-heading-sm)"
				style:line-height="22.95px"
				style:color={open ? "var(--blue-500)" : "var(--grey-900)"}
			>
				{title}
			</span>
		</div>
		<svg
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden="true"
			style:color="var(--grey-500)"
			style:transform={open ? "rotate(180deg)" : "none"}
		>
			<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
		</svg>
	</button>
	{#if open}
		<div id="tds-board-body" aria-hidden="false" style:background="var(--surface-grey)" style:padding="16px 0">
			<p
				style:margin="0"
				style:padding-inline="var(--row-inset)"
				style:font-size="var(--text-body)"
				style:line-height="var(--text-body--line-height)"
				style:color="var(--grey-700)"
			>
				{body}
			</p>
		</div>
	{/if}
</li>
