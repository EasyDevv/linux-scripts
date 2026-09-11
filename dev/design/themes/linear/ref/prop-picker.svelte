<script lang="ts">
	import type { Component } from "svelte";
	import { menuMark, propEmptyStyle, propFilledStyle, propLabelStyle, propRowStyle } from "./chrome.ts";
	import { iconOf } from "./menu-icons.ts";
	import type { RefMenuItem } from "./menus.ts";
	import RefMenu from "./ref-menu.svelte";

	let {
		label,
		value,
		items,
		search,
		searchKbd,
		empty = false,
		emptyText,
		ariaLabel,
		idleIcon,
		width = menuMark.widthStatus,
		onPick,
	}: {
		label: string;
		value: string;
		items: RefMenuItem[];
		search?: string;
		searchKbd?: string;
		empty?: boolean;
		emptyText?: string;
		ariaLabel?: string;
		idleIcon?: Component;
		width?: string;
		onPick?: (label: string) => void;
	} = $props();

	function triggerGlyph(current: string) {
		const selected = items.find((item) => item.label === current);
		const Icon = iconOf(selected?.icon) ?? idleIcon;
		if (!Icon) return null;
		return { Icon, color: selected?.color };
	}

	function triggerStyle() {
		if (empty) return propEmptyStyle;
		return propFilledStyle;
	}

	function glyphStyle(color: string | undefined) {
		if (!color) return "width: 16px; height: 16px";
		return `width: 16px; height: 16px; color: ${color}`;
	}
</script>

<div style={propRowStyle}>
	<span style={propLabelStyle}>{label}</span>
	<RefMenu {items} {width} {search} {searchKbd} selected={value} {onPick}>
		{#snippet trigger({ props })}
			{@const glyph = triggerGlyph(value)}
			<button
				type="button"
				{...props}
				style={triggerStyle()}
				aria-label={ariaLabel ?? label}
			>
				{#if glyph}
					{@const Icon = glyph.Icon}
					<Icon style={glyphStyle(glyph.color)} strokeWidth={1.75} />
				{/if}
				{emptyText ?? value}
			</button>
		{/snippet}
	</RefMenu>
</div>
