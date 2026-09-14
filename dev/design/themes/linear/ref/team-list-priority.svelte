<script lang="ts">
	import { priorityMark } from "./chrome.ts";
	import { iconOf } from "./menu-icons.ts";
	import { priorityItems, type RefMenuItem } from "./menus.ts";
	import RefMenu from "./ref-menu.svelte";

	/**
	 * Priority cell of a list row (theme-ref `team-all/page.svelte`, List layout).
	 *
	 * Live measurement (CDP 9201, 2026-09-14): the 16px row-grid column is a 16x36 trigger with no
	 * disc; it opens the Change priority menu 4px under the row, left-aligned to the cell. The glyph
	 * paints the row ink rgb(149,149,151) and brightens to #fff while the row is hovered.
	 */
	let { value = "No priority", onPick }: { value?: string; onPick?: (label: string) => void } = $props();

	/* Live paints every option icon in the menu ink — the Urgent fill attribute is overridden by the
	   row ink — so the swatch colours `priorityItems` carries for property chips do not apply here. */
	const items: RefMenuItem[] = priorityItems.map(({ color, ...item }) => item);
	const current = $derived(priorityItems.find((item) => item.label === value) ?? priorityItems[0]);
	const Icon = $derived(iconOf(current.icon));
</script>

<RefMenu
	{items}
	width={priorityMark.menu.width}
	search={priorityMark.menu.search}
	searchKbd={priorityMark.menu.searchKbd}
	iconInk={priorityMark.menu.iconInk}
	selected={value}
	onPick={(label) => onPick?.(label)}
>
	{#snippet trigger({ props })}
		<button
			type="button"
			{...props}
			class="priority-cell grid shrink-0 place-items-center rounded-full"
			style="--cell-ink: {priorityMark.cell.ink}; --cell-hover-ink: {priorityMark.cell
				.hoverInk}; width: {priorityMark.cell.width}px; height: {priorityMark.cell.height}px"
			aria-label="Priority: {value}"
		>
			{#if Icon}
				<Icon class="size-4" strokeWidth={1.75} />
			{/if}
		</button>
	{/snippet}
</RefMenu>

<style>
	.priority-cell {
		color: var(--cell-ink);
	}

	/* Row hover repaints the row's muted glyphs; the row band rule lives in team-list-view.svelte. */
	:global(.list-row:hover) .priority-cell {
		color: var(--cell-hover-ink);
	}
</style>
