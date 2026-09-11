<script lang="ts">
	import type { Snippet } from "svelte";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import AppFooter from "./app-footer.svelte";
	import AppHeader from "./app-header.svelte";
	import AppSidebar from "./app-sidebar.svelte";
	import { panelStyle } from "./chrome.ts";
	import type { PageId } from "./data.ts";

	const STORAGE_KEY = "linear-ref-sidebar-open";

	let {
		page,
		title = "",
		header,
		tools,
		aside,
		children,
	}: {
		page: PageId;
		title?: string;
		header?: Snippet;
		tools?: Snippet;
		aside?: Snippet;
		children: Snippet;
	} = $props();

	let open = $state(
		typeof localStorage === "undefined" ? true : localStorage.getItem(STORAGE_KEY) !== "false",
	);

	function onOpenChange(value: boolean) {
		open = value;
		if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, String(value));
	}

	$effect(() => {
		if (typeof window === "undefined") return;
		const raw =
			getComputedStyle(document.documentElement).getPropertyValue("--sidebar-hide-below").trim() ||
			"1100px";
		const mq = window.matchMedia(`(max-width: ${raw})`);
		const apply = () => {
			if (mq.matches) open = false;
			else if (typeof localStorage !== "undefined") {
				open = localStorage.getItem(STORAGE_KEY) !== "false";
			}
		};
		apply();
		mq.addEventListener("change", apply);
		return () => mq.removeEventListener("change", apply);
	});
</script>

<Sidebar.Provider
	bind:open
	{onOpenChange}
	class="relative h-svh min-h-0 overflow-hidden bg-background text-foreground"
	style="--sidebar-width: 244px"
>
	<AppSidebar {page} />
	<div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
		<Sidebar.Inset
			class="relative w-auto min-h-0 min-w-0 overflow-hidden bg-card"
			style={panelStyle}
		>
			<AppHeader {title}>
				{@render header?.()}
			</AppHeader>
			{#if tools}
				<div class="flex h-9 shrink-0 items-center gap-1 px-3" data-role="toolbar">
					{@render tools()}
				</div>
			{/if}
			<div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
				<div class="min-h-0 min-w-0 flex-1 overflow-auto">
					{@render children()}
				</div>
				{#if aside}
					{@render aside()}
				{/if}
			</div>
		</Sidebar.Inset>
	</div>
	<AppFooter />
</Sidebar.Provider>
