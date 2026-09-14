<script lang="ts">
	import type { Snippet } from "svelte";
	import { headerRule, titleStyle } from "./chrome.ts";

	let {
		title = "",
		children,
	}: {
		title?: string;
		children?: Snippet;
	} = $props();
</script>

<header
	class="flex h-11 shrink-0 items-center gap-2"
	data-role="app-header"
	style="{headerRule}; padding-inline: 18px"
>
	{#if title}
		<h1 class="min-w-0 truncate font-medium text-[color:var(--ink-soft)]" style={titleStyle}>
			{title}
		</h1>
	{/if}
	{@render children?.()}
</header>
