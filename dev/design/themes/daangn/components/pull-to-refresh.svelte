<!-- SEED PullToRefresh: indicator (ProgressCircle, 24) above scrollable content; data-ptr-state idle ·
     pulling · ready · refreshing drives the recipe's translate. Pointer pull with a 80px threshold. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import ProgressCircle from "./progress-circle.svelte";

	let { onRefresh, disabled = false, children }: { onRefresh?: () => Promise<void> | void; disabled?: boolean; children: Snippet } = $props();
	let state = $state<"idle" | "pulling" | "ready" | "refreshing">("idle");
	let distance = $state(0);
	let start = 0;
	const THRESHOLD = 80;

	function down(e: PointerEvent) {
		if (disabled || state === "refreshing") return;
		start = e.clientY;
	}
	function move(e: PointerEvent) {
		if (!start || disabled) return;
		distance = Math.max(0, Math.min(120, e.clientY - start));
		state = distance > THRESHOLD ? "ready" : distance > 0 ? "pulling" : "idle";
	}
	async function up() {
		if (!start) return;
		start = 0;
		if (state === "ready") {
			state = "refreshing";
			await onRefresh?.();
		}
		state = "idle";
		distance = 0;
	}
</script>

<div class="seed-pull-to-refresh__root" data-ptr-state={state} style="--ptr-displacement: {distance}px" onpointerdown={down} onpointermove={move} onpointerup={up} onpointerleave={up} role="presentation">
	<div class="seed-pull-to-refresh__indicator" data-ptr-state={state} data-ptr-dragging={start ? "" : undefined}>
		<ProgressCircle size="24" value={state === "refreshing" ? undefined : Math.min(100, (distance / THRESHOLD) * 100)} />
	</div>
	<div data-ptr-state={state}>{@render children()}</div>
</div>

<style>
	/* @recipe pull-to-refresh */
	/* SEED recipe: pull-to-refresh */
	:global(.seed-pull-to-refresh__root) {
		--ptr-size: calc(var(--dimension-x6) + var(--dimension-x8) * 2);
		--ptr-transition-duration: var(--duration-d6);
		height: 100%;
	}
	:global(.seed-pull-to-refresh__indicator) {
		display: flex;
		align-items: center;
		justify-content: center;
		transform: translateY(min(calc(var(--ptr-displacement, 0) - var(--ptr-size)), 0px));
		transition: transform var(--duration-d6);
	}
	:global(.seed-pull-to-refresh__indicator[data-ptr-dragging]) {
		transition: none;
	}
	/* @end recipe */
</style>
