<!-- SEED ProgressCircle (seed-design.io/react/components/progress-circle).
     size   24 (3px stroke) / 40 (5px) / inherit (from a parent's --size / --thickness, e.g. a button)
     tone   neutral gray-200 / gray-500 · brand carrot-200 / bg-brand-solid · staticWhite · inherit
     value  undefined = indeterminate (1.2s rotate + head/tail dash); 0 … 100 = determinate -->
<script lang="ts">
	import { variants } from "./seed.ts";

	let {
		value,
		size = "40",
		tone = "neutral",
		label = "loading...",
	}: {
		value?: number;
		size?: "24" | "40" | "inherit";
		tone?: "neutral" | "brand" | "staticWhite" | "inherit";
		label?: string;
	} = $props();

	const indeterminate = $derived(typeof value !== "number");
	const state = $derived(value === 100 ? "complete" : indeterminate ? "indeterminate" : "loading");
	const percent = $derived(indeterminate ? -1 : (value as number));
	const circle = "--radius: calc(var(--size) / 2 - var(--thickness) / 2); cx: calc(var(--size) / 2); cy: calc(var(--size) / 2); r: var(--radius); fill: transparent; stroke-width: var(--thickness)";
</script>

<svg
	class="seed-progress-circle__root"
	{...variants({ size, tone })}
	data-progress-state={state}
	role="progressbar"
	aria-valuenow={indeterminate ? undefined : value}
	aria-valuemin={0}
	aria-valuemax={100}
	aria-valuetext={indeterminate ? label : `${percent} percent`}
	style="width: var(--size); height: var(--size)"
>
	<circle class="seed-progress-circle__track" data-progress-state={state} style={circle} />
	<circle
		class="seed-progress-circle__range"
		data-progress-state={state}
		style="{circle}; --percent: {percent}; --circumference: calc(2 * 3.14159 * var(--radius)); stroke-dashoffset: calc(var(--circumference) * ((100 - var(--percent)) / 100)); {indeterminate ? '' : 'stroke-dasharray: var(--circumference);'} transform-origin: center; transform: rotate(-90deg);{value === 0 ? ' opacity: 0;' : ''}"
	/>
</svg>

<style>
	/* @recipe progress-circle */
	/* SEED recipe: progress-circle */
	:global(.seed-progress-circle__root) {
		display: inline-flex;
		box-sizing: border-box;
		position: relative;
	}
	:global(.seed-progress-circle__root[data-progress-state=indeterminate]) {
		animation: seed-rotate 1.2s cubic-bezier(0.35, 0.25, 0.65, 0.75) infinite;
	}
	:global(.seed-progress-circle__track) {
		stroke: var(--track-color);
	}
	:global(.seed-progress-circle__range) {
		stroke: var(--range-color);
		stroke-linecap: round;
		transition-duration: 300ms;
		transition-timing-function: cubic-bezier(0, 0, 0.15, 1);
		transition-property: stroke-dasharray;
	}
	:global(.seed-progress-circle__range[data-progress-state=indeterminate]) {
		animation: seed-progress-circle-head 1.2s cubic-bezier(0.35, 0, 0.65, 1) infinite normal none running, seed-progress-circle-tail 1.2s cubic-bezier(0.35, 0, 0.65, 0.6) infinite normal none running;
	}
	:global(.seed-progress-circle__root[data-tone="neutral"]) {
		--track-color: var(--palette-gray-200);
		--range-color: var(--palette-gray-500);
	}
	:global(.seed-progress-circle__root[data-tone="brand"]) {
		--track-color: var(--palette-carrot-200);
		--range-color: var(--bg-brand-solid);
	}
	:global(.seed-progress-circle__root[data-tone="staticWhite"]) {
		--track-color: var(--palette-static-white-alpha-300);
		--range-color: var(--palette-static-white);
	}
	:global(.seed-progress-circle__root[data-tone="inherit"]) {

	}
	:global(.seed-progress-circle__root[data-size="24"]) {
		--size: var(--dimension-x6);
		--thickness: 3px;
	}
	:global(.seed-progress-circle__root[data-size="40"]) {
		--size: var(--dimension-x10);
		--thickness: 5px;
	}
	:global(.seed-progress-circle__root[data-size="inherit"]) {

	}
	/* @end recipe */
</style>
