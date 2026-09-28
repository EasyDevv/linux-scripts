<!-- TDS IconButton (components/icon-button).
     48x48 hit box = 12px padding around a 24px icon (iconSize), radius 12.
     variant clear  transparent, greyOpacity100 while pressed
             fill   greyOpacity100 (bgColor), clears while pressed
             border 0.8px greyOpacity100 rule (box becomes 49.6px)
     aria-label is required: an icon alone does not name the action. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";

	let {
		label,
		variant = "clear",
		iconSize = 24,
		children,
		...rest
	}: {
		label: string;
		variant?: "clear" | "fill" | "border";
		iconSize?: number;
		children: Snippet;
	} & HTMLButtonAttributes = $props();
</script>

<button
	{...rest}
	type="button"
	class="tds-icon-button"
	data-tds-mobile-component="IconButton"
	data-variant={variant}
	aria-label={label}
	style:--icon={`${iconSize}px`}
>
	{@render children()}
</button>

<style>
	.tds-icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		box-sizing: content-box;
		width: var(--icon);
		height: var(--icon);
		padding: 12px;
		border: 0;
		border-radius: var(--icon-button-radius);
		background: transparent;
		color: var(--ink-soft);
		cursor: pointer;
		transition: background-color 0.1s;
	}
	.tds-icon-button :global(svg),
	.tds-icon-button :global(img) {
		width: var(--icon);
		height: var(--icon);
	}
	.tds-icon-button:active {
		background: var(--grey-opacity-100);
	}
	.tds-icon-button[data-variant="fill"] {
		background: var(--grey-opacity-100);
	}
	.tds-icon-button[data-variant="fill"]:active {
		background: transparent;
	}
	.tds-icon-button[data-variant="border"] {
		border: var(--hairline-width) solid var(--grey-opacity-100);
	}
</style>
