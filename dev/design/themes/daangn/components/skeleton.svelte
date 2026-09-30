<!-- SEED Skeleton: bg-neutral-weak block with a 1.5s shimmer (neutral) or magic gradient; radius 0 · 8 · 16 · full. -->
<script lang="ts">
	let {
		width = "100%",
		height = "var(--dimension-x4)",
		radius = "8",
		tone = "neutral",
	}: { width?: string; height?: string; radius?: "0" | "8" | "16" | "full"; tone?: "neutral" | "magic" } = $props();
</script>

<div class="seed-skeleton" data-radius={radius} data-tone={tone} style="width: {width}; height: {height}"></div>

<style>
	/* @recipe skeleton */
	/* SEED recipe: skeleton */
	:global(.seed-skeleton) {
		display: inline-block;
		box-sizing: border-box;
		overflow: hidden;
		--seed-box-width-base: auto;
		--seed-box-width-sm: var(--seed-box-width-base, initial);
		--seed-box-width-md: var(--seed-box-width-sm, initial);
		--seed-box-width-lg: var(--seed-box-width-md, initial);
		--seed-box-width-xl: var(--seed-box-width-lg, initial);
		--seed-box-width: var(--seed-box-width-base, initial);
		--seed-box-height-base: auto;
		--seed-box-height-sm: var(--seed-box-height-base, initial);
		--seed-box-height-md: var(--seed-box-height-sm, initial);
		--seed-box-height-lg: var(--seed-box-height-md, initial);
		--seed-box-height-xl: var(--seed-box-height-lg, initial);
		--seed-box-height: var(--seed-box-height-base, initial);
		width: var(--seed-box-width);
		height: var(--seed-box-height);
	}
	:global(.seed-skeleton::after) {
		content: '';
		display: block;
		width: 100%;
		height: 100%;
		background-repeat: no-repeat;
		animation-fill-mode: forwards;
		animation-name: seed-slide-x;
		animation-duration: 1.5s;
		animation-timing-function: var(--ease-easing);
		animation-iteration-count: infinite;
	}
	:global(.seed-skeleton[data-radius="0"]) {
		border-radius: 0px;
	}
	:global(.seed-skeleton[data-radius="8"]) {
		border-radius: 8px;
	}
	:global(.seed-skeleton[data-radius="16"]) {
		border-radius: 16px;
	}
	:global(.seed-skeleton[data-radius="full"]) {
		border-radius: var(--radius-full);
	}
	:global(.seed-skeleton[data-tone="neutral"]) {
		background: var(--palette-gray-200);
	}
	:global(.seed-skeleton[data-tone="neutral"]::after) {
		background-image: linear-gradient(90deg, var(--gradient-shimmer-neutral));
	}
	:global(.seed-skeleton[data-tone="magic"]) {
		background: var(--bg-magic-weak);
	}
	:global(.seed-skeleton[data-tone="magic"]::after) {
		background-image: linear-gradient(90deg, var(--gradient-shimmer-magic));
	}
	@media (min-width: 480px) {
		:global(.seed-skeleton) {
			--seed-box-width: var(--seed-box-width-sm, initial);
			--seed-box-height: var(--seed-box-height-sm, initial);
		}
	}
	@media (min-width: 768px) {
		:global(.seed-skeleton) {
			--seed-box-width: var(--seed-box-width-md, initial);
			--seed-box-height: var(--seed-box-height-md, initial);
		}
	}
	@media (min-width: 1280px) {
		:global(.seed-skeleton) {
			--seed-box-width: var(--seed-box-width-lg, initial);
			--seed-box-height: var(--seed-box-height-lg, initial);
		}
	}
	@media (min-width: 1440px) {
		:global(.seed-skeleton) {
			--seed-box-width: var(--seed-box-width-xl, initial);
			--seed-box-height: var(--seed-box-height-xl, initial);
		}
	}
	/* @end recipe */
</style>
