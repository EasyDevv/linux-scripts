<!-- TDS Highlight (components/highlight). Coach-mark spotlight.
     A full-bleed mask in --highlight-dim (greyOpacity700 light = rgba(3,18,40,.7), kept static) with a rounded cut-out around the
     wrapped element (padding extends the hole), plus an optional white message 15/22.5/700
     aligned left|center|right, above|below the hole. Clicking the dim calls onclick.
     This port positions the dim inside the nearest positioned ancestor (the docs demo does the same). -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		open = false,
		padding = 0,
		radius = 12,
		message,
		messageXAlignment = "left",
		messageYAlignment = "bottom",
		onclick,
		children,
	}: {
		open?: boolean;
		padding?: number;
		radius?: number;
		message?: string;
		messageXAlignment?: "left" | "center" | "right";
		messageYAlignment?: "top" | "bottom";
		onclick?: () => void;
		children: Snippet;
	} = $props();
</script>

<div class="tds-highlight" data-tds-mobile-component="Highlight" data-open={open} style:--pad={`${padding}px`} style:--r={`${radius}px`}>
	<div class="target">{@render children()}</div>
	{#if open}
		<button type="button" class="hole" aria-label="닫기" {onclick}></button>
		{#if message}
			<p class="message" data-x={messageXAlignment} data-y={messageYAlignment}>{message}</p>
		{/if}
	{/if}
</div>

<style>
	.tds-highlight {
		position: relative;
	}
	.target {
		position: relative;
	}
	[data-open="true"] .target {
		z-index: 1;
		pointer-events: none;
	}
	.hole {
		position: absolute;
		inset: calc(var(--pad) * -1);
		z-index: 2;
		padding: 0;
		border: 0;
		border-radius: var(--r);
		background: transparent;
		box-shadow: 0 0 0 100vmax var(--highlight-dim);
		clip-path: none;
		cursor: pointer;
	}
	.message {
		position: absolute;
		z-index: 3;
		left: 0;
		right: 0;
		margin: 0;
		padding: 0 var(--pad);
		color: var(--static-white);
		font-size: var(--text-t6);
		line-height: var(--text-t6--line-height);
		font-weight: 700;
		pointer-events: none;
	}
	.message[data-y="bottom"] {
		top: calc(100% + var(--pad) + 12px);
	}
	.message[data-y="top"] {
		bottom: calc(100% + var(--pad) + 12px);
	}
	.message[data-x="center"] {
		text-align: center;
	}
	.message[data-x="right"] {
		text-align: right;
	}
</style>
