<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import type { Component, Snippet } from "svelte";
import * as Popover from "$lib/components/ui/popover/index.js";

export type PropItem = {
	value: string;
	label?: string;
	icon?: Component;
	iconClass?: string;
	kbd?: string;
};

let {
	label,
	labelWidth = "80px",
	value = "",
	items,
	search,
	width = "260px",
	align = "start",
	ariaLabel,
	onPick,
	trigger,
}: {
	label: string;
	labelWidth?: string;
	value?: string;
	items: PropItem[];
	search?: string;
	width?: string;
	align?: "start" | "center" | "end";
	ariaLabel?: string;
	onPick: (value: string) => void;
	trigger?: Snippet<[{ props: Record<string, unknown> }]>;
} = $props();

let open = $state(false);
let query = $state("");
let active = $state(0);
let searchEl = $state<HTMLInputElement | null>(null);

const rowStyle = "display: flex; align-items: center; height: 28px; gap: 12px; min-width: 0";
const labelStyle = `width: ${labelWidth}; flex-shrink: 0; font-size: var(--text-heading-sm); font-weight: 500; color: var(--muted-foreground)`;
const hitStyle = "margin-inline: -6px; padding-inline: 6px; border-radius: var(--radius-sm)";
const valueStyle = `display: flex; min-width: 0; flex: 1; align-items: center; gap: 6px; font-size: var(--text-heading-sm); font-weight: 500; color: var(--ink-soft); ${hitStyle}`;
const itemStyle = "height: 32px; padding: 0 18px 0 14px; margin: 0; border-radius: 0; position: relative";
const surface = $derived(
	`background: rgb(33, 33, 34); color: rgb(229, 230, 232); border: 0.8px solid rgb(50, 51, 54); border-radius: 12px; box-shadow: rgb(0 0 0 / 0.125) 0px 3px 8px 0px, rgb(0 0 0 / 0.125) 0px 2px 5px 0px, rgb(0 0 0 / 0.125) 0px 1px 1px 0px; padding: 0; font-size: 13px; width: ${width}; min-width: ${width}`,
);
const itemClass =
	"prop-menu-item relative flex w-full items-center gap-2 rounded-none bg-transparent text-left text-[13px] font-[450] text-popover-foreground";

function itemOf(current: string) {
	return items.find((item) => item.value === current);
}

function caption(item: PropItem | undefined) {
	if (!item) {
		if (value) return value;
		return "—";
	}
	if (item.label) return item.label;
	return item.value;
}

function iconClassOf(item: PropItem | undefined) {
	if (item?.iconClass) return item.iconClass;
	return "";
}

function matches(item: PropItem, needle: string) {
	if (item.value.toLowerCase().includes(needle)) return true;
	return caption(item).toLowerCase().includes(needle);
}

const visible = $derived.by(() => {
	const needle = query.trim().toLowerCase();
	if (!needle) return items;
	return items.filter((item) => matches(item, needle));
});

$effect(() => {
	const len = visible.length;
	if (len === 0) {
		active = 0;
		return;
	}
	if (active >= len) active = len - 1;
});

function selectedIndex() {
	const at = visible.findIndex((item) => item.value === value);
	if (at < 0) return 0;
	return at;
}

function pick(next: string) {
	open = false;
	query = "";
	onPick(next);
}

function onOpenChange(next: boolean) {
	if (next) {
		active = selectedIndex();
		return;
	}
	query = "";
}

function onOpenAutoFocus(event: Event) {
	if (!search) return;
	event.preventDefault();
	searchEl?.focus();
}

function moveActive(delta: number) {
	if (!visible.length) return;
	const next = active + delta;
	if (next < 0) {
		active = visible.length - 1;
		return;
	}
	if (next >= visible.length) {
		active = 0;
		return;
	}
	active = next;
}

function pickActive() {
	const item = visible[active];
	if (!item) return;
	pick(item.value);
}

function pickByKbd(key: string) {
	const item = items.find((row) => row.kbd === key);
	if (!item) return false;
	pick(item.value);
	return true;
}

function onMenuKey(event: KeyboardEvent) {
	event.stopPropagation();
	if (pickByKbd(event.key)) {
		event.preventDefault();
		return;
	}
	if (event.key === "ArrowDown") {
		event.preventDefault();
		moveActive(1);
		return;
	}
	if (event.key === "ArrowUp") {
		event.preventDefault();
		moveActive(-1);
		return;
	}
	if (event.key === "Enter") {
		event.preventDefault();
		pickActive();
	}
}
</script>

{#snippet picker()}
	<Popover.Root bind:open onOpenChange={onOpenChange}>
		<Popover.Trigger>
			{#snippet child({ props })}
				{#if trigger}
					{@render trigger({ props })}
				{:else}
					{@const current = itemOf(value)}
					<button
						type="button"
						{...props}
						class="min-w-0 flex-1 truncate rounded-sm bg-transparent text-left hover:bg-accent"
						style={valueStyle}
						aria-label={ariaLabel ?? label}
					>
						{#if current?.icon}
							{@const Icon = current.icon}
							<Icon class="size-3.5 shrink-0 {iconClassOf(current)}" strokeWidth={2} />
						{/if}
						{caption(current)}
					</button>
				{/if}
			{/snippet}
		</Popover.Trigger>
		<Popover.Content
			class="gap-0 overflow-hidden p-0 shadow-none ring-0"
			style={surface}
			{align}
			avoidCollisions={true}
			collisionPadding={8}
			portalProps={{ to: "body" }}
			onOpenAutoFocus={onOpenAutoFocus}
			onkeydown={onMenuKey}
		>
			{#if search}
				<div
					class="border-border"
					style="height: 37px; padding: 0 12px 0 14px; border-bottom-width: 0.8px; border-bottom-style: solid"
				>
					<input
						bind:this={searchEl}
						bind:value={query}
						type="search"
						placeholder={search}
						aria-label={search}
						autocomplete="off"
						spellcheck="false"
						class="h-9 w-full min-w-0 appearance-none border-0 bg-transparent p-0 text-[13px] shadow-none outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
						style="padding: 10px 0 9px; caret-color: var(--primary); font-weight: 400"
						onkeydown={onMenuKey}
					/>
				</div>
			{/if}
			<div class="prop-menu-list flex flex-col" style="padding: 6px 0">
				{#if visible.length === 0}
					<p class="m-0 px-3.5 py-2 text-[13px] text-muted-foreground">없음</p>
				{/if}
				{#each visible as item, index (item.value)}
					<button
						type="button"
						class={itemClass}
						style={itemStyle}
						data-selected={value === item.value}
						data-highlighted={index === active}
						onmouseenter={() => (active = index)}
						onclick={() => pick(item.value)}
					>
						{#if item.icon}
							{@const Icon = item.icon}
							<Icon class="size-4 shrink-0 {iconClassOf(item)}" strokeWidth={1.75} />
						{/if}
						<span class="prop-menu-label min-w-0 flex-1 truncate">{caption(item)}</span>
						{#if value === item.value}
							<Check class="size-4 shrink-0 text-muted-foreground" strokeWidth={2} style="margin-right: 1px" />
						{/if}
						{#if item.kbd}
							<kbd
								class="flex size-[18px] shrink-0 items-center justify-center rounded-[4px] text-muted-foreground"
								style="border: 0.8px solid rgb(41, 42, 45); font: 400 12px/13.2px var(--font-sans)"
								>{item.kbd}</kbd
							>
						{/if}
					</button>
				{/each}
			</div>
		</Popover.Content>
	</Popover.Root>
{/snippet}

{#if trigger}
	{@render picker()}
{:else}
	<div style={rowStyle}>
		<span style={labelStyle}>{label}</span>
		{@render picker()}
	</div>
{/if}

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
