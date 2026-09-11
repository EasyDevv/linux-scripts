<script lang="ts">
	import Bot from "@lucide/svelte/icons/bot";
	import Box from "@lucide/svelte/icons/box";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import CircleDot from "@lucide/svelte/icons/circle-dot";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import FolderGit2 from "@lucide/svelte/icons/folder-git-2";
	import House from "@lucide/svelte/icons/house";
	import Inbox from "@lucide/svelte/icons/inbox";
	import Layers from "@lucide/svelte/icons/layers";
	import Plus from "@lucide/svelte/icons/plus";
	import Search from "@lucide/svelte/icons/search";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { mark, menuMark, navStyle } from "./chrome.ts";
	import { workspace, type PageId } from "./data.ts";
	import { moreMenu, workspaceMenu } from "./menus.ts";
	import RefMenu from "./ref-menu.svelte";

	let { page }: { page: PageId } = $props();

	let workspaceOpen = $state(true);
	let teamsOpen = $state(true);
	let tryOpen = $state(true);
	let teamOpen = $state(true);
	let searchOpen = $state(false);
	let issueOpen = $state(false);
	let issueTitle = $state("");
	let searchQuery = $state("");

	const teamActive = $derived(
		page === "projects-all" ? "projects" : page === "team-all" ? "issues" : "",
	);

	function go(file: string) {
		window.parent?.postMessage(
			{ type: "draft-navigate", file, project: "theme-linear" },
			"*",
		);
	}

	const itemClass =
		"h-7 w-full translate-x-0 gap-1.5 rounded-sm px-2 py-0 font-medium text-[color:var(--ink-soft)] [&>svg]:size-3.5 [&>svg]:text-muted-foreground [&_svg]:size-3.5 [&_svg]:text-muted-foreground";
</script>

<Sidebar.Root
	collapsible="offcanvas"
	data-role="navigator"
	class="border-e-0 group-data-[side=left]:border-e-0"
	style="border-inline-end-width: 0"
>
	<Sidebar.Header class="flex-row items-center gap-1 px-3 pt-3 pb-1">
		<RefMenu items={workspaceMenu} width={menuMark.widthWorkspace}>
			{#snippet trigger({ props })}
				<button
					type="button"
					{...props}
					class="flex h-7 min-w-0 items-center justify-start gap-1.5 rounded-sm font-medium text-[color:var(--ink-soft)]"
					style="padding-left: 5px; padding-right: 9px; {navStyle}"
					aria-label="Workspace"
				>
					<span
						class="flex size-5 shrink-0 items-center justify-center rounded-sm text-[11px] font-medium text-background"
						style="background: {mark.workspace}">{workspace.initials}</span
					>
					<span class="min-w-0 truncate">{workspace.name}</span>
					<ChevronDown class="size-2 shrink-0" strokeWidth={2.5} />
				</button>
			{/snippet}
		</RefMenu>
		<Button
			variant="ghost"
			size="icon-sm"
			class="ml-auto rounded-full text-[color:var(--ink-soft)]"
			aria-label="Search"
			onclick={() => (searchOpen = true)}
		>
			<Search class="size-3.5" strokeWidth={1.75} />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			class="rounded-full text-accent-foreground"
			style="background: color-mix(in srgb, var(--foreground) 14%, transparent)"
			aria-label="New issue"
			onclick={() => (issueOpen = true)}
		>
			<Plus class="size-3.5" strokeWidth={1.75} />
		</Button>
	</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group class="px-3 pt-1 pb-0">
			<Sidebar.GroupContent>
				<Sidebar.Menu style="gap: 1px">
					<Sidebar.MenuItem>
						<Sidebar.MenuButton size="sm" class={itemClass} style={navStyle}>
							<Inbox strokeWidth={1.75} />
							<span>Inbox</span>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton size="sm" class={itemClass} style={navStyle}>
							<CircleDot strokeWidth={1.75} />
							<span>My issues</span>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton size="sm" class={itemClass} style={navStyle}>
							<Bot strokeWidth={1.75} />
							<span>Agent</span>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>

		<Sidebar.Group class="px-3 pt-3 pb-0">
			<Sidebar.GroupLabel class="h-7 gap-1 px-2 font-medium text-muted-foreground" style={navStyle}>
				{#snippet child({ props })}
					<button type="button" {...props} onclick={() => (workspaceOpen = !workspaceOpen)}>
						Workspace
						{#if workspaceOpen}
							<ChevronDown class="size-2" strokeWidth={2.5} />
						{:else}
							<ChevronRight class="size-2" strokeWidth={2.5} />
						{/if}
					</button>
				{/snippet}
			</Sidebar.GroupLabel>
			{#if workspaceOpen}
				<Sidebar.GroupContent>
					<Sidebar.Menu style="gap: 1px">
						<Sidebar.MenuItem>
							<Sidebar.MenuButton
								size="sm"
								class={itemClass}
								style={navStyle}
								onclick={() => go("projects-all/page.svelte")}
							>
								<Box strokeWidth={1.75} />
								<span>Projects</span>
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
						<Sidebar.MenuItem>
							<Sidebar.MenuButton size="sm" class={itemClass} style={navStyle}>
								<Layers strokeWidth={1.75} />
								<span>Views</span>
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
						<Sidebar.MenuItem>
							<RefMenu items={moreMenu}>
								{#snippet trigger({ props })}
									<button type="button" {...props} class="flex {itemClass} items-center" style={navStyle}>
										<Ellipsis class="size-3.5" strokeWidth={1.75} />
										<span>More</span>
									</button>
								{/snippet}
							</RefMenu>
						</Sidebar.MenuItem>
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			{/if}
		</Sidebar.Group>

		<Sidebar.Group class="px-3 pt-3 pb-0">
			<Sidebar.GroupLabel class="h-7 gap-1 px-2 font-medium text-muted-foreground" style={navStyle}>
				{#snippet child({ props })}
					<button type="button" {...props} onclick={() => (teamsOpen = !teamsOpen)}>
						Your teams
						{#if teamsOpen}
							<ChevronDown class="size-2" strokeWidth={2.5} />
						{:else}
							<ChevronRight class="size-2" strokeWidth={2.5} />
						{/if}
					</button>
				{/snippet}
			</Sidebar.GroupLabel>
			{#if teamsOpen}
				<Sidebar.GroupContent>
					<Sidebar.Menu style="gap: 1px">
						<Sidebar.MenuItem>
							<Sidebar.MenuButton
								size="sm"
								class={itemClass}
								style={navStyle}
								onclick={() => (teamOpen = !teamOpen)}
							>
								<span
									class="flex size-4 shrink-0 items-center justify-center rounded-[3px] text-[9px] font-medium text-background"
									style="background: {mark.team}">E</span
								>
								<span class="min-w-0 truncate text-left">{workspace.team}</span>
								<ChevronDown class="size-2" strokeWidth={2.5} />
							</Sidebar.MenuButton>
							{#if teamOpen}
								<Sidebar.MenuSub class="mx-0 w-auto border-0 px-0" style="margin-inline-start: 19px">
									<Sidebar.MenuSubItem>
										<Sidebar.MenuSubButton size="sm" class="{itemClass} w-full" style={navStyle}>
											<House strokeWidth={1.75} />
											<span>Home</span>
										</Sidebar.MenuSubButton>
									</Sidebar.MenuSubItem>
									<Sidebar.MenuSubItem>
										<Sidebar.MenuSubButton
											size="sm"
											isActive={teamActive === "issues"}
											class="{itemClass} w-full"
											style={navStyle}
										>
											{#snippet child({ props })}
												<button type="button" {...props} onclick={() => go("team-all/page.svelte")}>
													<CircleDot strokeWidth={1.75} />
													<span>Issues</span>
												</button>
											{/snippet}
										</Sidebar.MenuSubButton>
									</Sidebar.MenuSubItem>
									<Sidebar.MenuSubItem>
										<Sidebar.MenuSubButton
											size="sm"
											isActive={teamActive === "projects"}
											class="{itemClass} w-full"
											style={navStyle}
										>
											{#snippet child({ props })}
												<button
													type="button"
													{...props}
													onclick={() => go("projects-all/page.svelte")}
												>
													<Box strokeWidth={1.75} />
													<span>Projects</span>
												</button>
											{/snippet}
										</Sidebar.MenuSubButton>
									</Sidebar.MenuSubItem>
									<Sidebar.MenuSubItem>
										<Sidebar.MenuSubButton size="sm" class="{itemClass} w-full" style={navStyle}>
											<Layers strokeWidth={1.75} />
											<span>Views</span>
										</Sidebar.MenuSubButton>
									</Sidebar.MenuSubItem>
								</Sidebar.MenuSub>
							{/if}
						</Sidebar.MenuItem>
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			{/if}
		</Sidebar.Group>

		<Sidebar.Group class="px-3 pt-3 pb-0">
			<Sidebar.GroupLabel class="h-7 gap-1 px-2 font-medium text-muted-foreground" style={navStyle}>
				{#snippet child({ props })}
					<button type="button" {...props} onclick={() => (tryOpen = !tryOpen)}>
						Try
						{#if tryOpen}
							<ChevronDown class="size-2" strokeWidth={2.5} />
						{:else}
							<ChevronRight class="size-2" strokeWidth={2.5} />
						{/if}
					</button>
				{/snippet}
			</Sidebar.GroupLabel>
			{#if tryOpen}
				<Sidebar.GroupContent>
					<Sidebar.Menu style="gap: 1px">
						<Sidebar.MenuItem>
							<Sidebar.MenuButton size="sm" class={itemClass} style={navStyle}>
								<Inbox strokeWidth={1.75} />
								<span>Import issues</span>
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
						<Sidebar.MenuItem>
							<Sidebar.MenuButton size="sm" class={itemClass} style={navStyle}>
								<Plus strokeWidth={1.75} />
								<span>Invite people</span>
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
						<Sidebar.MenuItem>
							<Sidebar.MenuButton size="sm" class={itemClass} style={navStyle}>
								<FolderGit2 strokeWidth={1.75} />
								<span>Connect GitHub</span>
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			{/if}
		</Sidebar.Group>
	</Sidebar.Content>
</Sidebar.Root>

<Dialog.Root bind:open={searchOpen}>
	<Dialog.Content class="gap-2 p-3 sm:max-w-md" showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title style={navStyle}>Search workspace</Dialog.Title>
			<Dialog.Description class="sr-only">Jump to a page</Dialog.Description>
		</Dialog.Header>
		<Input bind:value={searchQuery} placeholder="Search…" class="h-8" />
		<div class="grid gap-1">
			<Button
				variant="ghost"
				class="h-8 justify-start"
				onclick={() => {
					searchOpen = false;
					go("project-overview/page.svelte");
				}}>Test</Button
			>
			<Button
				variant="ghost"
				class="h-8 justify-start"
				onclick={() => {
					searchOpen = false;
					go("team-all/page.svelte");
				}}>Issues</Button
			>
			<Button
				variant="ghost"
				class="h-8 justify-start"
				onclick={() => {
					searchOpen = false;
					go("projects-all/page.svelte");
				}}>Projects</Button
			>
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={issueOpen}>
	<Dialog.Content class="gap-2 p-3 sm:max-w-md" showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title style={navStyle}>New issue</Dialog.Title>
			<Dialog.Description class="sr-only">Create an issue</Dialog.Description>
		</Dialog.Header>
		<Input bind:value={issueTitle} placeholder="Issue title" class="h-8" />
		<div class="flex justify-end gap-1">
			<Button variant="ghost" size="sm" onclick={() => (issueOpen = false)}>Cancel</Button>
			<Button
				size="sm"
				onclick={() => {
					issueTitle = "";
					issueOpen = false;
				}}>Create</Button
			>
		</div>
	</Dialog.Content>
</Dialog.Root>
