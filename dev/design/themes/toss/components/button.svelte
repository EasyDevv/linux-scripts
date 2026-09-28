<!-- TDS Button (tossmini-docs components/button, 390px).
     size    small 32 / medium 38 / large 48 / xlarge 56 high, r 8/10/14/16, padding-inline 10/16/16/28
     label   13/15/17/17 at fontSize x 1.252 (--control-label-leading), weight 600
     color   primary blue500 · dark grey700 · danger red500 · light white/blue700 (on a fill)
     variant fill = solid + white ink; weak = 15% hue (greyOpacity100 for dark) + 600/700 ink
     states  disabled opacity .3; loading = aria-busy, label hidden, three 8px dots gap 7
     The fill is a child layer (TDS paints a div under the label), radius stays on the button. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";

	type Size = "small" | "medium" | "large" | "xlarge";
	type Color = "primary" | "dark" | "danger" | "light";
	type Variant = "fill" | "weak";

	let {
		size = "xlarge",
		color = "primary",
		variant = "fill",
		display = "inline",
		loading = false,
		disabled = false,
		type = "button",
		children,
		...rest
	}: {
		size?: Size;
		color?: Color;
		variant?: Variant;
		/** inline hugs the label; block/full stretch to the container */
		display?: "inline" | "block" | "full";
		loading?: boolean;
		disabled?: boolean;
		children: Snippet;
	} & Omit<HTMLButtonAttributes, "color"> = $props();
</script>

<button
	{...rest}
	{type}
	class="tds-button"
	data-tds-mobile-component="Button"
	data-size={size}
	data-color={color}
	data-variant={variant}
	data-display={display}
	disabled={disabled || loading}
	aria-busy={loading}
	aria-live={loading ? "polite" : "off"}
>
	<span class="fill" aria-hidden="true"></span>
	<span class="label" class:hidden={loading}>{@render children()}</span>
	{#if loading}
		<span class="dots" role="status" aria-label="loading"><i></i><i></i><i></i></span>
	{/if}
</button>

<style>
	.tds-button {
		--h: var(--control-height-xl);
		--r: var(--control-radius-xl);
		--px: var(--control-padding-inline-xl);
		--fs: var(--text-control);
		--bg: var(--blue-500);
		--fg: var(--ink-on-fill);
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--h);
		height: var(--h);
		padding: 0;
		border: 0;
		border-radius: var(--r);
		overflow: hidden;
		background: transparent;
		color: var(--fg);
		font: inherit;
		font-size: var(--fs);
		font-weight: 600;
		line-height: var(--control-label-leading);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	.tds-button[data-display="block"],
	.tds-button[data-display="full"] {
		display: flex;
		width: 100%;
	}
	.tds-button[data-display="full"] {
		border-radius: 0;
	}
	.tds-button[data-size="small"] {
		--h: var(--control-height-sm);
		--r: var(--control-radius-sm);
		--px: var(--control-padding-inline-sm);
		--fs: var(--text-control-sm);
	}
	.tds-button[data-size="medium"] {
		--h: var(--control-height);
		--r: var(--control-radius);
		--px: var(--control-padding-inline);
		--fs: var(--text-control-md);
	}
	.tds-button[data-size="large"] {
		--h: var(--control-height-lg);
		--r: var(--control-radius-lg);
		--px: var(--control-padding-inline);
	}

	.tds-button[data-color="dark"] {
		--bg: var(--grey-700);
		/* grey700 turns light in dark mode; the label follows the screen surface to stay legible */
		--fg: var(--surface-base);
	}
	.tds-button[data-color="danger"] {
		--bg: var(--red-500);
	}
	.tds-button[data-color="light"] {
		--bg: var(--static-white);
		--fg: var(--blue-700);
	}
	.tds-button[data-variant="weak"] {
		--bg: var(--weak-info);
		--fg: var(--blue-600);
	}
	.tds-button[data-variant="weak"][data-color="dark"] {
		--bg: var(--grey-opacity-100);
		--fg: var(--grey-700);
	}
	.tds-button[data-variant="weak"][data-color="danger"] {
		--bg: var(--weak-danger);
		--fg: var(--red-600);
	}
	.tds-button[data-variant="weak"][data-color="light"] {
		--bg: var(--on-fill-weak);
		--fg: var(--static-white);
	}

	.fill {
		position: absolute;
		inset: 0;
		background: var(--bg);
		transition: filter 0.1s;
	}
	.tds-button:active:not(:disabled) .fill {
		filter: brightness(0.92);
	}
	.label {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: var(--h);
		padding-inline: var(--px);
		white-space: nowrap;
	}
	.label.hidden {
		opacity: 0;
	}
	.tds-button:disabled {
		cursor: default;
	}
	.tds-button:disabled:not([aria-busy="true"]) {
		opacity: var(--control-disabled-opacity);
	}
	.dots {
		position: absolute;
		inset: 50% auto auto 50%;
		display: flex;
		gap: 7px;
		translate: -50% -50%;
	}
	.dots i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
		animation: tds-dot 0.9s infinite ease-in-out;
	}
	.dots i:nth-child(2) {
		animation-delay: 0.15s;
	}
	.dots i:nth-child(3) {
		animation-delay: 0.3s;
	}
	@keyframes tds-dot {
		0%,
		100% {
			opacity: 0.2;
			scale: 0.8;
		}
		50% {
			opacity: 1;
			scale: 1;
		}
	}
</style>
