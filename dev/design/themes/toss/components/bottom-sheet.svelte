<!-- TDS BottomSheet (components/bottom-sheet). Measured open at 390x844:
     dim      black 20% (56% dark)
     sheet    floating card, 10px from both sides and the bottom (--sheet-inset), r28, floatBackground
     handle   16px header strip with a 48x4 r5 grey200 grip 12px from the top
     header   optional title t4 20/29/700 grey800 + description t6 15/22.5 grey600, inset 0 24
     body     paragraph 17/25.5 grey700 inset 0 24, or ListRows edge to edge
     cta      Button xlarge block with padding 0 20 20 (BottomSheet.CTA); double = two buttons, gap 8 -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		open = $bindable(false),
		inline = false,
		title,
		description,
		cta,
		children,
	}: {
		open?: boolean;
		inline?: boolean;
		title?: string;
		description?: string;
		cta?: Snippet;
		children?: Snippet;
	} = $props();
</script>

{#if open || inline}
	<div class="tds-bottom-sheet" data-tds-mobile-component="BottomSheet" data-inline={inline}>
		{#if !inline}<button type="button" class="dim" aria-label="닫기" onclick={() => (open = false)}></button>{/if}
		<div class="sheet" role="dialog" aria-modal={!inline} aria-label={title ?? "바텀시트"}>
			<div class="grip" aria-hidden="true"></div>
			{#if title}
				<div class="header">
					<h2 class="title">{title}</h2>
					{#if description}<p class="desc">{description}</p>{/if}
				</div>
			{/if}
			{#if children}<div class="body">{@render children()}</div>{/if}
			{#if cta}<div class="cta">{@render cta()}</div>{/if}
		</div>
	</div>
{/if}

<style>
	.tds-bottom-sheet {
		position: fixed;
		inset: 0;
		z-index: 10000;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}
	.tds-bottom-sheet[data-inline="true"] {
		position: static;
		display: block;
	}
	.dim {
		position: absolute;
		inset: 0;
		padding: 0;
		border: 0;
		background: var(--overlay-dimmed);
	}
	.sheet {
		position: relative;
		display: flex;
		flex-direction: column;
		width: calc(100% - var(--sheet-inset) * 2);
		max-height: calc(100% - 48px);
		margin: 0 var(--sheet-inset) var(--sheet-inset);
		border-radius: var(--sheet-radius);
		overflow: auto;
		background: var(--surface-float);
		animation: tds-sheet-in 0.3s var(--panel-fold-ease);
	}
	/* inline keeps the floating inset (10px sides and bottom), just in flow */
	[data-inline="true"] .sheet {
		width: auto;
		animation: none;
	}
	.grip {
		position: relative;
		flex-shrink: 0;
		height: 16px;
	}
	.grip::after {
		content: "";
		position: absolute;
		top: 12px;
		left: 50%;
		width: var(--sheet-handle);
		height: 4px;
		border-radius: 5px;
		background: var(--grey-200);
		translate: -50% 0;
	}
	.header {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 14px var(--row-inset) 8px;
	}
	.title {
		margin: 0;
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
		font-weight: 700;
		color: var(--ink);
	}
	.desc {
		margin: 0;
		font-size: var(--text-t6);
		line-height: var(--text-t6--line-height);
		color: var(--ink-subtle);
	}
	.body {
		color: var(--ink-soft);
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
	}
	.body > :global(p) {
		margin: 0;
		padding: 0 var(--row-inset);
	}
	.cta {
		display: flex;
		gap: 8px;
		padding: 16px var(--cta-inset) var(--cta-inset);
	}
	.cta > :global(*) {
		flex: 1;
	}
	@keyframes tds-sheet-in {
		from {
			translate: 0 100%;
		}
	}
</style>
