<!-- draft-meta: {"route":"projects-all","title":"Projects","style":"linear"} -->
<script lang="ts">
	import Box from "@lucide/svelte/icons/box";
	import CircleCheck from "@lucide/svelte/icons/circle-check";
	import CircleDashed from "@lucide/svelte/icons/circle-dashed";
	import Columns3 from "@lucide/svelte/icons/columns-3";
	import Diamond from "@lucide/svelte/icons/diamond";
	import ListFilter from "@lucide/svelte/icons/list-filter";
	import Plus from "@lucide/svelte/icons/plus";
	import { Button } from "$lib/components/ui/button/index.js";
	import { mark, metaStyle, tabOn, titleStyle } from "../chrome.ts";
	import { projects } from "../data.ts";
	import Shell from "../shell.svelte";

	const cols =
		"grid-template-columns: minmax(22rem,1fr) 9rem 4.5rem 3.5rem 6rem 3.25rem 4.25rem";
</script>

<Shell page="projects-all" title="Projects">
	{#snippet header()}
		<Button
			variant="ghost"
			size="sm"
			class="ml-auto h-7 gap-1 rounded-full px-2 font-medium text-[color:var(--ink-subtle)]"
			style="font-size: var(--text-label-sm)"
		>
			<Plus class="size-3.5" strokeWidth={1.75} />
			New project
		</Button>
	{/snippet}
	{#snippet tools()}
		<Button variant="ghost" size="sm" class="h-7 rounded-full px-2.5 font-medium" style={tabOn}>
			All projects
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			class="rounded-full text-muted-foreground"
			aria-label="Milestones"
		>
			<Diamond class="size-3.5" strokeWidth={1.75} />
		</Button>
		<div class="ml-auto flex items-center gap-1">
			<Button
				variant="ghost"
				size="icon-sm"
				class="rounded-full text-muted-foreground"
				aria-label="Filter"
			>
				<ListFilter class="size-3.5" strokeWidth={1.75} />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				class="rounded-full text-muted-foreground"
				aria-label="Display"
			>
				<Columns3 class="size-3.5" strokeWidth={1.75} />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				class="rounded-full text-muted-foreground"
				aria-label="Cycle"
			>
				<span
					class="size-3.5 rounded-full"
					style="border: 1.5px solid color-mix(in srgb, var(--muted-foreground) 55%, transparent)"
				></span>
			</Button>
		</div>
	{/snippet}

	<div class="px-4 pt-1">
		<div
			class="grid items-center gap-2 px-2 text-muted-foreground"
			style="height: var(--control-height-nav); {cols}; {metaStyle}"
		>
			<span>Name</span>
			<span>Health</span>
			<span>Priority</span>
			<span>Lead</span>
			<span>Target date</span>
			<span class="text-right">Issues</span>
			<span class="text-right">Status</span>
		</div>
		{#each projects as project (project.id)}
			<button
				type="button"
				class="grid w-full items-center gap-2 rounded-sm px-2 text-left hover:bg-accent"
				style="height: 56px; {cols}"
				onclick={() =>
					window.parent?.postMessage(
						{ type: "draft-navigate", file: "project-overview/page.svelte", project: "theme-linear" },
						"*",
					)}
			>
				<div class="flex min-w-0 items-center gap-2">
					<Box class="size-4 text-muted-foreground" strokeWidth={1.75} />
					<span class="truncate font-medium" style={titleStyle}>{project.name}</span>
					<Diamond class="size-3.5 shrink-0" strokeWidth={1.75} style="color: {mark.progress}" />
					<span class="truncate text-muted-foreground" style={metaStyle}>{project.milestone}</span>
				</div>
				<div class="flex items-center gap-1.5" style="{metaStyle}; color: {mark.ok}">
					<CircleCheck class="size-3.5 shrink-0" strokeWidth={2.25} />
					<span class="font-medium">{project.health}</span>
					<span class="text-muted-foreground">· {project.healthHint}</span>
				</div>
				<span class="text-muted-foreground" style={metaStyle}>{project.priority}</span>
				<span></span>
				<span></span>
				<span class="text-right text-muted-foreground" style={metaStyle}>{project.issues}</span>
				<span class="flex items-center justify-end gap-1.5 text-muted-foreground" style={metaStyle}>
					<CircleDashed class="size-3.5 shrink-0" strokeWidth={1.75} style="color: {mark.backlog}" />
					{project.status}
				</span>
			</button>
		{/each}
	</div>
</Shell>
