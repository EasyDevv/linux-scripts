<!-- draft-meta: {"route":"team-all","title":"Issues","style":"linear"} -->
<script lang="ts">
	import Bell from "@lucide/svelte/icons/bell";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import Layers2 from "@lucide/svelte/icons/layers-2";
	import Star from "@lucide/svelte/icons/star";
	import { Button } from "$lib/components/ui/button/index.js";
	import { mark, titleStyle, tabOff, tabOn } from "../chrome.ts";
	import { workspace } from "../data.ts";
	import Shell from "../shell.svelte";
	import TeamAside from "../team-aside.svelte";
	import TeamBoardView from "../team-board-view.svelte";
	import TeamDisplayOptions from "../team-display-options.svelte";
	import TeamFilterPopover from "../team-filter-popover.svelte";
	import TeamListView from "../team-list-view.svelte";

	/** The two views of one route (linear.app/easydevs/team/EAS/all): List and Board. */
	type View = "list" | "board";
	let view = $state<View>("list");
	/* The live toolbar keeps the two popovers mutually exclusive: opening one closes the other. */
	let displayOpen = $state(true);
	let filterOpen = $state(false);

	const FILTER_PATH = `<path fill-rule="evenodd" clip-rule="evenodd" d="M14.25 3a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5h12.5ZM4 8a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 4 8Zm2.75 3.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z"></path>`;
	const DISPLAY_PATH = `<path fill-rule="evenodd" clip-rule="evenodd" d="M7 2.5C8.11933 2.5 9.06613 3.23584 9.38477 4.25H14.75C15.1642 4.25 15.5 4.58579 15.5 5C15.5 5.41421 15.1642 5.75 14.75 5.75H9.38477C9.06613 6.76416 8.11933 7.5 7 7.5C5.88067 7.5 4.93387 6.76416 4.61523 5.75H2.25C1.83579 5.75 1.5 5.41421 1.5 5C1.5 4.58579 1.83579 4.25 2.25 4.25H4.61523C4.93387 3.23584 5.88067 2.5 7 2.5ZM7 4C6.44772 4 6 4.44772 6 5C6 5.55228 6.44772 6 7 6C7.55228 6 8 5.55228 8 5C8 4.44772 7.55228 4 7 4Z"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M10 13.5C8.88067 13.5 7.93387 12.7642 7.61523 11.75H2.25C1.83579 11.75 1.5 11.4142 1.5 11C1.5 10.5858 1.83579 10.25 2.25 10.25H7.61523C7.93387 9.23584 8.88067 8.5 10 8.5C11.1193 8.5 12.0661 9.23584 12.3848 10.25H14.75C15.1642 10.25 15.5 10.5858 15.5 11C15.5 11.4142 15.1642 11.75 14.75 11.75H12.3848C12.0661 12.7642 11.1193 13.5 10 13.5ZM10 12C10.5523 12 11 11.5523 11 11C11 10.4477 10.5523 10 10 10C9.44772 10 9 10.4477 9 11C9 11.5523 9.44772 12 10 12Z"></path>`;
	const PANEL_PATH = `<g><path fill-rule="evenodd" clip-rule="evenodd" d="M4.25 2C2.45508 2 1 3.45508 1 5.25V10.75C1 12.5449 2.45508 14 4.25 14H11.75C13.5449 14 15 12.5449 15 10.75V5.25C15 3.45508 13.5449 2 11.75 2H4.25ZM2.5 5.5C2.5 4.39543 3.39543 3.5 4.5 3.5H11.5C12.6046 3.5 13.5 4.39543 13.5 5.5V10.5C13.5 11.6046 12.6046 12.5 11.5 12.5H4.5C3.39543 12.5 2.5 11.6046 2.5 10.5V5.5Z"></path><rect x="10" y="5" width="1.5" height="6" rx="0.75"></rect></g>`;

	/* measured: idle discs rgb(30,30,31); the Display options disc is active (rgb(37,37,38))
	   and carries a 7px --primary dot in the live captures. */
	const discStyle = `width: var(--control-height-nav); height: var(--control-height-nav); border-radius: var(--radius-pill); background: rgb(30, 30, 31); color: rgb(149, 149, 151)`;
	const displayDiscStyle = `width: var(--control-height-nav); height: var(--control-height-nav); border-radius: var(--radius-pill); background: rgb(37, 37, 38); color: rgb(149, 149, 151)`;
</script>

<Shell page="team-all" title="">
	{#snippet header()}
		<div class="flex min-w-0 items-center gap-1.5">
			<span
				class="flex size-4 shrink-0 items-center justify-center rounded-[3px] text-[9px] font-medium text-background"
				style="background: {mark.team}">E</span
			>
			<span class="text-muted-foreground" style={titleStyle}>{workspace.team}</span>
			<ChevronRight class="size-3 text-muted-foreground" strokeWidth={2} />
			<span class="font-medium text-[color:var(--ink-soft)]" style={titleStyle}>Issues</span>
			<Button variant="ghost" size="icon-sm" class="rounded-full text-muted-foreground" aria-label="Favorite">
				<Star class="size-3.5" strokeWidth={1.75} />
			</Button>
		</div>
		<Button variant="ghost" size="icon-sm" class="ml-auto rounded-full text-muted-foreground" aria-label="Inbox">
			<Bell class="size-3.5" strokeWidth={1.75} />
		</Button>
	{/snippet}

	{#snippet tools()}
		<Button variant="ghost" size="sm" class="h-7 rounded-full px-2.5 font-medium" style={tabOff}>Active</Button>
		<Button variant="ghost" size="sm" class="h-7 rounded-full px-2.5 font-medium" style={tabOff}>Backlog</Button>
		<Button variant="ghost" size="sm" class="h-7 rounded-full px-2.5 font-medium" style={tabOn}>All issues</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			class="rounded-full"
			style="color: color-mix(in srgb, var(--muted-foreground) 60%, transparent)"
			aria-label="Filter by status"
		>
			<Layers2 class="size-3.5" strokeWidth={1.75} />
		</Button>
		<div class="ml-auto flex items-center" style="gap: 6px; margin-right: 2px">
			<div class="relative">
				<Button
					variant="ghost"
					size="icon-sm"
					class="rounded-full"
					style={filterOpen ? displayDiscStyle : discStyle}
					aria-label="Add filter"
					aria-expanded={filterOpen}
					onclick={() => {
						filterOpen = !filterOpen;
						displayOpen = false;
					}}
				>
					<!-- Live toolbar glyphs (Linear's own 16x16 SVGs), fill: currentColor -->
					<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
						{@html FILTER_PATH}
					</svg>
				</Button>
				{#if filterOpen}
					<TeamFilterPopover />
				{/if}
			</div>
			<div class="relative">
				<Button
					variant="ghost"
					size="icon-sm"
					class="rounded-full"
					style={displayDiscStyle}
					aria-label="Display options"
					aria-expanded={displayOpen}
					onclick={() => {
						displayOpen = !displayOpen;
						filterOpen = false;
					}}
				>
					<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
						{@html DISPLAY_PATH}
					</svg>
				</Button>
				<span
					class="pointer-events-none absolute"
					style="top: 2px; right: 1px; width: 7px; height: 7px; border-radius: var(--radius-pill); background: var(--primary); box-shadow: 0 0 0 1.5px var(--card)"
					aria-hidden="true"
				></span>
				{#if displayOpen}
					<TeamDisplayOptions variant={view} onViewChange={(next) => (view = next)} />
				{/if}
			</div>
			<Button variant="ghost" size="icon-sm" class="rounded-full" style={discStyle} aria-label="Open details">
				<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
					{@html PANEL_PATH}
				</svg>
			</Button>
		</div>
	{/snippet}

	{#snippet aside()}
		<!-- The live list capture has the issue panel docked; the board capture does not. -->
		{#if view === "list"}
			<TeamAside />
		{/if}
	{/snippet}

	{#if view === "list"}
		<TeamListView />
	{:else}
		<TeamBoardView />
	{/if}
</Shell>
