<script lang="ts">
	import { priorityItems } from "./menus.ts";
	import PropPicker from "./prop-picker.svelte";

	let { value = $bindable("No priority") }: { value?: string } = $props();
</script>

<PropPicker
	label="Priority"
	{value}
	items={priorityItems}
	search="Change priority…"
	ariaLabel="No priority"
	onPick={(label) => (value = label)}
/>
