<!-- TDS NumericSpinner (components/numeric-spinner). Measured per size:
             outer          buttons (pad-inline, icon)   value box (pad, margin-inline, r)   type
     tiny    87x32 r8  pad 3   20x26 (8, 12)           35x26 (3 5, 6, r6)                  13/19.5/600
     small  105x39 r10 pad 3   24x33 (12, 12)          41x33 (5 6, 8, r8)                  15/22.5/600
     medium 125x50 r14 pad 4   28x42 (12, 16)          49x42 (8, 10, r10)                  17/25.5/600
     large  153x58 r16 pad 4   32x50 (16, 16)          61x50 (12 14, 14, r14)              17/25.5/600
     Track grey100, value box white + 0 1px 3px rgba(0,0,0,.09); the value box is as wide as "000".
     Minus / plus ink grey700, grey300 at the bound. Pressing a half shows a greyOpacity100 layer.
     disabled = opacity .3. -->
<script lang="ts">
	let {
		number = $bindable(0),
		minNumber = 0,
		maxNumber = 999,
		size = "large",
		disable = false,
	}: {
		number?: number;
		minNumber?: number;
		maxNumber?: number;
		size?: "tiny" | "small" | "medium" | "large";
		disable?: boolean;
	} = $props();

	const atMin = $derived(number <= minNumber);
	const atMax = $derived(number >= maxNumber);
</script>

<div class="tds-spinner" data-tds-mobile-component="NumericSpinner" data-size={size} aria-disabled={disable}>
	<button type="button" aria-label="빼기" disabled={disable || atMin} onclick={() => (number = Math.max(minNumber, number - 1))}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
	</button>
	<span class="value" role="text" aria-live="polite">{number}</span>
	<button type="button" aria-label="더하기" disabled={disable || atMax} onclick={() => (number = Math.min(maxNumber, number + 1))}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
	</button>
</div>

<style>
	.tds-spinner {
		--r: 16px;
		--pad: 4px;
		--btn-pad: 16px;
		--icon: 16px;
		--box-pad: 12px 14px;
		--box-gap: 14px;
		--box-r: 14px;
		--fs: var(--text-t5);
		--lh: var(--text-t5--line-height);
		display: inline-flex;
		align-items: center;
		padding: var(--pad) 0;
		border-radius: var(--r);
		background: var(--grey-100);
	}
	.tds-spinner[data-size="medium"] {
		--r: 14px;
		--btn-pad: 12px;
		--box-pad: 8px;
		--box-gap: 10px;
		--box-r: 10px;
	}
	.tds-spinner[data-size="small"] {
		--r: 10px;
		--pad: 3px;
		--btn-pad: 12px;
		--icon: 12px;
		--box-pad: 5px 6px;
		--box-gap: 8px;
		--box-r: 8px;
		--fs: var(--text-t6);
		--lh: var(--text-t6--line-height);
	}
	.tds-spinner[data-size="tiny"] {
		--r: 8px;
		--pad: 3px;
		--btn-pad: 8px;
		--icon: 12px;
		--box-pad: 3px 5px;
		--box-gap: 6px;
		--box-r: 6px;
		--fs: var(--text-t7);
		--lh: var(--text-t7--line-height);
	}
	.tds-spinner[aria-disabled="true"] {
		opacity: var(--control-disabled-opacity);
	}
	button {
		display: flex;
		align-items: center;
		justify-content: center;
		align-self: stretch;
		padding: 0;
		border: 0;
		background: none;
		color: var(--ink-soft);
		cursor: pointer;
	}
	button:first-child {
		padding-left: var(--btn-pad);
	}
	button:last-child {
		padding-right: var(--btn-pad);
	}
	button:disabled {
		color: var(--grey-300);
		cursor: default;
	}
	svg {
		width: var(--icon);
		height: var(--icon);
		fill: none;
		stroke: currentColor;
		stroke-width: 2.4;
		stroke-linecap: round;
	}
	.value {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: calc(3ch + 4px);
		box-sizing: content-box;
		margin: 0 var(--box-gap);
		padding: var(--box-pad);
		border-radius: var(--box-r);
		background: var(--surface-float);
		box-shadow: var(--shadow-thumb-lg);
		color: var(--ink);
		font-size: var(--fs);
		line-height: var(--lh);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
</style>
