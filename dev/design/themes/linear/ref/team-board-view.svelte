<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import Plus from "@lucide/svelte/icons/plus";
	import { boardMark } from "./chrome.ts";
	import { boardColumns, hiddenColumns } from "./data.ts";
	import StatusGlyph from "./status-glyph.svelte";
	import TeamBoardCard from "./team-board-card.svelte";

	const headLabelStyle = `font-size: var(--text-heading-sm); line-height: 16px; font-weight: 500; color: var(--ink-soft)`;
	const headCountStyle = `font-size: var(--text-heading-sm); line-height: 16px; font-weight: 450; color: var(--muted-foreground)`;
	const headRowStyle = `display: flex; align-items: center; width: ${boardMark.headRowWidth}px; height: ${boardMark.headHeight}px; gap: ${boardMark.headGap}px`;
</script>

<!-- Measured board: the panel scroller scrolls horizontally (native 15px scrollbar) over
     4px + 5 columns of 348px + the 350px "Hidden columns" rail = 2098px. -->
<div class="board-scroll" data-role="board">
	<div
		class="board-content"
		style="width: {boardMark.rowPadLeft * 2 + boardColumns.length * boardMark.columnWidth}px"
	>
		<div class="shades" aria-hidden="true">
			{#each boardColumns as column, index (column.id)}
				<span
					class="shade"
					style="left: {index * boardMark.columnWidth + boardMark.bandInset}px; width: {boardMark
						.columnWidth -
						boardMark.bandInset * 2}px; top: {boardMark.bandInset}px; border-radius: {boardMark
						.bandRadius}"
				></span>
			{/each}
		</div>

		<div
			class="board-head-row flex"
			style="height: {boardMark.headHeight}px; padding-left: {boardMark.rowPadLeft}px"
		>
			{#each boardColumns as column (column.id)}
				<div class="relative" style="width: {boardMark.columnWidth}px; padding: {boardMark.headPad}">
					<div style={headRowStyle}>
						<div class="flex min-w-0 items-center" style="gap: {boardMark.headIconGap}px">
							<span
								class="shrink-0"
								style="display: block; width: {boardMark.chipIcon}px; height: {boardMark
									.chipIcon}px; margin-right: 2px"
							>
								<StatusGlyph tone={column.tone} />
							</span>
							<span style={headLabelStyle}>{column.label}</span>
							<span style={headCountStyle}>{column.count}</span>
						</div>
						<div class="ml-auto flex shrink-0 items-center" style="gap: {boardMark.headButtonGap}px">
							<button
								type="button"
								class="grid shrink-0 place-items-center rounded-full text-muted-foreground"
								style="width: {boardMark.headButton}px; height: {boardMark.headButton}px"
								aria-label="{column.label} column options"
							>
								<Ellipsis class="size-4" strokeWidth={2} />
							</button>
							<button
								type="button"
								class="grid shrink-0 place-items-center rounded-full text-muted-foreground"
								style="width: {boardMark.headButton}px; height: {boardMark.headButton}px"
								aria-label="Add issue to {column.label}"
							>
								<Plus class="size-3.5" strokeWidth={1.75} />
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<div
			class="board-cols flex"
			style="height: {boardMark.bodyHeight +
				boardMark.rowPadLeft * 2}px; padding: {boardMark.rowPadLeft * 2}px 0 0 {boardMark.rowPadLeft}px"
		>
			{#each boardColumns as column (column.id)}
				<div class="shrink-0" style="width: {boardMark.columnWidth}px">
					<div
						class="col-body"
						data-hover={column.id === "todo" ? "true" : undefined}
						style="height: {boardMark.bodyHeight}px; padding: {boardMark.bodyPad}"
					>
						{#each column.cards as card (card.id)}
							<div style="padding: {boardMark.cardItemPad}">
								<TeamBoardCard {card} />
							</div>
						{/each}
						<!-- Column-hover affordance: visible in the capture under the Todo cards. -->
						<div class="add-item" style="padding: {boardMark.cardItemPad}">
							<button
								type="button"
								class="flex w-full items-center justify-center rounded-[var(--radius-pill)]"
								style="height: {boardMark.addHeight}px; padding: {boardMark.addPad}; background: {boardMark.addFill}; border: {boardMark.addBorder}"
								aria-label="Add new issue"
							>
								<Plus class="size-4 text-muted-foreground" strokeWidth={1.75} />
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<div class="shrink-0" style="width: {boardMark.hiddenWidth}px; padding: {boardMark.hiddenPad}">
		<div class="flex items-center" style="height: {boardMark.headHeight}px">
			<button
				type="button"
				class="flex items-center rounded-full text-[color:var(--ink-soft)]"
				style="height: 24px; padding: 0 8px 0 6px; gap: 4px; font-size: var(--text-body-sm); font-weight: 500"
				aria-label="Hidden columns"
			>
				<ChevronDown class="size-3.5" strokeWidth={2} />
				Hidden columns
			</button>
		</div>
		<div class="flex flex-col">
			{#each hiddenColumns as column (column.label)}
				<div
					class="flex items-center"
					style="height: {boardMark.hiddenRowHeight}px; padding: 0 8px; gap: {boardMark.headIconGap}px; border-radius: var(--radius-sm); background: var(--list-row-fill)"
				>
					<span
						class="shrink-0"
						style="display: block; width: {boardMark.chipIcon}px; height: {boardMark.chipIcon}px"
					>
						<StatusGlyph tone={column.tone} />
					</span>
					<span style="font-size: var(--text-heading-sm); font-weight: 450; color: var(--ink-soft)"
						>{column.label}</span
					>
					<span class="ml-auto" style={headCountStyle}>{column.count}</span>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	/* The board's own scroller: the capture shows the native dark scrollbar at the panel's
	   bottom edge, so the columns row must not scroll vertically. */
	.board-scroll {
		/* The live board scroller is composited, so Blink drops LCD subpixel AA inside it —
		   the captures show grayscale glyph edges. */
		transform: translateZ(0);
		display: flex;
		height: 100%;
		overflow-x: auto;
		overflow-y: hidden;
		/* live: scrollbar-color: lch(37.275 1.2 272) transparent */
		scrollbar-color: rgb(87, 88, 90) transparent;
	}

	.board-content {
		position: relative;
		flex-shrink: 0;
	}

	/* Measured column shade: a 340px-wide (4px inset) shape starting at the header row's 4px mark,
	   fading from rgb(10 10 10 / 40%) over the full 748px column height. */
	.shades {
		position: absolute;
		inset: 0 0 auto 0;
		/* 50px header row + 694px column body + 4px = the measured 748px shade */
		height: 748px;
	}

	.shade {
		position: absolute;
		bottom: 0;
		background-image: linear-gradient(to bottom, var(--board-band), transparent);
	}

	.board-head-row,
	.board-cols {
		position: relative;
		z-index: 1;
	}

	.col-body {
		position: relative;
		/* The 15px right gutter is reserved like the live app (scrollbar-gutter: stable). */
		overflow-y: auto;
		scrollbar-gutter: stable;
	}

	/* Hovering a column reveals its add-issue pill; the Todo column keeps it painted to match
	   the capture (the live cursor sat inside it). */
	.add-item {
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.col-body:hover .add-item,
	.col-body[data-hover="true"] .add-item {
		opacity: 1;
	}
</style>
