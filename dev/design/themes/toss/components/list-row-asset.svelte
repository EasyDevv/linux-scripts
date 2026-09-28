<!-- TDS ListRow.AssetIcon / AssetImage / AssetText — the 'left' slot of ListRow.
     size   xsmall 24 · small 32 · medium 40 (Asset frame box)
     shape  squircle (r ~ 30% of box) · circle · card (r 6, wider) · original (no frame)
     frame  greyOpacity100 when variant=fill (default for text assets), transparent otherwise
     text   asset text is 13/19.5/600 in blue500 on the frame
     The measured ListRow overview uses a 30px icon (Stepper number / Asset CleanW30). -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		size = "medium",
		shape = "squircle",
		variant = "fill",
		src,
		alt = "",
		text,
		children,
	}: {
		size?: "xsmall" | "small" | "medium";
		shape?: "squircle" | "circle" | "card" | "original";
		variant?: "fill" | "none";
		src?: string;
		alt?: string;
		text?: string;
		children?: Snippet;
	} = $props();
</script>

<span class="tds-asset" data-tds-mobile-component="ListRow.Asset" data-size={size} data-shape={shape} data-variant={variant}>
	{#if src}
		<img {src} {alt} />
	{:else if text}
		<span class="text">{text}</span>
	{:else if children}
		{@render children()}
	{/if}
</span>

<style>
	.tds-asset {
		--box: 40px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: var(--box);
		height: var(--box);
		border-radius: calc(var(--box) * 0.3);
		overflow: hidden;
		color: var(--ink-soft);
	}
	.tds-asset[data-size="small"] {
		--box: 32px;
	}
	.tds-asset[data-size="xsmall"] {
		--box: 24px;
	}
	.tds-asset[data-variant="fill"] {
		background: var(--grey-opacity-100);
	}
	.tds-asset[data-shape="circle"] {
		border-radius: 50%;
	}
	.tds-asset[data-shape="card"] {
		width: calc(var(--box) * 1.5);
		border-radius: 6px;
	}
	.tds-asset[data-shape="original"] {
		border-radius: 0;
		background: none;
	}
	img {
		width: 60%;
		height: 60%;
		object-fit: contain;
	}
	[data-shape="original"] img {
		width: 100%;
		height: 100%;
	}
	.tds-asset :global(svg) {
		width: 55%;
		height: 55%;
	}
	.text {
		color: var(--status-info);
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		font-weight: 600;
	}
</style>
