<script lang="ts">
	import Search from "@lucide/svelte/icons/search";
	import { docsMark, navRule } from "./chrome.ts";
</script>

<header
	data-role="app-header"
	class="flex shrink-0 items-center gap-2 bg-card"
	style={navRule}
>
	<div class="ml-auto flex items-center gap-2">
		<div
			class="flex items-center gap-2"
			style="height: 36px; width: 260px; padding-inline: 12px; border-radius: 8px; background: var(--surface-well); color: {docsMark.subtleInk}; font-size: 14px; line-height: 21px; white-space: nowrap"
		>
			<Search size={16} />
			<span class="truncate">Search documentation...</span>
			<kbd
				style="margin-left: auto; font-size: 11px; line-height: 16px; padding: 1px 4px; border-radius: 4px; border: 0.8px solid {docsMark.inlineCodeRule}; color: {docsMark.subtleInk}"
				>CTRL K</kbd
			>
		</div>
	</div>
</header>
