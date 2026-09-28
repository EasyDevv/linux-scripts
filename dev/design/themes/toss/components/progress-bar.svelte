<!-- TDS ProgressBar (components/progress-bar). role=progressbar, aria-valuetext "N%".
     size   light 2h · normal 5h (r2.5) · bold 8h (r4); track grey200, full width
     color  blue400 by default (green400, red400 in the docs)
     animate slides the fill (translateX) from 0 on mount. -->
<script lang="ts">
	let {
		progress,
		size = "normal",
		color = "var(--blue-400)",
		animate = false,
	}: { progress: number; size?: "light" | "normal" | "bold"; color?: string; animate?: boolean } = $props();

	const pct = $derived(Math.max(0, Math.min(1, progress)));
</script>

<div
	class="tds-progress"
	data-tds-mobile-component="ProgressBar"
	data-size={size}
	data-animate={animate}
	role="progressbar"
	aria-valuetext={`${Math.round(pct * 100)}%`}
	style:--pct={pct}
	style:--fill={color}
>
	<span class="fill"></span>
</div>

<style>
	.tds-progress {
		--h: var(--track-height);
		--r: var(--track-radius);
		position: relative;
		height: var(--h);
		border-radius: var(--r);
		overflow: hidden;
		background: var(--grey-200);
	}
	.tds-progress[data-size="light"] {
		--h: 2px;
	}
	.tds-progress[data-size="bold"] {
		--h: 8px;
		--r: 4px;
	}
	.fill {
		position: absolute;
		inset: 0;
		border-radius: var(--r);
		background: var(--fill);
		translate: calc((var(--pct) - 1) * 100%) 0;
		transition: translate 0.4s var(--panel-fold-ease);
	}
	[data-animate="true"] .fill {
		animation: tds-progress-in 0.8s var(--panel-fold-ease);
	}
	@keyframes tds-progress-in {
		from {
			translate: -100% 0;
		}
	}
</style>
