<script lang="ts">
import type { Snippet } from "svelte";
import * as Card from "$lib/components/ui/card/index.js";
import {
	cardClass,
	inspectorStyle,
	sectionBodyStyle,
	sectionHeadStyle,
	sectionTriggerStyle,
} from "./inspector-chrome.js";

let {
	title,
	open = true,
	filled = true,
	collapseLabel,
	role,
	onToggle,
	trailing,
	children,
}: {
	title: string;
	open?: boolean;
	filled?: boolean;
	collapseLabel?: string;
	role?: string;
	onToggle: () => void;
	trailing?: Snippet;
	children?: Snippet;
} = $props();
</script>

{#snippet foldCaret(on: boolean)}
	<svg
		aria-hidden="true"
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="currentColor"
		style="display: block; width: 16px; height: 16px; flex-shrink: 0; transform: rotate({on ? 90 : 0}deg)"
	>
		<path
			d="M7.00194 10.6239C6.66861 10.8183 6.25 10.5779 6.25 10.192V5.80802C6.25 5.42212 6.66861 5.18169 7.00194 5.37613L10.7596 7.56811C11.0904 7.76105 11.0904 8.23895 10.7596 8.43189L7.00194 10.6239Z"
		/>
	</svg>
{/snippet}

<Card.Root class={cardClass} style={inspectorStyle} data-role={role}>
	<Card.Header style={sectionHeadStyle}>
		<div style="display: flex; min-width: 0; flex: 1; align-items: center">
			<button
				type="button"
				class="hover:bg-accent"
				style={sectionTriggerStyle}
				aria-expanded={open}
				aria-label={collapseLabel ?? `${title} 접기`}
				onclick={onToggle}
			>
				<span>{title}</span>
				{@render foldCaret(open)}
			</button>
		</div>
		{#if trailing}
			<div style="display: flex; flex-shrink: 0; align-items: center">
				{@render trailing()}
			</div>
		{/if}
	</Card.Header>
	{#if open && filled && children}
		<Card.Content style={sectionBodyStyle}>
			{@render children()}
		</Card.Content>
	{/if}
</Card.Root>
