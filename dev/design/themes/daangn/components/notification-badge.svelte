<!-- SEED NotificationBadge (seed-design.io/react/components/notification-badge).
     size  small = 6px carrot dot · large = count pill (t1-static bold, min 16)
     attach "icon" / "text": the positioner pins it to the icon's or text's top-right corner;
     `positioned={false}` renders the bare badge inline. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { variants } from "./seed.ts";

	let {
		size = "small",
		attach = "icon",
		positioned = true,
		children,
	}: { size?: "small" | "large"; attach?: "icon" | "text"; positioned?: boolean; children?: Snippet } = $props();
</script>

{#if positioned}
	<span class="seed-notification-badge-positioner" {...variants({ size, attach })}>
		<span class="seed-notification-badge" {...variants({ size })}>{@render children?.()}</span>
	</span>
{:else}
	<span class="seed-notification-badge" {...variants({ size })}>{@render children?.()}</span>
{/if}

<style>
	/* @recipe notification-badge, notification-badge-positioner */
	/* SEED recipe: notification-badge */
	:global(.seed-notification-badge) {
		display: inline-flex;
		box-sizing: border-box;
		align-items: center;
		justify-content: center;
		text-transform: none;
		text-align: start;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		text-decoration: none;
		background-color: var(--bg-brand-solid);
		color: var(--palette-static-white);
	}
	:global(.seed-notification-badge[data-size="small"]) {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
	}
	:global(.seed-notification-badge[data-size="large"]) {
		min-width: 18px;
		min-height: 18px;
		border-radius: var(--radius-full);
		padding-inline: var(--dimension-x1);
		padding-block: 0px;
		font-size: var(--text-t1-static);
		line-height: var(--text-t1-static--line-height);
		font-weight: var(--font-weight-bold);
	}

	/* SEED recipe: notification-badge-positioner */
	:global(.seed-notification-badge-positioner) {
		display: inline-flex;
		box-sizing: border-box;
		align-items: center;
		justify-content: center;
		position: absolute;
	}
	:global(.seed-notification-badge-positioner[data-attach="icon"]) {
		translate: 100% -100%;
		bottom: auto;
		left: auto;
	}
	:global(.seed-notification-badge-positioner[data-attach="text"]) {
		translate: 100% 0%;
		bottom: auto;
		left: auto;
	}
	:global(.seed-notification-badge-positioner[data-size="small"]) {

	}
	:global(.seed-notification-badge-positioner[data-size="large"]) {

	}
	:global(.seed-notification-badge-positioner[data-size="large"][data-attach="icon"]) {
		top: 14px;
		right: 8px;
	}
	:global(.seed-notification-badge-positioner[data-size="small"][data-attach="icon"]) {
		top: 7px;
		right: 7px;
	}
	:global(.seed-notification-badge-positioner[data-size="large"][data-attach="text"]) {
		right: calc(-1 * 2px);
	}
	:global(.seed-notification-badge-positioner[data-size="small"][data-attach="text"]) {
		right: calc(-1 * 2px);
	}
	/* @end recipe */
</style>
