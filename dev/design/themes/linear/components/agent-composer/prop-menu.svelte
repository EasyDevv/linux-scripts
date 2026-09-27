<!--
  컴포저 팝오버의 목록 상자와 행 하이라이트다.
  겉면·행 스타일 값은 `prop-menu.ts`가, 행 클래스가 걸린 하이라이트는 여기가 맡는다.
-->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { PROP_MENU_LIST_STYLE } from "./prop-menu.ts";

	let { children }: { children: Snippet } = $props();
</script>

<div class="prop-menu-list flex flex-col" style={PROP_MENU_LIST_STYLE}>
	{@render children()}
</div>

<style>
	:global(.prop-menu-item.prop-menu-item) {
		position: relative;
		background-color: transparent !important;
	}
	:global(.prop-menu-item.prop-menu-item::before) {
		content: "";
		pointer-events: none;
		position: absolute;
		inset: 0 6px;
		border-radius: 8px;
		z-index: 0;
	}
	:global(.prop-menu-item.prop-menu-item:hover::before),
	:global(.prop-menu-item.prop-menu-item[data-highlighted="true"]::before) {
		background: rgb(49, 50, 52);
	}
	:global(
		.prop-menu-list:not(:has(.prop-menu-item:hover)):not(:has(.prop-menu-item[data-highlighted="true"]))
			.prop-menu-item[data-selected="true"]::before
	) {
		background: rgb(49, 50, 52);
	}
	:global(.prop-menu-item.prop-menu-item > *) {
		position: relative;
		z-index: 1;
	}
	:global(.prop-menu-item.prop-menu-item:hover .prop-menu-label),
	:global(.prop-menu-item.prop-menu-item[data-highlighted="true"] .prop-menu-label) {
		color: #fff !important;
	}
	:global(
		.prop-menu-list:not(:has(.prop-menu-item:hover)):not(
				:has(.prop-menu-item[data-highlighted="true"])
			)
			.prop-menu-item[data-selected="true"]
			.prop-menu-label
	) {
		color: #fff !important;
	}
</style>
