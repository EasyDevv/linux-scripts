<!-- TDS SearchField. Outer 14px 16px, well 44h radius 12 padding 8px 10px, 8px gap,
     24px leading icon, optional clear + cancel. -->
<script lang="ts">
	import Search from "@lucide/svelte/icons/search";

	let { value = $bindable("") }: { value?: string } = $props();
</script>

<div style:padding="14px 16px"
	data-tds-mobile-component="SearchField" style:background="var(--surface-float)">
	<div
		style:min-height="44px"
		style:padding="var(--field-well-padding)"
		style:border-radius="var(--field-well-radius)"
		style:background="var(--surface-hover)"
		style:display="flex"
		style:align-items="center"
		style:gap="8px"
	>
		<Search size={24} color="var(--grey-500)" />
		<input
			bind:value
			placeholder="검색"
			aria-label="검색"
			style:flex="1"
			style:border="none"
			style:outline="none"
			style:background="transparent"
			style:font-size="var(--text-body)"
			style:line-height="var(--text-body--line-height)"
			style:color="var(--grey-800)"
		/>
		{#if value}
			<button type="button" aria-label="지우기" style:color="var(--grey-500)">×</button>
		{/if}
	</div>
</div>
