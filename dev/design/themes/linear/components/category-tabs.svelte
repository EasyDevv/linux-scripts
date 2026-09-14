<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";

	type Item = { id: string; label: string };

	let {
		items,
		value,
		onPick,
	}: {
		items: Item[];
		value: string;
		onPick: (id: string) => void;
	} = $props();

	const tabOn =
		"height: var(--control-height-nav); border-radius: var(--radius-pill); font-size: var(--text-label-sm); background: var(--tab-selected); color: var(--foreground)";
	const tabOff =
		"height: var(--control-height-nav); border-radius: var(--radius-pill); font-size: var(--text-label-sm); background: var(--tab-idle); color: var(--muted-foreground)";
</script>

{#each items as item (item.id)}
	<Button
		variant="ghost"
		size="sm"
		class="h-7 rounded-full px-2.5 font-medium"
		style={item.id === value ? tabOn : tabOff}
		data-role="chip"
		aria-pressed={item.id === value}
		onclick={() => onPick(item.id)}
	>
		{item.label}
	</Button>
{/each}
