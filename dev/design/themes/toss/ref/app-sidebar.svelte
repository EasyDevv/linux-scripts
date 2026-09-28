<script lang="ts">
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { NAV, draftHref, type PageId } from "./data.ts";
	import { docsMark, navGroupStyle, navItemIdle, navItemSelected } from "./chrome.ts";

	let { page }: { page: PageId } = $props();
</script>

<Sidebar.Root class="h-full">
	<Sidebar.Header class="bg-sidebar" style="padding: 14px 16px 10px">
		<a href={draftHref("foundation")} style="font-size: 16px; line-height: 24px; font-weight: 700; color: {docsMark.link}; text-decoration: none">
			TDS Mobile
		</a>
	</Sidebar.Header>
	<Sidebar.Content class="bg-sidebar" style="padding: 4px 0 12px">
		{#each NAV as group (group.title)}
			{#if group.title}
				<div style={navGroupStyle}>{group.title}</div>
			{/if}
			<Sidebar.Group style="padding: 0 8px">
				{#each group.items as item (item.label)}
					<Sidebar.MenuItem value={item.label}>
						{#if item.page}
							<a href={draftHref(item.page, item.id)} style={item.page === page && (!item.id || item.page === "button") ? navItemSelected : navItemIdle}>
								{item.label}
							</a>
						{:else}
							<span style={navItemIdle}>{item.label}</span>
						{/if}
					</Sidebar.MenuItem>
				{/each}
			</Sidebar.Group>
		{/each}
	</Sidebar.Content>
</Sidebar.Root>
