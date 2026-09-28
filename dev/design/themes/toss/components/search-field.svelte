<!-- TDS SearchField (components/search-field).
     Bar padding 14px 16px on the base surface, followed by a 16px fade (surface -> transparent).
     Well 44h (min), padding 8px 10px, r12, greyOpacity100, gap 8px:
     24px grey600 search icon · input 16/20 grey900 · clear button (grey400) when there is a value.
     fixed = sticky to the top of the scroller. -->
<script lang="ts">
	import type { HTMLInputAttributes } from "svelte/elements";

	let {
		value = $bindable(""),
		placeholder = "검색어를 입력하세요",
		fixed = false,
		onDeleteClick,
		...rest
	}: { value?: string; placeholder?: string; fixed?: boolean; onDeleteClick?: () => void } & Omit<HTMLInputAttributes, "value"> =
		$props();
</script>

<div class="tds-search-field" data-tds-mobile-component="SearchField" data-fixed={fixed}>
	<div class="bar">
		<label class="well">
			<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 20 20" /></svg>
			<input {...rest} type="search" bind:value {placeholder} />
			{#if value}
				<button
					type="button"
					class="clear"
					aria-label="검색어 삭제"
					onclick={() => {
						value = "";
						onDeleteClick?.();
					}}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M9 9l6 6M15 9l-6 6" /></svg>
				</button>
			{/if}
		</label>
	</div>
	<div class="fade" aria-hidden="true"></div>
</div>

<style>
	.tds-search-field[data-fixed="true"] {
		position: sticky;
		top: 0;
		z-index: 2;
	}
	.bar {
		padding: 14px 16px;
		background: var(--surface-base);
	}
	.fade {
		height: 16px;
		background: linear-gradient(var(--surface-base), transparent);
	}
	.well {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: var(--field-well-height);
		padding: var(--field-well-padding);
		border-radius: var(--field-well-radius);
		background: var(--grey-opacity-100);
	}
	.icon {
		flex-shrink: 0;
		width: var(--icon-size);
		height: var(--icon-size);
		fill: none;
		stroke: var(--ink-subtle);
		stroke-width: 2.2;
		stroke-linecap: round;
	}
	input {
		flex: 1;
		min-width: 0;
		padding: 0;
		border: 0;
		outline: none;
		background: transparent;
		color: var(--ink-strong);
		font: inherit;
		font-size: var(--text-st10);
		line-height: 20px;
		appearance: none;
	}
	input::-webkit-search-cancel-button {
		display: none;
	}
	input::placeholder {
		color: var(--ink-disabled);
	}
	.clear {
		display: inline-flex;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
	}
	.clear svg {
		width: 20px;
		height: 20px;
	}
	.clear circle {
		fill: var(--grey-400);
	}
	.clear path {
		stroke: var(--surface-base);
		stroke-width: 2;
		stroke-linecap: round;
	}
</style>
