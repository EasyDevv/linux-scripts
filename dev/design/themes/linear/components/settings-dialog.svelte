<script lang="ts">
	import XIcon from "@lucide/svelte/icons/x";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import * as Field from "$lib/components/ui/field/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import * as Select from "$lib/components/ui/select/index.js";

	const INTERVAL_IDS = ["30s", "1m", "5m", "10m", "30m", "1h", "off"] as const;
	const INTERVAL_LABELS: Record<(typeof INTERVAL_IDS)[number], string> = {
		"30s": "30 seconds",
		"1m": "1 minute",
		"5m": "5 minutes",
		"10m": "10 minutes",
		"30m": "30 minutes",
		"1h": "1 hour",
		off: "Off",
	};

	let {
		open = $bindable(false),
		saving = false,
		interval = $bindable<(typeof INTERVAL_IDS)[number]>("1m"),
		commandcodeKey = $bindable(""),
		opencodeCookie = $bindable(""),
		grokManagementKey = $bindable(""),
		openaiOn = false,
		commandcodeOn = false,
		opencodeOn = false,
		grokOn = false,
		onSave,
	}: {
		open: boolean;
		saving?: boolean;
		interval?: (typeof INTERVAL_IDS)[number];
		commandcodeKey?: string;
		opencodeCookie?: string;
		grokManagementKey?: string;
		openaiOn?: boolean;
		commandcodeOn?: boolean;
		opencodeOn?: boolean;
		grokOn?: boolean;
		onSave: (event: SubmitEvent) => void;
	} = $props();

	const SELECT_ITEM_PX = 32;
	const SELECT_TRIGGER_PX = 30;
	const fieldRow = "flex-col items-start px-4 py-4 @[28rem]:flex-row @[28rem]:items-center";
	const fieldInput =
		"h-8 w-full max-w-52 rounded-sm border-input px-3 font-mono text-heading-sm dark:!bg-transparent";
	const triggerClass = "h-[30px] w-full max-w-52 rounded-sm px-2.5 font-normal text-heading-sm";
	const intervalLabel = $derived(INTERVAL_LABELS[interval]);
	const intervalIndex = $derived(Math.max(0, INTERVAL_IDS.indexOf(interval)));
	const intervalSideOffset = $derived(-(intervalIndex * SELECT_ITEM_PX + SELECT_TRIGGER_PX));

	function piAuthStatus(on: boolean): string {
		return on ? "Using Pi auth" : "Not in Pi auth";
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="w-[calc(100%-2rem)] max-w-[480px] gap-0 p-0 sm:max-w-[480px]" showCloseButton={false}>
		<Dialog.Header class="flex-row items-start justify-between space-y-0 px-4 pt-4 pb-0">
			<div class="flex min-w-0 flex-col gap-1">
				<Dialog.Title>Settings</Dialog.Title>
				<Dialog.Description class="text-body-sm text-muted-foreground">
					Visit refresh and Pi auth overrides.
				</Dialog.Description>
			</div>
			<Dialog.Close>
				{#snippet child({ props })}
					<Button {...props} variant="ghost" size="icon-sm" class="rounded-full" aria-label="Close">
						<XIcon class="size-3.5" strokeWidth={1.75} />
					</Button>
				{/snippet}
			</Dialog.Close>
		</Dialog.Header>
		<form onsubmit={onSave}>
			<div class="flex flex-col gap-3 p-4">
				<div class="@container overflow-hidden rounded-md bg-secondary">
					<Field.Field orientation="horizontal" class={fieldRow}>
						<Field.Label class="text-heading-sm">Refresh interval</Field.Label>
						<Select.Root type="single" bind:value={interval}>
							<Select.Trigger class={triggerClass} id="refresh-interval">
								{intervalLabel}
							</Select.Trigger>
							<Select.Content
								sideOffset={intervalSideOffset}
								avoidCollisions={false}
								interactOutsideBehavior="ignore"
							>
								{#each INTERVAL_IDS as id (id)}
									<Select.Item value={id}>{INTERVAL_LABELS[id]}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</Field.Field>
				</div>
				<div class="@container overflow-hidden rounded-md bg-secondary">
					<Field.Field orientation="horizontal" class={fieldRow}>
						<Field.Label class="text-heading-sm">OpenAI</Field.Label>
						<span class="text-body-sm text-muted-foreground">{piAuthStatus(openaiOn)}</span>
					</Field.Field>
					<div
						class="mx-4 bg-foreground/10"
						style="height: var(--hairline-width)"
						data-role="row-divider"
					></div>
					<Field.Field orientation="horizontal" class={fieldRow}>
						<Field.Label for="commandcode-key" class="text-heading-sm">Command Code</Field.Label>
						<Input
							id="commandcode-key"
							name="commandcodeApiKey"
							class={fieldInput}
							type="password"
							autocomplete="off"
							placeholder={commandcodeOn ? "Using Pi auth" : "sk-…"}
							bind:value={commandcodeKey}
						/>
					</Field.Field>
					<div
						class="mx-4 bg-foreground/10"
						style="height: var(--hairline-width)"
						data-role="row-divider"
					></div>
					<Field.Field orientation="horizontal" class={fieldRow}>
						<Field.Label for="opencode-cookie" class="text-heading-sm">OpenCode Go</Field.Label>
						<Input
							id="opencode-cookie"
							name="opencodeCookie"
							class={fieldInput}
							type="password"
							autocomplete="off"
							placeholder={opencodeOn ? "Using Pi auth" : "auth=…"}
							bind:value={opencodeCookie}
						/>
					</Field.Field>
					<div
						class="mx-4 bg-foreground/10"
						style="height: var(--hairline-width)"
						data-role="row-divider"
					></div>
					<Field.Field orientation="horizontal" class={fieldRow}>
						<Field.Label for="grok-mgmt" class="text-heading-sm">Grok</Field.Label>
						<Input
							id="grok-mgmt"
							name="grokManagementKey"
							class={fieldInput}
							type="password"
							autocomplete="off"
							placeholder={grokOn ? "Using Pi auth" : "xai-…"}
							bind:value={grokManagementKey}
						/>
					</Field.Field>
				</div>
			</div>
			<Dialog.Footer class="mx-0 mb-0 border-t-0 bg-transparent">
				<Button type="button" variant="secondary" class="rounded-full" onclick={() => (open = false)}>
					Cancel
				</Button>
				<Button type="submit" class="rounded-full" disabled={saving}>Save</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
