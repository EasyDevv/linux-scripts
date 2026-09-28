<!-- TDS ListFooter. 58px row, 24px inset, 1px top hairline; the label is 17/21.284/500
     and turns blue500 when the row is pressed. role=button when it is a control. -->
<script lang="ts">
	let {
		label = "더 보기",
		active = $bindable(false),
		interactive = true,
	}: { label?: string; active?: boolean; interactive?: boolean } = $props();
</script>

<li
	data-tds-mobile-component="ListFooter"
	role={interactive ? "button" : undefined}
	tabindex={interactive ? 0 : undefined}
	style:background="var(--surface-float)"
>
	<div style:height="var(--divider-width)" style:background="var(--hairline)"></div>
	<div
		role="presentation"
		style:min-height="var(--list-footer-row-height)"
		style:padding-inline="var(--row-inset)"
		style:display="flex"
		style:align-items="center"
		style:justify-content="center"
		onclick={() => interactive && (active = true)}
		onkeydown={(e) => interactive && e.key === "Enter" && (active = true)}
	>
		<span
			style:font-size="var(--text-heading-sm)"
			style:line-height="var(--control-label-leading)"
			style:font-weight="500"
			style:color={active ? "var(--blue-500)" : "var(--grey-600)"}
		>
			{label}
		</span>
	</div>
</li>
