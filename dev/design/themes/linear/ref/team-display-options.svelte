<script lang="ts">
	import GripGrid from "@lucide/svelte/icons/grid-2x2";
	import AlignLeft from "@lucide/svelte/icons/align-left";
	import ArrowUpDown from "@lucide/svelte/icons/arrow-up-down";
	import ArrowUpNarrowWide from "@lucide/svelte/icons/arrow-up-narrow-wide";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { displayMark, menuMark, menuSurface } from "./chrome.ts";
	import {
		popoverEnterDuration,
		popoverEnterEasing,
		popoverOpacity,
		popoverOrigin,
		popoverOut,
		popoverScale,
	} from "./popover-motion.ts";

	/** Rendered inside the toolbar trigger's relative wrapper, aligned to the trigger's right edge.
	 *  `variant` is the active view; `onViewChange` switches it (the live popover keeps the
	 *  surface open and swaps its rows for the new layout). */
	let {
		variant = "list",
		onViewChange,
	}: { variant?: "list" | "board"; onViewChange?: (view: "list" | "board") => void } = $props();

	/** List: Grouping / Sub-grouping. Board: Columns / Rows (measured 2026-09-14). */
	const rows: { label: string; value: string; icon?: "sort" | "order" }[] = $derived(
		variant === "board"
			? [
					{ label: "Columns", value: "Status", icon: "sort" as const },
					{ label: "Rows", value: "No grouping" },
					{ label: "Ordering", value: "Priority", icon: "order" as const },
				]
			: [
					{ label: "Grouping", value: "Status", icon: "sort" as const },
					{ label: "Sub-grouping", value: "No grouping" },
					{ label: "Ordering", value: "Priority", icon: "order" as const },
				],
	);

	/** List options: Nested sub-issues + Show empty groups. Board options: Show empty columns. */
	const variantToggles: { label: string; on: boolean; section: "list" | "board" }[] = $derived(
		variant === "board"
			? [{ label: "Show empty columns", on: false, section: "board" as const }]
			: [
					{ label: "Nested sub-issues", on: true, section: "list" as const },
					{ label: "Show empty groups", on: false, section: "list" as const },
				],
	);

	const toggles: { label: string; on: boolean }[] = [
		{ label: "Order completed by recency", on: false },
		{ label: "Show sub-issues", on: true },
	];

	const chips: { label: string; on: boolean }[] = [
		{ label: "ID", on: true },
		{ label: "Status", on: true },
		{ label: "Assignee", on: true },
		{ label: "Priority", on: true },
		{ label: "Project", on: true },
		{ label: "Due date", on: true },
		{ label: "Milestone", on: false },
		{ label: "Labels", on: true },
		{ label: "Links", on: false },
		{ label: "Time in status", on: false },
		{ label: "Created", on: true },
		{ label: "Updated", on: false },
	];

	const labelStyle =
		"font-size: var(--text-body-sm); font-weight: 500; color: var(--muted-foreground)";
	const valueChipStyle = `display: flex; align-items: center; justify-content: space-between; width: 100px; height: 24px; padding: 1px 18px 1px 8px; border-radius: 8px; background: ${displayMark.valueChip}; font-size: var(--text-body-sm); color: ${displayMark.valueChipText}; white-space: nowrap`;
	const sectionStyle = `padding: 8px 16px; border-top: var(--hairline-width) solid ${menuMark.sep}`;
</script>

<div
	class="absolute z-40 popover-surface"
	data-role="display-options"
	out:popoverOut
	style:--popover-origin={`${popoverOrigin}`}
	style:--popover-rest-opacity={`${popoverOpacity}`}
	style:--popover-from-scale={`${popoverScale}`}
	style:--popover-enter-ms={`${popoverEnterDuration}ms`}
	style:--popover-enter-ease={`${popoverEnterEasing}`}
	style="{menuSurface}; top: 100%; right: 0; margin-top: 4px; width: {displayMark.width}; font-size: var(--text-body-sm); line-height: 1.25"
>
	<div style="padding-top: 8px">
		<div style="padding: 6px 16px 8px">
			<div class="flex" style="height: {displayMark.rowHeight}px; border-radius: 5px; padding: 2px">
				{#each [{ id: "list", label: "List" }, { id: "board", label: "Board" }] as segment (segment.id)}
					{@const on = variant === segment.id}
					<button
						type="button"
						data-role="view-segment"
						data-view={segment.id}
						aria-pressed={on}
						onclick={() => onViewChange?.(segment.id as "list" | "board")}
						class="flex flex-1 items-center justify-center gap-2"
						style="height: 28px; border-radius: var(--radius-pill); background: {on
							? displayMark.segmentOn
							: displayMark.segmentOff}; font-size: var(--text-body-sm); font-weight: 500; color: {on
							? 'var(--foreground)'
							: 'var(--muted-foreground)'}"
					>
						{#if segment.id === "list"}
							<AlignLeft class="size-3.5" strokeWidth={2} />
						{:else}
							<GripGrid class="size-3.5" strokeWidth={2} />
						{/if}
						{segment.label}
					</button>
				{/each}
			</div>

			<div style="height: 16px"></div>

			{#each rows as row (row.label)}
				<div class="flex items-center" style="height: {displayMark.rowHeight}px">
					<span style={labelStyle}>{row.label}</span>
					<div class="ml-auto flex items-center gap-2">
						{#if row.icon === "sort"}
							<ArrowUpDown class="size-3.5 text-muted-foreground" strokeWidth={2} />
						{:else if row.icon === "order"}
							<ArrowUpNarrowWide class="size-3.5" strokeWidth={2} style="color: {displayMark.valueChipText}" />
						{/if}
						<span style={valueChipStyle}>
							{row.value}
							<ChevronDown class="size-3" strokeWidth={2} style="color: var(--muted-foreground)" />
						</span>
					</div>
				</div>
			{/each}

			{#each toggles.slice(0, 1) as item (item.label)}
				<div class="flex items-center" style="height: {displayMark.rowHeight}px">
					<span style={labelStyle}>{item.label}</span>
					{@render toggle(item.on)}
				</div>
			{/each}
		</div>

		<div style={sectionStyle}>
			<div class="flex items-center" style="height: {displayMark.rowHeight}px">
				<span style={labelStyle}>Completed issues</span>
				<div class="ml-auto flex items-center gap-2">
					<span style={valueChipStyle}>
						All
						<ChevronDown class="size-3" strokeWidth={2} style="color: var(--muted-foreground)" />
					</span>
				</div>
			</div>
			{#each toggles.slice(1, 2) as item (item.label)}
				<div class="flex items-center" style="height: {displayMark.rowHeight}px">
					<span style={labelStyle}>{item.label}</span>
					{@render toggle(item.on)}
				</div>
			{/each}
		</div>

		<div style="{sectionStyle}; padding-bottom: 12px">
			<p
				style="display: flex; align-items: center; height: 15px; margin: 8px 0 3px; font-size: var(--text-body-sm); font-weight: 500; color: var(--ink-soft)"
			>
				{variant === "board" ? "Board options" : "List options"}
			</p>
			{#each variantToggles as item (item.label)}
				<div class="flex items-center" style="height: {displayMark.rowHeight}px">
					<span style={labelStyle}>{item.label}</span>
					{@render toggle(item.on)}
				</div>
			{/each}
			<p
				style="display: flex; align-items: center; height: 15px; margin: 8px 0 12px; font-size: var(--text-body-sm); font-weight: 500; color: var(--muted-foreground)"
			>
				Display properties
			</p>
			<div class="flex flex-wrap" style="gap: 5px">
				{#each chips as chip (chip.label)}
					<span
						class="flex items-center"
						style="height: 24px; padding: 0 9px; border-radius: var(--radius-pill); background: {chip.on
							? displayMark.chipOn
							: displayMark.chipOff}; font-size: var(--text-body-sm); font-weight: 500; color: {chip.on
							? 'var(--foreground)'
							: 'var(--muted-foreground)'}"
					>
						{chip.label}
					</span>
				{/each}
			</div>
			{#if variant === "board"}
				<div
					class="flex items-center justify-end"
					style="gap: 4px; padding: 8px 16px; border-top: var(--hairline-width) solid {menuMark.sep}"
				>
					<button
						type="button"
						class="rounded-full"
						style="height: 24px; padding: 0 8px; font-size: var(--text-body-sm); font-weight: 500; color: var(--ink-soft)"
						>Reset</button
					>
					<button
						type="button"
						class="rounded-full"
						style="height: 24px; padding: 0 8px; font-size: var(--text-body-sm); font-weight: 500; color: var(--ink-soft)"
						>Set default for everyone</button
					>
				</div>
			{/if}
		</div>
	</div>
</div>

{#snippet toggle(on: boolean)}
	<span class="ml-auto" style="position: relative; width: 24px; height: 14px">
		<span
			style="position: absolute; inset: 0; border-radius: var(--radius-pill); background: {on
				? displayMark.toggleOn
				: displayMark.toggleOff}"
		></span>
		<span
			style="position: absolute; top: 2px; {on
				? 'right: 2px'
				: 'left: 2px'}; width: 10px; height: 10px; border-radius: var(--radius-pill); background: {displayMark.toggleKnob}"
		></span>
	</span>
{/snippet}

<style>
	/* Measured enter: the surface scales 0.98 → 1 from its top-right corner while opacity → 2
	   (the live spring overshoots 1, so the fade reads fast). Runs on mount and on every re-open;
	   the exit is the measured per-frame curve in popover-motion.ts. */
	.popover-surface {
		transform-origin: var(--popover-origin);
		opacity: var(--popover-rest-opacity);
		animation: pop-enter var(--popover-enter-ms) var(--popover-enter-ease) 0s 1 normal none running;
	}

	@keyframes pop-enter {
		from {
			opacity: 0;
			transform: scale(var(--popover-from-scale));
		}
		to {
			opacity: var(--popover-rest-opacity);
			transform: scale(1);
		}
	}
</style>
