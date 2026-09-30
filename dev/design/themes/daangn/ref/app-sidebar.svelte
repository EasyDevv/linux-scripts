<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { railCurrent, railGroup, railIdle, versionButton } from "./chrome.ts";
	import { NAV, draftHref, type PageId } from "./data.ts";

	let { page }: { page: PageId } = $props();
</script>

<Sidebar.Root class="!top-[76px] !h-[calc(100svh-76px)] !border-e-0">
	<Sidebar.Header class="bg-sidebar" style="padding: 20px 12px 8px">
		<button type="button" style={versionButton}>v2.0 (latest) <ChevronDown size={16} /></button>
	</Sidebar.Header>
	<Sidebar.Content class="bg-sidebar" style="padding: 0 12px 64px; gap: 2px">
		{#each NAV as group (group.title)}
			{#if group.title}
				<div style={railGroup}>{group.title}</div>
			{/if}
			<Sidebar.Menu class="gap-0.5">
			{#each group.items as item (item.label)}
				<Sidebar.MenuItem>
					<a
						href={item.page ? draftHref(item.page, item.id) : "#top"}
						style={item.page === page && !item.id ? railCurrent : railIdle}
						aria-current={item.page === page && !item.id ? "page" : undefined}
					>
						{item.label}
					</a>
				</Sidebar.MenuItem>
			{/each}
			</Sidebar.Menu>
		{/each}
	</Sidebar.Content>
</Sidebar.Root>
