<!-- draft-meta: {"route":"project-overview","title":"Test","style":"linear"} -->
<script lang="ts">
	import Bell from "@lucide/svelte/icons/bell";
	import Box from "@lucide/svelte/icons/box";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import CircleCheck from "@lucide/svelte/icons/circle-check";
	import Diamond from "@lucide/svelte/icons/diamond";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import MessageCircle from "@lucide/svelte/icons/message-circle";
	import Paperclip from "@lucide/svelte/icons/paperclip";
	import Plus from "@lucide/svelte/icons/plus";
	import ScanFace from "@lucide/svelte/icons/scan-face";
	import Star from "@lucide/svelte/icons/star";
	import X from "@lucide/svelte/icons/x";
	import * as Collapsible from "$lib/components/ui/collapsible/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Checkbox } from "$lib/components/ui/checkbox/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import * as Popover from "$lib/components/ui/popover/index.js";
	import { mark, menuMark, menuSurface, metaStyle, tabOff, tabOn, titleStyle } from "../chrome.ts";
	import { issueGroups, overview } from "../data.ts";
	import {
		dateGrains,
		members,
		notifyOptions,
		priorityItems,
		projectActions,
		resourceMenu,
		statusItems,
		viewMenu,
	} from "../menus.ts";
	import OverviewAside from "../overview-aside.svelte";
	import RefMenu from "../ref-menu.svelte";
	import Shell from "../shell.svelte";

	let tab = $state<"overview" | "activity" | "issues">("overview");
	let favorite = $state(false);
	let copied = $state(false);
	let showAside = $state(true);
	let iconOpen = $state(false);
	let notifyOpen = $state(false);
	let notify = $state([false, false, true, true]);
	let milestoneOpen = $state(true);
	let title = $state(overview.title);
	let summary = $state(overview.summary);
	let status = $state("Backlog");
	let priority = $state("No priority");
	let lead = $state("No lead");

	function copyUrl() {
		const href = "https://linear.app/easydevs/project/test-e6937f6cefe6/overview";
		void navigator.clipboard?.writeText(href);
		copied = true;
		setTimeout(() => (copied = false), 1200);
	}

	function goIssues() {
		window.parent?.postMessage(
			{ type: "draft-navigate", file: "team-all/page.svelte", project: "theme-linear" },
			"*",
		);
	}
</script>

<Shell page="project-overview" title="">
	{#snippet header()}
		<div class="flex min-w-0 items-center gap-1.5">
			<button
				type="button"
				class="text-muted-foreground"
				style={titleStyle}
				onclick={() =>
					window.parent?.postMessage(
						{ type: "draft-navigate", file: "projects-all/page.svelte", project: "theme-linear" },
						"*",
					)}
			>
				Projects
			</button>
			<ChevronRight class="size-3 text-muted-foreground" strokeWidth={2} />
			<Box class="size-3.5 text-muted-foreground" strokeWidth={1.75} />
			<span class="font-medium text-[color:var(--ink-soft)]" style={titleStyle}>{title}</span>
			<Button
				variant="ghost"
				size="icon-sm"
				class="rounded-full text-muted-foreground"
				aria-label="Add to favorites"
				onclick={() => (favorite = !favorite)}
			>
				<Star class="size-3.5" strokeWidth={1.75} fill={favorite ? "currentColor" : "none"} />
			</Button>
			<RefMenu items={projectActions} onPick={(label) => { if (label.startsWith("Copy")) copyUrl(); if (label === "Favorite") favorite = !favorite; }}>
				{#snippet trigger({ props })}
					<Button {...props} variant="ghost" size="icon-sm" class="rounded-full text-muted-foreground" aria-label="Project actions">
						<Ellipsis class="size-3.5" strokeWidth={1.75} />
					</Button>
				{/snippet}
			</RefMenu>
		</div>
		<div class="ml-auto flex items-center gap-1">
			<Button
				variant="ghost"
				size="icon-sm"
				class="rounded-full text-muted-foreground"
				aria-label="Copy page URL"
				onclick={copyUrl}
			>
				<Paperclip class="size-3.5" strokeWidth={1.75} />
			</Button>
			<Popover.Root bind:open={notifyOpen}>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button {...props} variant="ghost" size="icon-sm" class="rounded-full text-muted-foreground" aria-label="Setup project notifications">
							<Bell class="size-3.5" strokeWidth={1.75} />
						</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content
					align="end"
					class="gap-0 p-0 shadow-none ring-0"
					style="{menuSurface}; width: {menuMark.widthNotify}; border-radius: {menuMark.radiusTight}; padding: 10px 0"
				>
					<p class="flex items-center gap-1.5 px-3.5 pb-2 font-medium" style="font-size: 13px">
						Send inbox notifications for
						<Box class="size-3.5 text-muted-foreground" strokeWidth={1.75} />
						Test
					</p>
					{#each notifyOptions as item, index (item)}
						<label class="flex h-8 items-center gap-3 px-3.5" style="font-size: 13px">
							<span class="min-w-0 flex-1">{item}</span>
							<Checkbox
								checked={notify[index]}
								onCheckedChange={(value) => {
									notify[index] = value === true;
								}}
							/>
						</label>
					{/each}
					<div style="height: 12px; background: linear-gradient({menuMark.sep}, {menuMark.sep}) center / 100% 0.8px no-repeat"></div>
					<div class="flex items-center justify-between px-3.5 py-2">
						<div>
							<p class="font-medium" style="font-size: 13px">Update schedule</p>
							<p style="font-size: 12px; color: {menuMark.kbd}">No expectation for updates</p>
						</div>
						<Button
							variant="ghost"
							size="sm"
							class="h-7 rounded-full px-2.5"
							style="background: {menuMark.hover}; font-size: 13px">Change</Button
						>
					</div>
					<div style="height: 12px; background: linear-gradient({menuMark.sep}, {menuMark.sep}) center / 100% 0.8px no-repeat"></div>
					<div class="flex items-center justify-between px-3.5 py-2">
						<p class="font-medium" style="font-size: 13px">Slack notifications</p>
						<Button
							variant="ghost"
							size="sm"
							class="h-7 rounded-full px-2.5"
							style="background: {menuMark.hover}; font-size: 13px">Connect</Button
						>
					</div>
				</Popover.Content>
			</Popover.Root>
		</div>
	{/snippet}
	{#snippet tools()}
		<Button
			variant="ghost"
			size="sm"
			class="h-7 rounded-full px-2.5 font-medium"
			style={tab === "overview" ? tabOn : tabOff}
			onclick={() => (tab = "overview")}>Overview</Button
		>
		<Button
			variant="ghost"
			size="sm"
			class="h-7 rounded-full px-2.5 font-medium"
			style={tab === "activity" ? tabOn : tabOff}
			onclick={() => (tab = "activity")}>Activity</Button
		>
		<Button
			variant="ghost"
			size="sm"
			class="h-7 rounded-full px-2.5 font-medium"
			style={tab === "issues" ? tabOn : tabOff}
			onclick={() => (tab = "issues")}>Issues</Button
		>
		<RefMenu items={viewMenu}>
			{#snippet trigger({ props })}
				<Button {...props} variant="ghost" size="icon-sm" class="rounded-full text-muted-foreground" aria-label="Add new view">
					<Plus class="size-3.5" strokeWidth={1.75} />
				</Button>
			{/snippet}
		</RefMenu>
		<Button
			variant="ghost"
			size="icon-sm"
			class="ml-auto rounded-full text-muted-foreground"
			aria-label="Close project details"
			onclick={() => (showAside = !showAside)}
		>
			<X class="size-3.5" strokeWidth={1.75} />
		</Button>
	{/snippet}
	{#snippet aside()}
		{#if showAside}
			<OverviewAside bind:status bind:priority bind:lead />
		{/if}
	{/snippet}

	{#if tab === "issues"}
		<div class="flex flex-col gap-2 px-4 py-3">
			{#each issueGroups as group (group.id)}
				<p class="font-medium" style={titleStyle}>{group.label} {group.count}</p>
				{#each group.issues as issue (issue.id)}
					<button type="button" class="flex h-9 items-center gap-2 rounded-sm px-2 text-left hover:bg-accent" onclick={goIssues}>
						<span class="text-muted-foreground" style={metaStyle}>{issue.id}</span>
						<span style={titleStyle}>{issue.title}</span>
					</button>
				{/each}
			{/each}
		</div>
	{:else if tab === "activity"}
		<div class="flex flex-col gap-3 px-10 py-5">
			{#each overview.activity as item, index (index)}
				<p style={titleStyle}>
					<span class="font-medium">{item.text}</span>
					<span class="text-muted-foreground"> · {item.date}</span>
				</p>
			{/each}
		</div>
	{:else}
		<div class="flex flex-col gap-6 px-10 py-5">
			{#if copied}
				<p class="text-muted-foreground" style={metaStyle}>Copied page URL</p>
			{/if}
			<div class="flex items-start gap-3">
				<Button
					variant="ghost"
					size="icon-sm"
					class="rounded-sm"
					aria-label="Choose icon"
					onclick={() => (iconOpen = true)}
				>
					<Box class="size-8 text-muted-foreground" strokeWidth={1.5} />
				</Button>
				<div class="min-w-0 flex-1">
					<input
						class="w-full bg-transparent font-medium outline-none"
						style="font-size: var(--text-title)"
						bind:value={title}
						aria-label="Project name"
					/>
					<input
						class="w-full bg-transparent text-muted-foreground outline-none"
						style={titleStyle}
						bind:value={summary}
						aria-label="Project summary"
					/>
				</div>
			</div>
			<div class="flex flex-wrap items-center gap-2" style={titleStyle}>
				<RefMenu items={statusItems} width={menuMark.widthStatus} search="Change status…" searchKbd="P then S" selected={status} onPick={(label) => (status = label)}>
					{#snippet trigger({ props })}
						<Button {...props} variant="ghost" size="sm" class="h-7 gap-1.5">{status}</Button>
					{/snippet}
				</RefMenu>
				<RefMenu items={priorityItems} width={menuMark.widthStatus} search="Change priority…" selected={priority} onPick={(label) => (priority = label)}>
					{#snippet trigger({ props })}
						<Button {...props} variant="ghost" size="sm" class="h-7">{priority}</Button>
					{/snippet}
				</RefMenu>
				<RefMenu
					items={[...members.map((m) => ({ label: m.name })), { label: "Invite and add…" }]}
					onPick={(label) => {
						if (label !== "Invite and add…") lead = label;
					}}
				>
					{#snippet trigger({ props })}
						<Button {...props} variant="ghost" size="sm" class="h-7">{lead === "No lead" ? "Lead" : lead}</Button>
					{/snippet}
				</RefMenu>
				<RefMenu items={dateGrains.map((label) => ({ label }))}>
					{#snippet trigger({ props })}
						<Button {...props} variant="ghost" size="sm" class="h-7">Target date</Button>
					{/snippet}
				</RefMenu>
				<Button variant="ghost" size="sm" class="h-7">EasyDev</Button>
			</div>
			<div>
				<p class="mb-1 text-muted-foreground" style={metaStyle}>Resources</p>
				<RefMenu items={resourceMenu}>
					{#snippet trigger({ props })}
						<Button {...props} variant="ghost" size="sm" class="h-7 gap-1 text-muted-foreground" aria-label="Add document or link">
							<Plus class="size-3.5" />
							Add document or link…
						</Button>
					{/snippet}
				</RefMenu>
			</div>
			<div class="rounded-[var(--radius-md)] p-3" style="background: var(--secondary)">
				<div class="flex items-center gap-2">
					<CircleCheck class="size-3.5" strokeWidth={2} style="color: {mark.ok}" />
					<span class="font-medium" style={titleStyle}>{overview.health}</span>
					<span class="text-muted-foreground" style={metaStyle}>Lemon Blue · {overview.updateAge}</span>
					<Button variant="outline" size="sm" class="ml-auto h-7">Update</Button>
				</div>
				<p class="mt-2 font-medium" style={titleStyle}>{overview.updateTitle}</p>
				<div class="mt-2 flex gap-1">
					<Button variant="ghost" size="icon-sm" class="rounded-full" aria-label="0 comments">
						<MessageCircle class="size-3.5" />
					</Button>
					<Button variant="ghost" size="icon-sm" class="rounded-full" aria-label="Add reaction">
						<ScanFace class="size-3.5" />
					</Button>
				</div>
			</div>
			<pre
				class="max-w-[40rem] overflow-auto p-4 font-mono text-[13px] leading-5 text-[color:var(--ink-soft)]"
				style="border-radius: var(--radius-md); background: var(--background); border: var(--hairline-width) solid var(--border)">{overview.code}</pre>
			<Collapsible.Root bind:open={milestoneOpen}>
				<div class="flex items-center gap-2">
					<span class="font-medium text-[color:var(--ink-soft)]" style={titleStyle}>Milestones</span>
				</div>
				<Collapsible.Content
					forceMount
					class="min-h-0 overflow-hidden"
					style="display: grid; grid-template-rows: {milestoneOpen
						? '1fr'
						: '0fr'}; opacity: {milestoneOpen ? '1' : '0'}; transition: grid-template-rows var(--panel-fold-duration) var(--panel-fold-ease), opacity var(--panel-fold-duration) var(--panel-fold-ease)"
				>
					<div class="min-h-0 overflow-hidden">
						<div class="mt-3 flex items-center gap-2">
							<Diamond class="size-3.5" strokeWidth={1.75} style="color: {mark.progress}" />
							<button type="button" class="flex items-center gap-1 font-medium" style={titleStyle}>
								{overview.milestone.name}
								<ChevronDown class="size-3" strokeWidth={2} />
							</button>
							<span class="ml-auto text-muted-foreground" style={metaStyle}
								>{overview.milestone.issues} · {overview.milestone.pct}</span
							>
						</div>
						<p class="mt-2 font-medium" style={titleStyle}>{overview.milestone.description}</p>
					</div>
				</Collapsible.Content>
			</Collapsible.Root>
		</div>
	{/if}
</Shell>

<Dialog.Root bind:open={iconOpen}>
	<Dialog.Content class="gap-2 p-4 sm:max-w-sm" showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title style={titleStyle}>Choose icon</Dialog.Title>
			<Dialog.Description class="sr-only">Icons or emojis</Dialog.Description>
		</Dialog.Header>
		<div class="flex gap-1">
			<Button size="sm" class="h-7">Icons</Button>
			<Button variant="ghost" size="sm" class="h-7">Emojis</Button>
		</div>
		<div class="flex gap-2">
			<Button variant="outline" size="icon-sm" onclick={() => (iconOpen = false)}><Box class="size-4" /></Button>
			<Button variant="outline" size="icon-sm" onclick={() => (iconOpen = false)}><Diamond class="size-4" /></Button>
			<Button variant="outline" size="icon-sm" onclick={() => (iconOpen = false)}><ScanFace class="size-4" /></Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
