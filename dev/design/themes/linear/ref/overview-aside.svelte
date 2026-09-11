<script lang="ts">
	import CalendarPlus from "@lucide/svelte/icons/calendar-plus";
	import Diamond from "@lucide/svelte/icons/diamond";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import Hash from "@lucide/svelte/icons/hash";
	import Plus from "@lucide/svelte/icons/plus";
	import Tag from "@lucide/svelte/icons/tag";
	import UserRound from "@lucide/svelte/icons/user-round";
	import Users from "@lucide/svelte/icons/users";
	import * as Card from "$lib/components/ui/card/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		inspectorStyle,
		mark,
		metaStyle,
		propFilledStyle,
		propLabelStyle,
		propRowStyle,
		sectionBodyStyle,
		sectionHeadStyle,
		sectionIconStyle,
		sectionTriggerStyle,
		titleStyle,
	} from "./chrome.ts";
	import { dateGrains, members, milestoneActions, slackMenu } from "./menus.ts";
	import { overview } from "./data.ts";
	import PropPicker from "./prop-picker.svelte";
	import PropPopover from "./prop-popover.svelte";
	import PropPriority from "./prop-priority.svelte";
	import PropStatus from "./prop-status.svelte";
	import RefMenu from "./ref-menu.svelte";

	let {
		status = $bindable("Backlog"),
		priority = $bindable("No priority"),
		lead = $bindable("No lead"),
		grain = $bindable("Day"),
		labelDraft = $bindable(""),
	}: {
		status?: string;
		priority?: string;
		lead?: string;
		grain?: string;
		labelDraft?: string;
	} = $props();

	let propsOpen = $state(true);
	let milesOpen = $state(true);
	let progressOpen = $state(true);
	let activityOpen = $state(true);
	let milestoneOpen = $state(false);
	let milestoneName = $state("");

</script>

{#snippet foldCaret(open: boolean)}
	<svg
		aria-hidden="true"
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="currentColor"
		style="display: block; width: 16px; height: 16px; flex-shrink: 0; transform: rotate({open
			? 90
			: 0}deg)"
	>
		<path
			d="M7.00194 10.6239C6.66861 10.8183 6.25 10.5779 6.25 10.192V5.80802C6.25 5.42212 6.66861 5.18169 7.00194 5.37613L10.7596 7.56811C11.0904 7.76105 11.0904 8.23895 10.7596 8.43189L7.00194 10.6239Z"
		/>
	</svg>
{/snippet}

{#snippet dateRow(label: string, aria: string)}
	<PropPopover {label} emptyText={`Add ${label.toLowerCase()}`} ariaLabel={aria} idleIcon={CalendarPlus}>
		<p style="{metaStyle}; color: var(--muted-foreground)">{label}</p>
		{#each dateGrains as item (item)}
			<Button
				variant={grain === item ? "secondary" : "ghost"}
				size="sm"
				class="h-7 justify-start"
				onclick={() => (grain = item)}>{item}</Button
			>
		{/each}
	</PropPopover>
{/snippet}

<aside class="flex w-[300px] shrink-0 flex-col gap-2 overflow-auto p-3">
	<Card.Root class="gap-0 overflow-visible border-0 shadow-none" style={inspectorStyle}>
		<Card.Header style={sectionHeadStyle}>
			<div style="display: flex; min-width: 0; flex: 1; align-items: center">
				<button
					type="button"
					style={sectionTriggerStyle}
					aria-label="Collapse properties section"
					aria-expanded={propsOpen}
					onclick={() => (propsOpen = !propsOpen)}
				>
					<span>Properties</span>
					{@render foldCaret(propsOpen)}
				</button>
			</div>
			<div style="display: flex; flex-shrink: 0; align-items: center">
				<Button
					variant="ghost"
					size="icon-sm"
					disabled
					style="{sectionIconStyle}; opacity: 0.6"
					aria-label="Add dependency"
				>
					<Plus style="width: 14px; height: 14px" strokeWidth={1.75} />
				</Button>
			</div>
		</Card.Header>
		{#if propsOpen}
			<Card.Content style={sectionBodyStyle}>
				<PropStatus bind:value={status} />
				<PropPriority bind:value={priority} />
				<PropPicker
					label="Lead"
					value={lead}
					empty={lead === "No lead"}
					emptyText={lead === "No lead" ? "Add lead" : undefined}
					ariaLabel="Add lead"
					idleIcon={UserRound}
					items={[...members.map((m) => ({ label: m.name })), { label: "Invite and add…" }]}
					onPick={(label) => {
						if (label !== "Invite and add…") lead = label;
					}}
				/>
				<PropPicker
					label="Members"
					value=""
					empty
					emptyText="Add members"
					ariaLabel="Add members"
					idleIcon={Users}
					items={[...members.filter((m) => m.id !== "none").map((m) => ({ label: m.name })), { label: "Invite and add…" }]}
				/>
				{@render dateRow("Start date", "Add start date")}
				{@render dateRow("Target date", "Add target date")}
				<div style={propRowStyle}>
					<span style={propLabelStyle}>Teams</span>
					<span style={propFilledStyle}>
						<span
							style="display: flex; width: 16px; height: 16px; align-items: center; justify-content: center; border-radius: 3px; background: {mark.team}; font-size: 9px; font-weight: 500; color: var(--background)"
							>E</span
						>
						EasyDev
					</span>
				</div>
				<PropPicker
					label="Slack"
					value=""
					empty
					emptyText="Slack channel"
					ariaLabel="Slack channel"
					idleIcon={Hash}
					items={slackMenu}
				/>
				<PropPopover label="Labels" emptyText="Add label" ariaLabel="Add labels" idleIcon={Tag}>
					<p style="{metaStyle}; color: var(--muted-foreground)">Start typing to create a new label</p>
					<Input bind:value={labelDraft} placeholder="Label" class="h-7" />
				</PropPopover>
			</Card.Content>
		{/if}
	</Card.Root>

	<Card.Root class="gap-0 overflow-visible border-0 shadow-none" style={inspectorStyle}>
		<Card.Header style={sectionHeadStyle}>
			<div style="display: flex; min-width: 0; flex: 1; align-items: center">
				<button
					type="button"
					style={sectionTriggerStyle}
					aria-label="Collapse milestones section"
					aria-expanded={milesOpen}
					onclick={() => (milesOpen = !milesOpen)}
				>
					<span>Milestones</span>
					{@render foldCaret(milesOpen)}
				</button>
			</div>
			<div style="display: flex; flex-shrink: 0; align-items: center">
				<Button
					variant="ghost"
					size="icon-sm"
					style={sectionIconStyle}
					aria-label="Add milestone"
					onclick={() => (milestoneOpen = true)}
				>
					<Plus style="width: 14px; height: 14px" strokeWidth={1.75} />
				</Button>
			</div>
		</Card.Header>
		{#if milesOpen}
			<Card.Content style={sectionBodyStyle}>
				<div class="flex h-8 items-center gap-2">
					<Diamond class="size-3.5 shrink-0" strokeWidth={1.75} style="color: {mark.progress}" />
					<span class="min-w-0 flex-1 truncate font-medium" style={titleStyle}>{overview.milestone.name}</span>
					<span class="text-muted-foreground" style={metaStyle}>0% of 1</span>
					<RefMenu items={milestoneActions} align="end">
						{#snippet trigger({ props })}
							<Button {...props} variant="ghost" size="icon-sm" class="size-7" aria-label="Milestone actions">
								<Ellipsis class="size-3.5" />
							</Button>
						{/snippet}
					</RefMenu>
				</div>
				<div class="flex h-8 items-center gap-2 text-muted-foreground" style={titleStyle}>
					<Diamond class="size-3.5" strokeWidth={1.75} />
					No milestone
				</div>
			</Card.Content>
		{/if}
	</Card.Root>

	<Card.Root class="gap-0 overflow-visible border-0 shadow-none" style={inspectorStyle}>
		<Card.Header style={sectionHeadStyle}>
			<div style="display: flex; min-width: 0; flex: 1; align-items: center">
				<button
					type="button"
					style={sectionTriggerStyle}
					aria-label="Collapse progress section"
					aria-expanded={progressOpen}
					onclick={() => (progressOpen = !progressOpen)}
				>
					<span>Progress</span>
					{@render foldCaret(progressOpen)}
				</button>
			</div>
		</Card.Header>
		{#if progressOpen}
			<Card.Content style="{sectionBodyStyle}; gap: 8px; {metaStyle}">
				<div class="flex justify-between text-muted-foreground">
					<span>Scope</span>
					<span>Completed</span>
				</div>
				<div class="h-1 rounded-full bg-muted">
					<div class="h-1 w-0 rounded-full bg-[color:var(--status-highlight)]"></div>
				</div>
				<button type="button" class="flex h-8 items-center gap-2 text-muted-foreground">
					<UserRound class="size-3.5" strokeWidth={1.75} />
					No assignee
					<span class="ml-auto">1</span>
				</button>
			</Card.Content>
		{/if}
	</Card.Root>

	<Card.Root class="gap-0 overflow-visible border-0 shadow-none" style={inspectorStyle}>
		<Card.Header style={sectionHeadStyle}>
			<div style="display: flex; min-width: 0; flex: 1; align-items: center">
				<button
					type="button"
					style={sectionTriggerStyle}
					aria-label="Collapse activity section"
					aria-expanded={activityOpen}
					onclick={() => (activityOpen = !activityOpen)}
				>
					<span>Activity</span>
					{@render foldCaret(activityOpen)}
				</button>
			</div>
			<div style="display: flex; flex-shrink: 0; align-items: center">
				<Button
					variant="ghost"
					size="sm"
					style="height: 16px; padding: 0; font-size: var(--text-label-sm); color: var(--muted-foreground)"
				>
					See all
				</Button>
			</div>
		</Card.Header>
		{#if activityOpen}
			<Card.Content style="{sectionBodyStyle}; gap: 12px; {metaStyle}">
				{#each overview.activity as item, index (index)}
					<div
						class="flex items-start gap-2 text-muted-foreground"
						style="min-width: 0"
					>
						<Diamond class="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
						<p style="min-width: 0; overflow-wrap: anywhere">
							<span class="font-medium text-foreground">{item.text.split(" ")[0]} {item.text.split(" ")[1]}</span>
							{item.text.split(" ").slice(2).join(" ")}
							· {item.date}
						</p>
					</div>
				{/each}
			</Card.Content>
		{/if}
	</Card.Root>
</aside>

<Dialog.Root bind:open={milestoneOpen}>
	<Dialog.Content class="gap-2 p-4 sm:max-w-sm" showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title style={titleStyle}>Add milestone</Dialog.Title>
			<Dialog.Description class="sr-only">Create a milestone</Dialog.Description>
		</Dialog.Header>
		<Input bind:value={milestoneName} placeholder="Name" class="h-8" />
		<div class="flex justify-end gap-1">
			<Button variant="ghost" size="sm" onclick={() => (milestoneOpen = false)}>Cancel</Button>
			<Button
				size="sm"
				onclick={() => {
					milestoneName = "";
					milestoneOpen = false;
				}}>Add</Button
			>
		</div>
	</Dialog.Content>
</Dialog.Root>
