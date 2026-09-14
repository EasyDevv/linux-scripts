<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Plus from "@lucide/svelte/icons/plus";
	import UserRound from "@lucide/svelte/icons/user-round";
	import { listMark, mark, metaStyle, titleStyle } from "./chrome.ts";
	import { issueGroups } from "./data.ts";
	import TeamListPriority from "./team-list-priority.svelte";

	const identifierStyle = `${metaStyle}; font-size: var(--text-body-base); color: var(--muted-foreground)`;

	/** Priority is a record field (the 2026-09-10 capture has every list issue at No priority); picking
	 *  in a row menu owns that row's new value, like the live list writing it back to the issue. */
	let priorities = $state<Record<string, string>>({});
</script>

	<div class="flex flex-col" style="gap: {listMark.rowGap}px">
		{#each issueGroups as group (group.id)}
			<section>
				<div class="group-band flex items-center" style="height: {listMark.groupHeight}px; padding-right: 8px">
					<button
						type="button"
						class="grid shrink-0 place-items-center"
						style="width: 25px; height: 25px; margin-left: 4px; border-radius: var(--radius-pill); color: {listMark.chevronInk}"
						aria-label="Collapse {group.label}"
					>
						<ChevronDown class="size-3" strokeWidth={2} />
					</button>
					<span class="shrink-0" style="display: block; width: 16px; height: 16px; margin-left: 8px">
						{@render statusGlyph(group.tone)}
					</span>
					<span
						class="font-medium"
						style="margin-left: 8px; {titleStyle}; color: var(--ink-soft)">{group.label}</span
					>
					<span style="margin-left: 8px; {metaStyle}; color: var(--muted-foreground)">{group.count}</span>
					<button
						type="button"
						class="ml-auto grid place-items-center rounded-full text-muted-foreground"
						style="width: 24px; height: 24px"
						aria-label="Add issue to {group.label}"
					>
						<Plus class="size-3.5" strokeWidth={1.75} />
					</button>
				</div>
				<!-- Measured: 2px between the group bar and its first row; rows stay contiguous. -->
				<div style="margin-top: {listMark.rowGap}px">
					{#each group.issues as issue (issue.id)}
						<div
							class="list-row grid items-center"
							data-active={group.checkable ? "true" : undefined}
							style="height: {listMark.rowHeight}px; grid-template-columns: {listMark.rowGrid}; column-gap: {listMark.rowGapPx}px"
						>
						<span style="grid-column: 1"></span>
						{#if group.checkable}
							<span
								style="grid-column: 2; justify-self: center; width: 14px; height: 14px; border-radius: 4px; border: 1px solid color-mix(in srgb, var(--muted-foreground) 50%, transparent)"
							></span>
						{/if}
						<span class="grid place-items-center" style="grid-column: 3">
							<TeamListPriority
								value={priorities[issue.id] ?? issue.priority}
								onPick={(label) => (priorities[issue.id] = label)}
							/>
						</span>
						<span style="grid-column: 4; {identifierStyle}">{issue.id}</span>
						<span style="display: block; grid-column: 5; width: 16px; height: 16px">
							{@render statusGlyph(group.tone)}
						</span>
						<span class="truncate font-medium" style="grid-column: 6; {titleStyle}">{issue.title}</span>
						<span
							class="grid place-items-center"
							style="grid-column: 7; width: 16px; height: 16px"
						>
							<UserRound class="size-4 text-muted-foreground" strokeWidth={1.75} />
						</span>
						<span
							class="truncate text-right"
							style="grid-column: 8; {metaStyle}; color: var(--muted-foreground)">{issue.date}</span
						>
						<span style="grid-column: 9"></span>
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</div>

{#snippet statusGlyph(tone: (typeof issueGroups)[number]["tone"])}
	{#if tone === "info"}
		<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
			<circle cx="8" cy="8" r="5.5" stroke={mark.progress} stroke-width="1.8" />
			<rect x="6.8" y="4.9" width="2.6" height="6.4" rx="1.3" fill={mark.progress} />
		</svg>
	{:else if tone === "highlight"}
		<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
			<circle cx="8" cy="8" r="6.6" fill={mark.done} />
			<path
				d="M5 8.4 6.9 10.3 11.1 6"
				stroke="var(--card)"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	{:else if tone === "danger"}
		<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
			<circle cx="8" cy="8" r="6.6" fill={mark.canceled} />
			<path
				d="M5.9 5.9 10.1 10.1 M10.1 5.9 5.9 10.1"
				stroke="var(--card)"
				stroke-width="2"
				stroke-linecap="round"
			/>
		</svg>
	{:else}
		<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
			<circle cx="8" cy="8" r="5.6" stroke={mark.todo} stroke-width="1.6" />
		</svg>
	{/if}
{/snippet}

<style>
	/* Measured list fills (chrome.ts listMark): hover band is inset 8px inside the row box. */
	.group-band {
		margin-inline: var(--list-row-hover-inset);
		border-radius: var(--radius-sm);
		background-color: var(--list-group-fill);
	}

	.list-row {
		position: relative;
	}

	.list-row::before {
		content: "";
		position: absolute;
		inset-block: 0;
		inset-inline: var(--list-row-hover-inset);
		border-radius: var(--radius-sm);
		background-color: transparent;
		pointer-events: none;
	}

	.list-row:hover::before,
	.list-row[data-active="true"]::before {
		background-color: var(--list-row-fill);
	}

	.list-row > * {
		position: relative;
		z-index: 1;
	}
</style>
