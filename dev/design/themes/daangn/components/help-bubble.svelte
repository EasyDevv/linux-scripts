<!-- SEED HelpBubble (seed-design.io/react/components/help-bubble): an inverted r8 bubble with a 12x8
     arrow tip, title t3 bold (+ description), optional close. `open` + `side` place it relative to the
     anchor wrapped in this component (top / bottom / left / right, centred). Tooltip mode opens on
     hover / focus of the anchor. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		open = $bindable(false),
		side = "top",
		title,
		description,
		closeButton = false,
		tooltip = false,
		children,
	}: {
		open?: boolean;
		side?: "top" | "bottom" | "left" | "right";
		title: string;
		description?: string;
		closeButton?: boolean;
		/** open on hover / focus instead of click */
		tooltip?: boolean;
		children: Snippet;
	} = $props();

	const s = $derived({ "data-side": side, ...(open ? { "data-open": "", "data-positioned": "" } : { "data-hidden": "" }) });
	const pos = $derived(
		{
			top: "bottom: 100%; left: 50%; translate: -50% 0; padding-bottom: 8px",
			bottom: "top: 100%; left: 50%; translate: -50% 0; padding-top: 8px",
			left: "right: 100%; top: 50%; translate: 0 -50%; padding-right: 8px",
			right: "left: 100%; top: 50%; translate: 0 -50%; padding-left: 8px",
		}[side],
	);
	const arrow = $derived(
		{
			top: "top: 100%; left: 50%; translate: -50% 0",
			bottom: "bottom: 100%; left: 50%; translate: -50% 0; rotate: 180deg",
			left: "left: 100%; top: 50%; translate: 0 -50%; rotate: -90deg",
			right: "right: 100%; top: 50%; translate: 0 -50%; rotate: 90deg",
		}[side],
	);
</script>

<span
	style="position: relative; display: inline-flex"
	role="presentation"
	onclick={() => !tooltip && (open = !open)}
	onmouseenter={() => tooltip && (open = true)}
	onmouseleave={() => tooltip && (open = false)}
	onfocusin={() => tooltip && (open = true)}
	onfocusout={() => tooltip && (open = false)}
>
	{@render children()}
	{#if open}
		<div class="seed-help-bubble__positioner" role={tooltip ? "tooltip" : "dialog"} {...s} style="position: absolute; z-index: 10; {pos}" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} tabindex="-1">
			<div class="seed-help-bubble__content" {...s}>
				<div class="seed-help-bubble__arrow" {...s} style="position: absolute; {arrow}">
					<svg class="seed-help-bubble__arrowTip" aria-hidden="true" viewBox="0 0 12 8"><path stroke="none" d="M0,0 H12 L8,6 Q6,8 4,6 Z" /></svg>
				</div>
				<div class="seed-help-bubble__body" {...s}>
					<span class="seed-help-bubble__title" {...s}>{title}</span>
					{#if description}<span class="seed-help-bubble__description" {...s}>{description}</span>{/if}
				</div>
				{#if closeButton}
					<button type="button" class="seed-help-bubble__closeButton" {...s} aria-label="닫기" onclick={() => (open = false)}>
						<svg class="seed-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
					</button>
				{/if}
			</div>
		</div>
	{/if}
</span>

<style>
	/* @recipe help-bubble */
	/* SEED recipe: help-bubble */
	:global(.seed-help-bubble__positioner) {
		--popover-z-index: 99;
		z-index: calc(var(--popover-z-index) + var(--z-index-offset, 0));
		max-width: var(--seed-popover-available-width, none);
	}
	:global(.seed-help-bubble__content) {
		display: flex;
		align-items: flex-start;
		box-sizing: border-box;
		background: var(--bg-neutral-inverted);
		padding-inline: var(--dimension-x3);
		padding-block: var(--dimension-x2-5);
		border-radius: var(--radius-r3);
		--seed-box-max-width-base: 280px;
		--seed-box-max-width-sm: var(--seed-box-max-width-base, initial);
		--seed-box-max-width-md: var(--seed-box-max-width-sm, initial);
		--seed-box-max-width-lg: var(--seed-box-max-width-md, initial);
		--seed-box-max-width-xl: var(--seed-box-max-width-lg, initial);
		--seed-box-max-width: var(--seed-box-max-width-base, initial);
		max-width: var(--seed-box-max-width);
	}
	:global(.seed-help-bubble__content:is([data-state="open"], [data-open])) {
		animation: seed-enter;
		animation-timing-function: var(--ease-enter);
		animation-duration: var(--duration-d4);
		--seed-enter-translate-x: 0;
		--seed-enter-translate-y: 0;
		--seed-enter-opacity: 0;
		--seed-enter-scale: 0.9;
	}
	:global(.seed-help-bubble__content:not(:is([data-state="open"], [data-open]))) {
		animation: seed-exit;
		animation-timing-function: var(--ease-easing);
		animation-duration: var(--duration-d4);
		animation-fill-mode: forwards;
		--seed-exit-translate-x: 0;
		--seed-exit-translate-y: 0;
		--seed-exit-opacity: 0;
		--seed-exit-scale: 1;
	}
	:global(.seed-help-bubble__content[data-instant]) {
		animation-duration: 0s;
	}
	:global(.seed-help-bubble__content:is([hidden], [data-hidden])) {
		display: none !important;
	}
	:global(.seed-help-bubble__arrow) {
		width: 12px;
		height: 12px;
	}
	:global(.seed-help-bubble__arrowTip) {
		display: block;
		fill: var(--bg-neutral-inverted);
		width: 12px;
		height: 8px;
	}
	:global(.seed-help-bubble__body) {
		display: flex;
		flex-direction: column;
		gap: var(--dimension-x0-5);
		word-break: keep-all;
		overflow-wrap: break-word;
		min-width: 0;
	}
	:global(.seed-help-bubble__title) {
		color: var(--fg-neutral-inverted);
		font-size: var(--text-t3);
		font-weight: var(--font-weight-bold);
		line-height: var(--text-t3--line-height);
		white-space: pre-wrap;
	}
	:global(.seed-help-bubble__description) {
		color: var(--fg-neutral-inverted);
		font-size: var(--text-t3);
		font-weight: var(--font-weight-regular);
		line-height: var(--text-t3--line-height);
		white-space: pre-wrap;
	}
	:global(.seed-help-bubble__closeButton) {
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: transparent;
		cursor: pointer;
		padding: calc((38px - var(--dimension-x3-5)) / 2);
		margin-left: calc(var(--dimension-x1) - ((38px - var(--dimension-x3-5)) / 2));
		margin-right: calc(-1 * ((38px - var(--dimension-x3-5)) / 2));
		margin-block: calc(-1 * ((38px - var(--dimension-x3-5)) / 2) + var(--dimension-x0-5));
		color: var(--fg-neutral-inverted);
		--seed-icon-size: var(--dimension-x3-5);
		--seed-icon-color: var(--fg-neutral-inverted);
		border-radius: var(--radius-r3);
	}
	:global(.seed-help-bubble__closeButton:is(:active, [data-active])) {
		scale: var(--feedback-scale);
	}
	:global(.seed-help-bubble__closeButton) {
		transition: scale var(--duration-pressed-scale) var(--ease-pressed-scale), outline-color var(--duration-d3) var(--ease-easing);
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: calc(var(--dimension-x0-5) * -1);
	}
	:global(.seed-help-bubble__closeButton:is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: calc(var(--dimension-x0-5) * -1);
	}
	@media (min-width: 480px) {
		:global(.seed-help-bubble__content) {
			--seed-box-max-width: var(--seed-box-max-width-sm, initial);
		}
	}
	@media (min-width: 768px) {
		:global(.seed-help-bubble__content) {
			--seed-box-max-width: var(--seed-box-max-width-md, initial);
		}
	}
	@media (min-width: 1280px) {
		:global(.seed-help-bubble__content) {
			--seed-box-max-width: var(--seed-box-max-width-lg, initial);
		}
	}
	@media (min-width: 1440px) {
		:global(.seed-help-bubble__content) {
			--seed-box-max-width: var(--seed-box-max-width-xl, initial);
		}
	}
	/* @end recipe */
</style>
