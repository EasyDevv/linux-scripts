<!-- TDS Slider (components/slider).
     40h hit area; track 5h r2.5 grey200 centred (17.5px from top); the fill runs inside a 12px
     side inset so the thumb never overflows. Fill blue400 by default (color = blue500, green500, red500 ...).
     Labels: 13/19.5/500 grey600 under the track, min / mid / max, space-between.
     Tooltip: a small TDS tooltip (13/19.5/600, r12, 8px 12px) above the thumb. -->
<script lang="ts">
	let {
		value = $bindable(50),
		minValue = 0,
		maxValue = 100,
		color = "var(--blue-400)",
		label,
		tooltip,
		ariaLabel = "값 조절",
	}: {
		value?: number;
		minValue?: number;
		maxValue?: number;
		color?: string;
		label?: { min: string; mid?: string; max: string };
		tooltip?: string;
		ariaLabel?: string;
	} = $props();

	const ratio = $derived((value - minValue) / (maxValue - minValue || 1));
</script>

<div class="tds-slider" data-tds-mobile-component="Slider" style:--ratio={ratio} style:--fill={color} data-tooltip={Boolean(tooltip)}>
	<div class="hit">
		<div class="track"><div class="range"><span class="fill"></span><span class="thumb"></span></div></div>
		{#if tooltip}<span class="tip" role="tooltip">{tooltip}</span>{/if}
		<input type="range" min={minValue} max={maxValue} bind:value aria-label={ariaLabel} />
	</div>
	{#if label}
		<div class="labels">
			<span>{label.min}</span>
			{#if label.mid}<span class="mid">{label.mid}</span>{/if}
			<span>{label.max}</span>
		</div>
	{/if}
</div>

<style>
	.tds-slider[data-tooltip="true"] {
		padding-top: 55px;
	}
	.hit {
		position: relative;
		height: var(--slider-hit);
	}
	.track {
		position: absolute;
		inset: calc((var(--slider-hit) - var(--track-height)) / 2) 0;
		border-radius: var(--track-radius);
		background: var(--grey-200);
	}
	.range {
		position: absolute;
		inset: 0 12px;
	}
	.fill {
		position: absolute;
		inset: 0 auto 0 -12px;
		width: calc(12px + 100% * var(--ratio));
		border-radius: var(--track-radius);
		background: var(--fill);
	}
	.thumb {
		position: absolute;
		top: 50%;
		left: calc(100% * var(--ratio));
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--static-white);
		box-shadow: 0 1px 4px 0 var(--grey-opacity-300);
		translate: -50% -50%;
	}
	input {
		position: absolute;
		inset: 0;
		width: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.tip {
		position: absolute;
		bottom: calc(100% + 4px);
		left: calc(12px + (100% - 24px) * var(--ratio));
		padding: 8px 12px;
		border-radius: var(--tooltip-radius-sm);
		background: var(--surface-float);
		box-shadow: var(--shadow-float-strong);
		color: var(--ink);
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		font-weight: 600;
		white-space: nowrap;
		translate: -50% 0;
	}
	.labels {
		position: relative;
		display: flex;
		justify-content: space-between;
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		font-weight: 500;
		color: var(--ink-subtle);
	}
	.mid {
		position: absolute;
		left: 50%;
		translate: -50% 0;
	}
</style>
