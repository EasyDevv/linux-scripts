<!-- TDS Agreement. 5% well at 12px radius, row padding 10px 20px, 15/22.5 text,
     28x28 expand toggle (2px padding, 6px radius), optional 4px progress bar. -->
<script lang="ts">
	let {
		title,
		required = false,
		open = $bindable(false),
		children,
	}: { title: string; required?: boolean; open?: boolean; children?: import("svelte").Snippet } = $props();
</script>

<div>
	<div
		style:border-radius="var(--list-row-radius)"
		style:background="var(--surface-hover)"
		style:padding="10px 20px"
		style:display="flex"
		style:align-items="center"
		style:gap="16px"
	>
		<button
			type="button"
			aria-expanded={open}
			aria-label={open ? "접기" : "펼치기"}
			style:width="28px"
			style:height="28px"
			style:padding="2px"
			style:border="none"
			style:border-radius="6px"
			style:background="transparent"
			style:color="var(--grey-700)"
			style:flex-shrink="0"
			onclick={() => (open = !open)}
		>
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" style:transform={open ? "rotate(180deg)" : "none"}>
				<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
			</svg>
		</button>
		<span style:flex="1" style:font-size="var(--text-body-sm)" style:line-height="var(--text-body-sm--line-height)">
			{required ? "[필수]  " : "[선택]  "}{title}
		</span>
		{#if open}
			<button type="button" style:color="var(--blue-500)" style:font-size="var(--text-body-sm)">약관 보기</button>
		{/if}
	</div>
	{#if open && children}
		<div style:padding="10px 20px">{@render children()}</div>
	{/if}
</div>
