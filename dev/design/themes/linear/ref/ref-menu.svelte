<script lang="ts">
	import type { Snippet } from "svelte";
	import Check from "@lucide/svelte/icons/check";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import { menuItemStyle, menuMark, menuSurface } from "./chrome.ts";
	import { iconOf } from "./menu-icons.ts";
	import type { RefMenuItem } from "./menus.ts";

	let {
		items,
		align = "start",
		width = menuMark.width,
		search,
		searchKbd,
		selected,
		onPick,
		iconInk = "label",
		trigger,
	}: {
		items: RefMenuItem[];
		align?: "start" | "end";
		width?: string;
		search?: string;
		searchKbd?: string;
		selected?: string;
		onPick?: (label: string) => void;
		/** `label` = icons inherit the item ink (menuMark.text); `muted` = the measured live option ink
		 *  rgb(156,157,159), following the row to #fff when it is hovered, highlighted or selected. */
		iconInk?: "label" | "muted";
		trigger: Snippet<[{ props: Record<string, unknown> }]>;
	} = $props();

	let query = $state("");
	let searchEl = $state<HTMLInputElement | null>(null);

	const contentClass =
		"min-w-0 overflow-hidden p-0 shadow-none ring-0 data-open:zoom-in-100 data-closed:zoom-out-100";
	const itemClass =
		"ref-menu-item group mx-0 rounded-none py-0 text-[13px] font-[450] focus:bg-transparent focus:text-inherit data-highlighted:bg-transparent";
	const labelClass = "ref-menu-label min-w-0 flex-1 whitespace-nowrap";

	function keysOf(kbd: string) {
		if (kbd.includes("then")) return [kbd];
		return kbd.split(/\s+/).filter(Boolean);
	}

	function chordParts(kbd: string) {
		return kbd.split(/\s+/).filter(Boolean);
	}

	function isThen(part: string) {
		return part === "then";
	}

	function isSelected(label: string) {
		return selected === label;
	}

	function matches(item: RefMenuItem, needle: string) {
		if (item.label.toLowerCase().includes(needle)) return true;
		return Boolean(item.items?.some((sub) => sub.label.toLowerCase().includes(needle)));
	}

	const visible = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return items;
		return items.filter((item) => matches(item, needle));
	});

	const surface = $derived(`${menuSurface}; width: ${width}; min-width: ${width}`);

	function onOpenChange(open: boolean) {
		if (open) return;
		query = "";
	}

	function onOpenAutoFocus(event: Event) {
		if (!search) return;
		event.preventDefault();
		searchEl?.focus();
	}

	function stopMenuKeys(event: KeyboardEvent) {
		event.stopPropagation();
	}
</script>

{#snippet kbdRow(kbd: string)}
	<span
		class="flex items-center"
		style="gap: 3px; color: {menuMark.kbd}; font-size: 12px; font-weight: 500; letter-spacing: 0"
	>
		{#each keysOf(kbd) as key (key)}
			<kbd style="font: 500 12px/13.2px Inter Variable, sans-serif; color: {menuMark.kbd}">{key}</kbd>
		{/each}
	</span>
{/snippet}

{#snippet searchChord(kbd: string)}
	<span class="flex items-center" style="gap: 3px">
		{#each chordParts(kbd) as part (part)}
			{#if isThen(part)}
				<span style="font: 450 10px/23px Inter Variable, sans-serif; color: {menuMark.kbd}">then</span>
			{:else}
				<kbd
					style="display: block; width: 18px; height: 18.8px; padding: 2px; border: 0.8px solid {menuMark.sep}; border-radius: 4px; font: 400 12px/13.2px Inter Variable, sans-serif; color: {menuMark.kbd}; text-align: center"
					>{part}</kbd
				>
			{/if}
		{/each}
	</span>
{/snippet}

{#snippet row(item: RefMenuItem)}
	{#if item.heading}
		<div
			class="px-3.5 pt-1 font-medium text-[rgb(156,157,159)]"
			style="height: 28px; font-size: 12px; line-height: 28px"
		>
			{item.label}
		</div>
	{:else if item.items?.length}
		<DropdownMenu.Sub>
			<DropdownMenu.SubTrigger class={itemClass} style={menuItemStyle}>
				{#if item.icon}
					{@const Icon = iconOf(item.icon)}
					{#if Icon}
						<Icon class="size-4" strokeWidth={1.75} style={item.color ? `color: ${item.color}` : ""} />
					{/if}
				{/if}
				<span class={labelClass}>{item.label}</span>
				{#if item.kbd}
					{@render kbdRow(item.kbd)}
				{/if}
			</DropdownMenu.SubTrigger>
			<DropdownMenu.SubContent class={contentClass} style={surface} sideOffset={4} data-icon-ink={iconInk}>
				<div class="ref-menu-list" style="padding: 6px 0">
					{#each item.items as sub (sub.label)}
						<DropdownMenu.Item
							class={itemClass}
							style={menuItemStyle}
							data-selected={isSelected(sub.label)}
							onSelect={() => onPick?.(sub.label)}
						>
							{#if sub.icon}
								{@const Icon = iconOf(sub.icon)}
								{#if Icon}
									<Icon class="size-4" strokeWidth={1.75} />
								{/if}
							{/if}
							<span class={labelClass}>{sub.label}</span>
						</DropdownMenu.Item>
					{/each}
				</div>
			</DropdownMenu.SubContent>
		</DropdownMenu.Sub>
	{:else}
		<DropdownMenu.Item
			class={itemClass}
			style={menuItemStyle}
			data-selected={isSelected(item.label)}
			onSelect={() => onPick?.(item.label)}
		>
			{#if item.bullet}
				<span class="flex size-4 items-center justify-center">
					<span class="size-1 rounded-full" style="background: {menuMark.text}"></span>
				</span>
			{:else if item.icon}
				{@const Icon = iconOf(item.icon)}
				{#if Icon}
					<Icon class="size-4" strokeWidth={1.75} style={item.color ? `color: ${item.color}` : ""} />
				{/if}
			{/if}
			<span class={labelClass}>{item.label}</span>
			{#if selected === item.label}
				<Check
					class="size-4 shrink-0"
					strokeWidth={2}
					style="{iconInk === "muted" ? "" : `color: ${menuMark.kbd};`} margin-right: 1px"
				/>
			{/if}
			{#if item.kbd}
				{@render kbdRow(item.kbd)}
			{/if}
		</DropdownMenu.Item>
	{/if}
	{#if item.separatorAfter}
		<div
			style="height: 12px; background: linear-gradient({menuMark.sep}, {menuMark.sep}) center / 100% 0.8px no-repeat"
		></div>
	{/if}
{/snippet}

<DropdownMenu.Root onOpenChange={onOpenChange}>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			{@render trigger({ props })}
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content {align} sideOffset={4} class={contentClass} style={surface} data-icon-ink={iconInk} onOpenAutoFocus={onOpenAutoFocus}>
		{#if search}
			<div
				style="height: 37px; padding: 0 12px 0 14px; border-bottom: 0.8px solid {menuMark.sep}"
			>
				<div class="grid h-9 items-center" style="grid-template-columns: minmax(0,1fr) auto; gap: 14px">
					<input
						bind:this={searchEl}
						bind:value={query}
						type="search"
						placeholder={search}
						aria-label={search}
						autocomplete="off"
						spellcheck="false"
						class="min-w-0 appearance-none border-0 bg-transparent p-0 text-[13px] shadow-none outline-none placeholder:text-[rgb(156,157,159)] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
						style="height: 36px; padding: 10px 0 9px; color: {menuMark.text}; caret-color: {menuMark.caret}; font-weight: 400"
						onkeydown={stopMenuKeys}
					/>
					{#if searchKbd}
						{@render searchChord(searchKbd)}
					{/if}
				</div>
			</div>
		{/if}
		<div class="ref-menu-list" style="padding: 6px 0">
			{#each visible as item (item.label)}
				{@render row(item)}
			{/each}
		</div>
	</DropdownMenu.Content>
</DropdownMenu.Root>

<style>
	:global(.ref-menu-item.ref-menu-item) {
		position: relative;
		background-color: transparent !important;
	}
	:global(.ref-menu-item.ref-menu-item::before) {
		content: "";
		pointer-events: none;
		position: absolute;
		inset: 0 6px;
		border-radius: 8px;
		z-index: 0;
	}
	:global(.ref-menu-item.ref-menu-item:hover::before),
	:global(.ref-menu-item.ref-menu-item[data-highlighted]::before),
	:global(.ref-menu-item.ref-menu-item:focus::before) {
		background: rgb(49, 50, 52);
	}
	:global(
		.ref-menu-list:not(:has(.ref-menu-item:hover)):not(:has(.ref-menu-item[data-highlighted]))
			.ref-menu-item[data-selected="true"]::before
	) {
		background: rgb(49, 50, 52);
	}
	:global(.ref-menu-item.ref-menu-item > *) {
		position: relative;
		z-index: 1;
	}
	/* Measured live option ink: the icon paints rgb(156,157,159) at rest and follows the row to #fff
	   with its label (the same compound as the label rules above, so both stay in sync). */
	:global([data-icon-ink="muted"] .ref-menu-item svg) {
		color: rgb(156, 157, 159);
	}
	:global([data-icon-ink="muted"] .ref-menu-item:hover svg),
	:global([data-icon-ink="muted"] .ref-menu-item[data-highlighted] svg),
	:global([data-icon-ink="muted"] .ref-menu-item:focus svg),
	:global(
		[data-icon-ink="muted"]
			.ref-menu-list:not(:has(.ref-menu-item:hover)):not(:has(.ref-menu-item[data-highlighted]))
			.ref-menu-item[data-selected="true"]
			svg
	) {
		color: #fff;
	}
	:global(.ref-menu-item.ref-menu-item:hover .ref-menu-label),
	:global(.ref-menu-item.ref-menu-item[data-highlighted] .ref-menu-label),
	:global(.ref-menu-item.ref-menu-item:focus .ref-menu-label) {
		color: #fff !important;
	}
	:global(
		.ref-menu-list:not(:has(.ref-menu-item:hover)):not(:has(.ref-menu-item[data-highlighted]))
			.ref-menu-item[data-selected="true"]
			.ref-menu-label
	) {
		color: #fff !important;
	}
</style>
