<!-- TDS TextButton (components/text-button).
     size      xsmall 13 · small 15 · medium 17 · large 20 · xlarge 22 · xxlarge 28, leading x1.252
     weight    500 up to medium, 600 at large, 700 at xlarge+ ; ink grey600 by default
     press     a dimmer layer outside the text: inset -3/-7 (13,15) · -4/-9 (17) · -5/-11 (20,22) · -7/-13 (28),
               radius 7 / 9 / 11 / 13, greyOpacity100 fill while pressed
     variant   clear · arrow (chevron after the label) · underline -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";

	type Size = "xsmall" | "small" | "medium" | "large" | "xlarge" | "xxlarge";

	let {
		size = "medium",
		variant = "clear",
		tone = "subtle",
		children,
		...rest
	}: {
		size?: Size;
		variant?: "clear" | "arrow" | "underline";
		tone?: "subtle" | "soft" | "link";
		children: Snippet;
	} & HTMLButtonAttributes = $props();
</script>

<button {...rest} type="button" class="tds-text-button" data-tds-mobile-component="TextButton" data-size={size} data-variant={variant} data-tone={tone}>
	<span class="dimmer" aria-hidden="true"></span>
	<span class="text">{@render children()}</span>
	{#if variant === "arrow"}
		<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5.5 15.5 12 9 18.5" /></svg>
	{/if}
</button>

<style>
	.tds-text-button {
		--fs: var(--text-control);
		--in-y: -4px;
		--in-x: -9px;
		--dr: 9px;
		position: relative;
		isolation: isolate;
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 0;
		border: 0;
		border-radius: var(--control-radius-sm);
		background: transparent;
		color: var(--ink-subtle);
		font: inherit;
		font-size: var(--fs);
		font-weight: 500;
		line-height: var(--control-label-leading);
		cursor: pointer;
	}
	.tds-text-button[data-tone="soft"] {
		color: var(--ink-soft);
	}
	.tds-text-button[data-tone="link"] {
		color: var(--ink-link);
	}
	.tds-text-button[data-size="xsmall"] {
		--fs: var(--text-control-sm);
		--in-y: -3px;
		--in-x: -7px;
		--dr: 7px;
	}
	.tds-text-button[data-size="small"] {
		--fs: var(--text-control-md);
		--in-y: -3px;
		--in-x: -7px;
		--dr: 7px;
	}
	.tds-text-button[data-size="large"] {
		--fs: var(--text-control-lg);
		--in-y: -5px;
		--in-x: -11px;
		--dr: 11px;
		font-weight: 600;
	}
	.tds-text-button[data-size="xlarge"] {
		--fs: var(--text-control-xl);
		--in-y: -5px;
		--in-x: -11px;
		--dr: 11px;
		font-weight: 700;
	}
	.tds-text-button[data-size="xxlarge"] {
		--fs: var(--text-control-2xl);
		--in-y: -7px;
		--in-x: -13px;
		--dr: 13px;
		font-weight: 700;
	}
	.dimmer {
		position: absolute;
		inset: var(--in-y) var(--in-x);
		z-index: -1;
		border-radius: var(--dr);
		background: transparent;
		transition: background-color 0.1s;
	}
	.tds-text-button:active .dimmer {
		background: var(--grey-opacity-100);
	}
	.tds-text-button[data-variant="underline"] .text {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.arrow {
		width: 1em;
		height: 1em;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0.7;
	}
</style>
