<!-- TDS Bubble (components/bubble). Chat message.
     padding 12px 14px, r16, 16/24, max-width 253; 5px margin on the tail side.
     background blue = blue500 + white (mine, aligned end) · grey = grey200 + grey800 (theirs, start)
     tail 13x17 svg at the bottom corner, overhanging 5px; withTail false drops it. Stack gap 8. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		background = "blue",
		withTail = true,
		children,
	}: { background?: "blue" | "grey"; withTail?: boolean; children: Snippet } = $props();
</script>

<div class="tds-bubble-row" data-side={background === "blue" ? "end" : "start"}>
	<div class="tds-bubble" data-tds-mobile-component="Bubble" data-bg={background}>
		<span class="text" role="text">{@render children()}</span>
		{#if withTail}
			<svg class="tail" width="13" height="17" viewBox="0 0 13 17" aria-hidden="true">
				<path d="M0 0v11c0 3.3 2.7 6 6 6h7C8.6 15.6 5.9 12 5.9 7.4V0H0Z" />
			</svg>
		{/if}
	</div>
</div>

<style>
	.tds-bubble-row {
		display: flex;
		justify-content: flex-start;
	}
	.tds-bubble-row[data-side="end"] {
		justify-content: flex-end;
	}
	.tds-bubble {
		--bg: var(--grey-200);
		position: relative;
		max-width: 253px;
		margin: 0 0 0 5px;
		padding: 12px 14px;
		border-radius: 16px;
		background: var(--bg);
		color: var(--ink);
		font-size: var(--text-st10);
		line-height: var(--text-st10--line-height);
		word-break: keep-all;
	}
	.tds-bubble[data-bg="blue"] {
		--bg: var(--blue-500);
		margin: 0 5px 0 0;
		color: var(--static-white);
	}
	/* inline-block text inside a normal line box: the live bubble is 50h for one 24px line */
	.text {
		display: inline-block;
		vertical-align: baseline;
	}
	.tail {
		position: absolute;
		bottom: 0;
		left: -5px;
		fill: var(--bg);
		scale: -1 1;
	}
	[data-bg="blue"] .tail {
		right: -5px;
		left: auto;
		scale: 1 1;
	}
</style>
