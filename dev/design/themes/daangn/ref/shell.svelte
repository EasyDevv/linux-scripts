<script lang="ts">
	import type { Snippet } from "svelte";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import AppFooter from "./app-footer.svelte";
	import AppHeader from "./app-header.svelte";
	import AppSidebar from "./app-sidebar.svelte";
	import type { PageId } from "./data.ts";

	let { page, children }: { page: PageId; children: Snippet } = $props();
</script>

<Sidebar.Provider open={true} class="relative h-svh min-h-0 overflow-hidden bg-bg-layer-default text-fg-neutral" style="--sidebar-width: 240px">
	<AppHeader />
	<AppSidebar {page} />
	<Sidebar.Inset class="relative min-h-0 min-w-0 overflow-hidden bg-bg-layer-default" style="margin-top: 76px; border-top-left-radius: 0">
		<div id="top" class="min-h-0 min-w-0 flex-1 overflow-auto" style="padding-bottom: 48px">
			{@render children()}
		</div>
	</Sidebar.Inset>
	<AppFooter />
</Sidebar.Provider>
