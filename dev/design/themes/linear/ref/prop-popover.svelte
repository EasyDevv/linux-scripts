<script lang="ts">
	import type { Component, Snippet } from "svelte";
	import * as Popover from "$lib/components/ui/popover/index.js";
	import { menuMark, menuSurface, propEmptyStyle, propFilledStyle, propLabelStyle, propRowStyle } from "./chrome.ts";

	let {
		label,
		empty = true,
		emptyText,
		ariaLabel,
		idleIcon: Icon,
		children,
	}: {
		label: string;
		empty?: boolean;
		emptyText?: string;
		ariaLabel?: string;
		idleIcon?: Component;
		children: Snippet;
	} = $props();

	const pop = `${menuSurface}; width: ${menuMark.widthStatus}; padding: 8px`;

	function triggerStyle() {
		if (empty) return propEmptyStyle;
		return propFilledStyle;
	}

	function caption() {
		if (emptyText) return emptyText;
		return label;
	}
</script>

<div style={propRowStyle}>
	<span style={propLabelStyle}>{label}</span>
	<Popover.Root>
		<Popover.Trigger>
			{#snippet child({ props })}
				<button
					type="button"
					{...props}
					style={triggerStyle()}
					aria-label={ariaLabel ?? label}
				>
					{#if Icon}
						<Icon style="width: 16px; height: 16px" strokeWidth={1.75} />
					{/if}
					{caption()}
				</button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content style={pop} class="grid gap-1 p-2">
			{@render children()}
		</Popover.Content>
	</Popover.Root>
</div>
