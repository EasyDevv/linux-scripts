<script lang="ts">
	import { statusItems } from "./menus.ts";
	import PropPicker from "./prop-picker.svelte";

	let { value = $bindable("Backlog") }: { value?: string } = $props();
</script>

<PropPicker
	label="Status"
	{value}
	items={statusItems}
	search="Change status…"
	searchKbd="P then S"
	ariaLabel="Backlog"
	onPick={(label) => (value = label)}
/>
