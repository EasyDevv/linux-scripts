<script lang="ts">
	import type { Snippet } from "svelte";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import AppFooter from "./app-footer.svelte";
	import AppHeader from "./app-header.svelte";
	import AppSidebar from "./app-sidebar.svelte";
	import { panelStyle } from "./chrome.ts";
	import type { PageId } from "./data.ts";

	let { page, children }: { page: PageId; children: Snippet } = $props();
</script>

<Sidebar.Provider
	open={true}
	class="relative h-svh min-h-0 overflow-hidden bg-background text-foreground"
>
	<AppSidebar {page} />
	<div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
		<Sidebar.Inset
			class="relative w-auto min-h-0 min-w-0 overflow-hidden bg-card"
			style={panelStyle}
		>
			<AppHeader />
			<div class="min-h-0 min-w-0 flex-1 overflow-auto">
				{@render children()}
			</div>
		</Sidebar.Inset>
	</div>
	<AppFooter />
</Sidebar.Provider>
