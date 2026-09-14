<script lang="ts">
	import CircleCheck from "@lucide/svelte/icons/circle-check";
	import CircleDashed from "@lucide/svelte/icons/circle-dashed";
	import CircleDot from "@lucide/svelte/icons/circle-dot";
	import CircleEllipsis from "@lucide/svelte/icons/circle-ellipsis";
	import CirclePause from "@lucide/svelte/icons/circle-pause";
	import PropPicker from "./prop-picker.svelte";

	const STATUS_ITEMS = [
		{ value: "계획됨", icon: CircleDashed, iconClass: "text-status-neutral", kbd: "1" },
		{ value: "집필중", icon: CircleDot, iconClass: "text-status-highlight", kbd: "2" },
		{ value: "검토중", icon: CirclePause, iconClass: "text-status-info", kbd: "3" },
		{ value: "발행준비", icon: CircleEllipsis, iconClass: "text-status-info", kbd: "4" },
		{ value: "발행됨", icon: CircleCheck, iconClass: "text-status-highlight", kbd: "5" },
	];

	let {
		label = "상태",
		labelWidth = "40px",
		value = $bindable("검토중"),
		search = "상태 변경…",
		ariaLabel = "상태",
		onPick,
	}: {
		label?: string;
		labelWidth?: string;
		value?: string;
		search?: string;
		ariaLabel?: string;
		onPick?: (next: string) => void;
	} = $props();
</script>

<PropPicker
	{label}
	{labelWidth}
	{value}
	items={STATUS_ITEMS}
	{search}
	{ariaLabel}
	onPick={(next) => {
		value = next;
		onPick?.(next);
	}}
/>
