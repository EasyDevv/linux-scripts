<!-- TDS BottomCTA.Single / BottomCTA.Double / FixedBottomCTA (components/BottomCTA).
     A 36px fade (to top: base surface at 25% -> transparent) sits above the bar;
     bar padding 0 20px 20px on the base surface (background "none" drops fill and fade).
     Single = one xlarge (56h r16) block Button. Double = leftButton + rightButton in a row, gap 8,
     each 56h r16 (left usually weak dark, right fill primary).
     topAccessory / bottomAccessory: 15/22.5 grey600 text, 26px under / 24px over the buttons.
     fixed pins the whole block to the bottom of the viewport (FixedBottomCTA). -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		fixed = false,
		background = "default",
		topAccessory,
		bottomAccessory,
		children,
	}: {
		fixed?: boolean;
		background?: "default" | "none";
		topAccessory?: Snippet;
		bottomAccessory?: Snippet;
		children: Snippet;
	} = $props();
</script>

<div class="tds-bottom-cta" data-tds-mobile-component="BottomCTA" data-fixed={fixed} data-bg={background}>
	<div class="fade" aria-hidden="true"></div>
	<div class="bar">
		{#if topAccessory}<div class="top">{@render topAccessory()}</div>{/if}
		<div class="buttons">{@render children()}</div>
		{#if bottomAccessory}<div class="bottom">{@render bottomAccessory()}</div>{/if}
	</div>
</div>

<style>
	.tds-bottom-cta[data-fixed="true"] {
		position: fixed;
		inset: auto 0 0;
		z-index: 100;
	}
	.fade {
		height: 36px;
		background: linear-gradient(to top, var(--surface-base) 25%, transparent);
		pointer-events: none;
	}
	.bar {
		padding: 0 var(--cta-inset) var(--cta-inset);
		background: var(--surface-base);
	}
	[data-bg="none"] .fade {
		display: none;
	}
	[data-bg="none"] .bar {
		background: none;
	}
	.buttons {
		display: flex;
		gap: 8px;
	}
	.buttons > :global(*) {
		flex: 1 1 0;
		min-width: 0;
	}
	.top,
	.bottom {
		color: var(--ink-subtle);
		font-size: var(--text-t6);
		line-height: var(--text-t6--line-height);
		text-align: center;
	}
	.top {
		padding-bottom: 26px;
	}
	.bottom {
		padding-top: 24px;
	}
</style>
