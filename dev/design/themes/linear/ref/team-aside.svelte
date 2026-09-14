<script lang="ts">
	import Plus from "@lucide/svelte/icons/plus";
	import Box from "@lucide/svelte/icons/box";
	import * as Card from "$lib/components/ui/card/index.js";
	import { mark, railMark, sectionBodyStyle, sectionHeadStyle, sectionTriggerStyle } from "./chrome.ts";

	/** Issue detail rail, docked right of the list (live: linear.app/easydevs/issue/EAS-5/test). */
	const properties = [
		{ kind: "status", label: "In Progress", color: mark.progress },
		{ kind: "priority", label: "High", color: mark.todo },
		{ kind: "assignee", label: "Lemon Blue" },
	] as const;

	const labels = [
		{ label: "Bug", color: "var(--status-danger)" },
		{ label: "Feature", color: "var(--status-highlight)" },
	];

	const rowStyle = `display: flex; align-items: center; gap: 8px; height: ${railMark.rowHeight}px; padding: 0 10px 0 6px; border-radius: var(--radius-pill); font-size: var(--text-heading-sm); font-weight: 500; color: var(--ink-soft)`;
</script>

<div
	class="flex min-h-0 shrink-0 flex-col overflow-y-auto"
	data-role="issue-panel"
	style="width: {railMark.width}; padding: 16px 4px 0 4px"
>
	<Card.Root
		style="background: var(--inspector); border: var(--hairline-width) solid var(--inspector-border); border-radius: var(--radius-md); box-shadow: var(--panel-shadow); padding: 12px"
	>
		<Card.Header style={sectionHeadStyle}>
			<div style="display: flex; min-width: 0; flex: 1; align-items: center">
				<span style={sectionTriggerStyle}>Properties</span>
			</div>
			<button type="button" class="rounded-sm text-muted-foreground" aria-label="Add property">
				<Plus class="size-3.5" strokeWidth={1.75} />
			</button>
		</Card.Header>
		<Card.Content style="{sectionBodyStyle}; gap: {railMark.rowGap}px">
			{#each properties as property (property.label)}
				<button type="button" class="flex items-center" style={rowStyle}>
					{#if property.kind === "status"}
						<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
							<circle cx="8" cy="8" r="5.8" stroke={property.color} stroke-width="1.9" />
							<rect x="6.7" y="4.6" width="2.8" height="7" rx="1.4" fill={property.color} />
						</svg>
					{:else if property.kind === "priority"}
						<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
							<rect x="2" y="9" width="2.6" height="5" rx="1.3" fill={property.color} />
							<rect x="6.7" y="6" width="2.6" height="8" rx="1.3" fill={property.color} />
							<rect x="11.4" y="3" width="2.6" height="11" rx="1.3" fill={property.color} />
						</svg>
					{:else}
						<span
							class="grid place-items-center rounded-full"
							style="width: 14px; height: 14px; background: var(--status-highlight); color: var(--background); font-size: 8px; font-weight: 600"
							>LB</span
						>
					{/if}
					{property.label}
				</button>
			{/each}
		</Card.Content>
	</Card.Root>

	<div style="height: {railMark.sectionGap}px"></div>

	<Card.Root
		style="background: var(--inspector); border: var(--hairline-width) solid var(--inspector-border); border-radius: var(--radius-md); box-shadow: var(--panel-shadow); padding: 12px"
	>
		<Card.Header style={sectionHeadStyle}>
			<div style="display: flex; min-width: 0; flex: 1; align-items: center">
				<span style={sectionTriggerStyle}>Labels</span>
			</div>
		</Card.Header>
		<Card.Content style="{sectionBodyStyle}; gap: 0">
			<div class="flex items-center" style="gap: 6px">
				{#each labels as label (label.label)}
					<span
						class="flex items-center"
						style="height: {railMark.chipHeight}px; gap: 6px; padding: 0 8px; border-radius: var(--radius-pill); border: {railMark.chipBorder}; font-size: var(--text-heading-sm); font-weight: 500; color: var(--ink-soft)"
					>
						<span
							class="shrink-0 rounded-full"
							style="width: 9px; height: 9px; background: {label.color}"
						></span>
						{label.label}
					</span>
				{/each}
				<button
					type="button"
					class="grid place-items-center rounded-full text-muted-foreground"
					style="width: 24px; height: {railMark.chipHeight}px"
					aria-label="Add label"
				>
					<Plus class="size-3.5" strokeWidth={1.75} />
				</button>
			</div>
		</Card.Content>
	</Card.Root>

	<div style="height: {railMark.sectionGap}px"></div>

	<Card.Root
		style="background: var(--inspector); border: var(--hairline-width) solid var(--inspector-border); border-radius: var(--radius-md); box-shadow: var(--panel-shadow); padding: 12px"
	>
		<Card.Header style={sectionHeadStyle}>
			<div style="display: flex; min-width: 0; flex: 1; align-items: center">
				<span style={sectionTriggerStyle}>Project</span>
			</div>
		</Card.Header>
		<Card.Content style="{sectionBodyStyle}; gap: {railMark.rowGap}px">
			<button
				type="button"
				class="flex items-center"
				style="{rowStyle}; color: var(--muted-foreground)"
			>
				<Box class="size-4" strokeWidth={1.75} style="color: var(--ink-soft)" />
				Add to project
			</button>
		</Card.Content>
	</Card.Root>
</div>
