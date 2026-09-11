<!-- draft-meta: {"route":"team-all","title":"Issues","style":"linear"} -->
<script lang="ts">
	import Bell from "@lucide/svelte/icons/bell";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import CircleCheck from "@lucide/svelte/icons/circle-check";
	import CircleX from "@lucide/svelte/icons/circle-x";
	import Columns3 from "@lucide/svelte/icons/columns-3";
	import Diamond from "@lucide/svelte/icons/diamond";
	import ListFilter from "@lucide/svelte/icons/list-filter";
	import Plus from "@lucide/svelte/icons/plus";
	import Star from "@lucide/svelte/icons/star";
	import UserRound from "@lucide/svelte/icons/user-round";
	import { Button } from "$lib/components/ui/button/index.js";
	import { mark, metaStyle, tabOff, tabOn, titleStyle } from "../chrome.ts";
	import { issueGroups, workspace } from "../data.ts";
	import Shell from "../shell.svelte";

	function statusIcon(tone: (typeof issueGroups)[number]["tone"]) {
		if (tone === "info") return "progress";
		if (tone === "highlight") return "done";
		if (tone === "danger") return "canceled";
		return "todo";
	}
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
		<Button variant="ghost" size="icon-sm" class="rounded-full text-muted-foreground" aria-label="Display">
			<Diamond class="size-3.5" strokeWidth={1.75} />
		</Button>
		<div class="ml-auto flex items-center gap-1">
			<Button variant="ghost" size="icon-sm" class="rounded-full text-muted-foreground" aria-label="Filter">
				<ListFilter class="size-3.5" strokeWidth={1.75} />
			</Button>
			<Button variant="ghost" size="icon-sm" class="rounded-full text-muted-foreground" aria-label="Columns">
				<Columns3 class="size-3.5" strokeWidth={1.75} />
			</Button>
			<Button variant="ghost" size="icon-sm" class="rounded-full text-muted-foreground" aria-label="Cycle">
				<span
					class="size-3.5 rounded-full"
					style="border: 1.5px solid color-mix(in srgb, var(--muted-foreground) 55%, transparent)"
				></span>
			</Button>
		</div>
	{/snippet}

	<div class="flex flex-col px-2 pt-1" style="gap: var(--list-group-gap)">
		{#each issueGroups as group (group.id)}
			<div>
				<div
					class="mx-2 flex items-center gap-2 rounded-sm bg-sidebar-accent px-2"
					style="height: var(--control-height-nav)"
				>
					<ChevronDown class="size-3 text-muted-foreground" strokeWidth={2} />
					{#if statusIcon(group.tone) === "progress"}
						<CircleAlert class="size-3.5 shrink-0" strokeWidth={2} style="color: {mark.progress}" />
					{:else if statusIcon(group.tone) === "done"}
						<CircleCheck class="size-3.5 shrink-0" strokeWidth={2} style="color: {mark.done}" />
					{:else if statusIcon(group.tone) === "canceled"}
						<CircleX class="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
					{:else}
						<span
							class="size-3.5 rounded-full"
							style="border: 1.5px solid color-mix(in srgb, var(--muted-foreground) 70%, transparent)"
						></span>
					{/if}
					<span class="font-medium text-[color:var(--ink-soft)]" style={titleStyle}>{group.label}</span>
					<span class="text-muted-foreground" style={metaStyle}>{group.count}</span>
					<Button variant="ghost" size="icon-sm" class="ml-auto rounded-sm text-muted-foreground" aria-label="Add">
						<Plus class="size-3.5" strokeWidth={1.75} />
					</Button>
				</div>
				<div>
					{#each group.issues as issue (issue.id)}
						<div
							class="flex items-center gap-2 rounded-sm px-2 {group.checkable
								? 'bg-accent'
								: 'hover:bg-accent'}"
							style="margin-inline: var(--list-row-hover-inset); height: 36px"
						>
							{#if group.checkable}
								<span
									class="size-3.5 rounded-[2px]"
									style="border: 1px solid color-mix(in srgb, var(--muted-foreground) 50%, transparent)"
								></span>
							{/if}
							<span class="w-5 shrink-0 text-center text-muted-foreground" style={metaStyle}>---</span>
							<span class="w-12 shrink-0 text-muted-foreground" style={metaStyle}>{issue.id}</span>
							{#if statusIcon(group.tone) === "progress"}
								<CircleAlert class="size-3.5 shrink-0" strokeWidth={2} style="color: {mark.progress}" />
							{:else if statusIcon(group.tone) === "done"}
								<CircleCheck class="size-3.5 shrink-0" strokeWidth={2} style="color: {mark.done}" />
							{:else if statusIcon(group.tone) === "canceled"}
								<CircleX class="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
							{:else}
								<span
									class="size-3.5 rounded-full"
									style="border: 1.5px solid color-mix(in srgb, var(--muted-foreground) 70%, transparent)"
								></span>
							{/if}
							<span class="min-w-0 flex-1 truncate font-medium" style={titleStyle}>{issue.title}</span>
							<UserRound class="size-4 text-muted-foreground" strokeWidth={1.75} />
							<span class="w-12 shrink-0 text-right text-muted-foreground" style={metaStyle}>{issue.date}</span>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</Shell>
