<!-- TDS Skeleton (components/skeleton). role=img, aria-live polite. Column, padding 24px 24px 0.
     pieces (grey100 on grey/white; greyOpacity100 when background="greyOpacity100"):
       title        126x30 r11, 12 below        subtitle   83x22 r9, 12 below
       spacer(n)    n px (24 in the docs)        card       full x 64 r18, 16 below
       list         full x 42 r13, 32 below      listWithIcon  40 circle + 14 gap + 42h r13 bar, 32 below
     pattern topList = title, subtitle, spacer(24), card x3 · topListWithIcon swaps cards for listWithIcon.
     Pieces pulse (opacity .3 -> 1, scale .96 -> 1) with a stagger; play="hide" freezes them. -->
<script lang="ts">
	type Piece = "title" | "subtitle" | "card" | "list" | "listWithIcon" | `spacer(${number})`;

	let {
		pattern = "topList",
		custom,
		repeatLastItemCount = 3,
		background = "grey",
		height,
	}: {
		pattern?: "topList" | "topListWithIcon" | "cardOnly" | "listOnly";
		custom?: Piece[];
		repeatLastItemCount?: number;
		background?: "white" | "grey" | "greyOpacity100";
		height?: number | string;
	} = $props();

	const PATTERNS: Record<string, Piece[]> = {
		topList: ["title", "subtitle", "spacer(24)", "card"],
		topListWithIcon: ["title", "subtitle", "spacer(24)", "listWithIcon"],
		cardOnly: ["card"],
		listOnly: ["list"],
	};
	const pieces = $derived.by(() => {
		const base = custom ?? PATTERNS[pattern];
		const last = base[base.length - 1];
		return [...base, ...Array(Math.max(0, repeatLastItemCount - 1)).fill(last)] as Piece[];
	});
</script>

<div class="tds-skeleton" data-tds-mobile-component="Skeleton" data-bg={background} role="img" aria-label="불러오는 중" aria-live="polite" style:height>
	{#each pieces as piece, i (i)}
		{#if piece.startsWith("spacer")}
			<div style:min-height={`${piece.match(/\d+/)?.[0] ?? 24}px`}></div>
		{:else}
			<div class="piece" data-piece={piece} style:animation-delay={`${i * 0.1}s`}>
				{#if piece === "listWithIcon"}
					<span class="dot"></span><span class="bar"></span>
				{:else}
					<span class="bar"></span>
				{/if}
			</div>
		{/if}
	{/each}
</div>

<style>
	.tds-skeleton {
		--fill: var(--skeleton-fill);
		display: flex;
		flex-direction: column;
		justify-content: flex-start;
		padding: 24px var(--row-inset) 0;
		overflow: hidden;
	}
	.tds-skeleton[data-bg="greyOpacity100"] {
		--fill: var(--grey-opacity-100);
	}
	.piece {
		display: flex;
		align-items: center;
		animation: tds-skeleton 1.6s ease-in-out infinite;
	}
	.bar,
	.dot {
		display: block;
		background: var(--fill);
	}
	[data-piece="title"] .bar {
		width: 126px;
		height: 30px;
		margin-bottom: 12px;
		border-radius: 11px;
	}
	[data-piece="subtitle"] .bar {
		width: 83px;
		height: 22px;
		margin-bottom: 12px;
		border-radius: 9px;
	}
	[data-piece="card"] .bar {
		width: 100%;
		height: 64px;
		margin-bottom: 16px;
		border-radius: 18px;
	}
	[data-piece="list"] .bar {
		width: 100%;
		height: 42px;
		margin-bottom: 32px;
		border-radius: 13px;
	}
	[data-piece="listWithIcon"] {
		margin-bottom: 32px;
	}
	[data-piece="listWithIcon"] .dot {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		margin-right: 14px;
		border-radius: 50%;
	}
	[data-piece="listWithIcon"] .bar {
		flex: 1;
		height: 42px;
		border-radius: 13px;
	}
	@keyframes tds-skeleton {
		0%,
		100% {
			opacity: 1;
			scale: 1;
		}
		50% {
			opacity: 0.3;
			scale: 0.96;
		}
	}
</style>
