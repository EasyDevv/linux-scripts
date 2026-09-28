<!-- TDS Toast (components/toast). Measured open at 390x844:
     top      pill (r 100), margin 0 18, padding 12px 16px (12px left with an icon), floatBackground,
              shadow 0 2px 30px greyOpacity200, text 15/22.5/600 greyOpacity800, 24px leftAddon + 8px gap
     bottom   pill, margin 0 20, padding 14px 20px (14 14 14 16 with a button), grey500 fill,
              white 15/22.5/600 text; button = 32h pill, padding 6px 12px, greyOpacity400 fill, gap 20
     position top / bottom (higherThanCTA lifts it above a 76px BottomCTA), aria-live polite,
     duration 3000ms. inline renders in flow (catalogue). -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		open = $bindable(false),
		position = "top",
		text,
		leftAddon,
		buttonText,
		onButtonClick,
		duration = 3000,
		higherThanCTA = false,
		inline = false,
	}: {
		open?: boolean;
		position?: "top" | "bottom";
		text: string;
		leftAddon?: Snippet;
		buttonText?: string;
		onButtonClick?: () => void;
		duration?: number;
		higherThanCTA?: boolean;
		inline?: boolean;
	} = $props();

	$effect(() => {
		if (!open || inline) return;
		const t = setTimeout(() => (open = false), duration);
		return () => clearTimeout(t);
	});
</script>

{#if open || inline}
	<div class="tds-toast" data-tds-mobile-component="Toast" data-position={position} data-inline={inline} data-cta={higherThanCTA} aria-live="polite">
		<div class="pill" data-addon={Boolean(leftAddon)} data-button={Boolean(buttonText)}>
			{#if leftAddon}<span class="addon">{@render leftAddon()}</span>{/if}
			<span class="text" role="text">{text}</span>
			{#if buttonText}<button type="button" class="action" onclick={onButtonClick}>{buttonText}</button>{/if}
		</div>
	</div>
{/if}

<style>
	.tds-toast {
		position: fixed;
		left: 0;
		right: 0;
		z-index: 30000;
		display: flex;
		justify-content: center;
		pointer-events: none;
	}
	.tds-toast[data-position="top"] {
		top: 12px;
	}
	.tds-toast[data-position="bottom"] {
		bottom: 20px;
	}
	.tds-toast[data-position="bottom"][data-cta="true"] {
		bottom: 96px;
	}
	.tds-toast[data-inline="true"] {
		position: static;
	}
	.pill {
		display: flex;
		align-items: center;
		max-width: calc(100% - 36px);
		margin: 0 18px;
		padding: 12px 16px;
		border-radius: 100px;
		background: var(--surface-float);
		box-shadow: var(--shadow-toast);
		pointer-events: auto;
		animation: tds-toast-in 0.25s var(--panel-fold-ease);
	}
	.pill[data-addon="true"] {
		padding-left: 12px;
	}
	[data-position="bottom"] .pill {
		gap: 20px;
		max-width: calc(100% - 40px);
		margin: 0 20px;
		padding: 14px 20px;
		background: var(--grey-500);
		box-shadow: none;
	}
	[data-position="bottom"] .pill[data-button="true"] {
		padding: 14px 14px 14px 16px;
		width: 100%;
		justify-content: space-between;
	}
	.addon {
		display: flex;
		flex-shrink: 0;
		width: 24px;
		height: 24px;
		margin-right: 8px;
	}
	.text {
		color: var(--grey-opacity-800);
		font-size: var(--text-t6);
		line-height: var(--text-t6--line-height);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	[data-position="bottom"] .text {
		color: var(--static-white);
	}
	.action {
		flex-shrink: 0;
		height: 32px;
		padding: 6px 12px;
		border: 0;
		border-radius: 100px;
		background: var(--grey-opacity-400);
		color: var(--static-white);
		font: inherit;
		font-size: var(--text-t6);
		line-height: 20px;
		font-weight: 600;
		cursor: pointer;
	}
	[data-inline="true"] .pill {
		animation: none;
	}
	@keyframes tds-toast-in {
		from {
			opacity: 0;
			translate: 0 -8px;
		}
	}
</style>
