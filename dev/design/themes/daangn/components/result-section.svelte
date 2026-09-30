<!-- SEED ResultSection (registry ui/result-section): centred asset, title (t8 bold large / t5 bold
     medium), description (t5 / t4, neutral-muted), then a neutralWeak medium primary action and a
     ghost small secondary action. px48 py16; text block gap 12 / 8, pb 28 / 24. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import ActionButton from "./action-button.svelte";
	import Text from "./text.svelte";

	let {
		size = "large",
		title,
		description,
		primary,
		secondary,
		onPrimary,
		onSecondary,
		asset,
	}: {
		size?: "large" | "medium";
		title?: string;
		description?: string;
		primary?: string;
		secondary?: string;
		onPrimary?: () => void;
		onSecondary?: () => void;
		asset?: Snippet;
	} = $props();
	const large = $derived(size === "large");
</script>

<div style="display: flex; flex-direction: column; justify-content: center; align-items: center; flex-grow: 1; padding: var(--dimension-x4) var(--dimension-x12)">
	{@render asset?.()}
	<div style="display: flex; flex-direction: column; gap: var({large ? '--dimension-x3' : '--dimension-x2'}); padding-bottom: var({large ? '--dimension-x7' : '--dimension-x6'})">
		<Text textStyle={large ? "t8Bold" : "t5Bold"} color="--fg-neutral" align="center"><span style="white-space: pre-line">{title}</span></Text>
		<Text textStyle={large ? "t5Regular" : "t4Regular"} color="--fg-neutral-muted" align="center"><span style="white-space: pre-line">{description}</span></Text>
	</div>
	{#if primary || secondary}
		<div style="display: flex; flex-direction: column; align-items: center; gap: var(--dimension-x5)">
			{#if primary}<ActionButton variant="neutralWeak" size="medium" onclick={onPrimary}>{primary}</ActionButton>{/if}
			{#if secondary}<ActionButton variant="ghost" size="small" color="--fg-neutral" fontWeight="bold" style="margin: calc(var(--dimension-x2) * -1) calc(var(--dimension-x3-5) * -1)" onclick={onSecondary}>{secondary}</ActionButton>{/if}
		</div>
	{/if}
</div>
