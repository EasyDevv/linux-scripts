<!-- TDS Tooltip (components/tooltip). Measured open at 390x844:
     small   padding 8px 12px, r12, 13/19.5/600, arrow 24x11
     medium  padding 13px 16px, r16, 15/22.5/700, arrow 38 box (51x14 path) — default
     large   padding 16px 20px, r16, 17/25.5/700 (docs demo only; not opened in the capture)
     surface floatBackground, grey800 ink, shadow 0 16px 60px greyOpacity300, max-width = viewport - 96
     placement bottom (default; arrow on top) | top; messageAlign left | center | right;
     anchorPositionByRatio places the arrow along the bubble (0.5 = centred). role=tooltip. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		message,
		open = $bindable(false),
		size = "medium",
		placement = "bottom",
		messageAlign = "left",
		anchorPositionByRatio = 0.5,
		openOnHover = false,
		inline = false,
		children,
	}: {
		message: string;
		open?: boolean;
		size?: "small" | "medium" | "large";
		placement?: "top" | "bottom";
		messageAlign?: "left" | "center" | "right";
		anchorPositionByRatio?: number;
		openOnHover?: boolean;
		inline?: boolean;
		children?: Snippet;
	} = $props();

	const id = `tip-${Math.random().toString(36).slice(2, 8)}`;
</script>

<span
	class="tds-tooltip-anchor"
	data-tds-mobile-component="Tooltip"
	data-inline={inline}
	role="presentation"
	onmouseenter={() => openOnHover && (open = true)}
	onmouseleave={() => openOnHover && (open = false)}
>
	{#if children}
		<span class="trigger" aria-describedby={id} role="button" tabindex="0" onclick={() => (open = !open)} onkeydown={(e) => e.key === "Enter" && (open = !open)}>
			{@render children()}
		</span>
	{/if}
	{#if open || inline}
		<span class="bubble" {id} role="tooltip" data-size={size} data-placement={placement} style:text-align={messageAlign} style:--at={anchorPositionByRatio}>
			{message}
			<svg class="arrow" viewBox="0 0 24 11" aria-hidden="true"><path d="M9.6 1.4a3.4 3.4 0 0 1 4.8 0L24 11H0Z" /></svg>
		</span>
	{/if}
</span>

<style>
	.tds-tooltip-anchor {
		position: relative;
		display: inline-flex;
	}
	.trigger {
		display: inline-flex;
		cursor: pointer;
	}
	.bubble {
		--arrow: 24px;
		position: absolute;
		top: calc(100% + 12px);
		left: 50%;
		z-index: 1000;
		width: max-content;
		max-width: min(294px, calc(100vw - 96px));
		padding: 13px 16px;
		border-radius: var(--tooltip-radius);
		background: var(--surface-float);
		box-shadow: var(--shadow-float-strong);
		color: var(--ink);
		font-size: var(--text-t6);
		line-height: var(--text-t6--line-height);
		font-weight: 700;
		translate: calc(var(--at) * -100%) 0;
	}
	[data-inline="true"] .bubble {
		position: relative;
		top: auto;
		left: auto;
		display: inline-block;
		margin-top: 11px;
		translate: none;
	}
	.bubble[data-size="small"] {
		padding: 8px 12px;
		border-radius: var(--tooltip-radius-sm);
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		font-weight: 600;
	}
	.bubble[data-size="large"] {
		padding: 16px 20px;
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
	}
	.bubble[data-placement="top"] {
		top: auto;
		bottom: calc(100% + 12px);
	}
	[data-inline="true"] .bubble[data-placement="top"] {
		margin: 0 0 11px;
	}
	.arrow {
		position: absolute;
		bottom: calc(100% - 1px);
		left: calc(var(--at) * 100%);
		width: var(--arrow);
		height: 11px;
		fill: var(--surface-float);
		translate: -50% 0;
	}
	[data-size="medium"] .arrow,
	[data-size="large"] .arrow {
		--arrow: 32px;
		height: 14px;
	}
	[data-placement="top"] .arrow {
		top: calc(100% - 1px);
		bottom: auto;
		rotate: 180deg;
	}
</style>
