<script lang="ts">
	import Bot from "@lucide/svelte/icons/bot";
	import CircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import * as Popover from "$lib/components/ui/popover/index.js";
	import { menuMark, menuSurface } from "./chrome.ts";
	import { agentPrompts, helpMenu } from "./menus.ts";
	import RefMenu from "./ref-menu.svelte";

	let prompt = $state("");
</script>

<div
	data-role="app-footer"
	class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-between px-3"
	style="height: var(--shell-footer-height)"
>
	<RefMenu items={helpMenu} width={menuMark.widthHelp}>
		{#snippet trigger({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon-sm"
				class="pointer-events-auto rounded-full text-muted-foreground"
				style="border: var(--hairline-width) solid color-mix(in srgb, var(--foreground) 14%, transparent)"
				aria-label="Help"
			>
				<CircleQuestionMark class="size-3.5" strokeWidth={1.75} />
			</Button>
		{/snippet}
	</RefMenu>
	<Popover.Root>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					size="sm"
					class="pointer-events-auto h-7 gap-1 rounded-full px-2 text-muted-foreground"
					style="font-size: var(--text-label-sm)"
					aria-label="Agent"
				>
					<Bot class="size-3.5" strokeWidth={1.75} />
					Agent
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content
			align="end"
			class="gap-2 p-3 shadow-none ring-0"
			style="{menuSurface}; width: {menuMark.widthNotify}; border-radius: {menuMark.radiusTight}"
		>
			<p class="font-medium" style="font-size: var(--text-heading-sm)">New chat</p>
			<p class="text-muted-foreground" style="font-size: var(--text-body-sm)">
				Welcome to Linear. Ask anything or tell Linear what you need.
			</p>
			<Input bind:value={prompt} placeholder="Message…" class="h-8" />
			<div class="flex flex-wrap gap-1">
				{#each agentPrompts as item (item)}
					<Button variant="outline" size="sm" class="h-7 rounded-full" style="font-size: var(--text-label-sm)">
						{item}
					</Button>
				{/each}
			</div>
		</Popover.Content>
	</Popover.Root>
</div>
