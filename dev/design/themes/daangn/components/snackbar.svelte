<!-- SEED Snackbar (seed-design.io/react/components/snackbar): neutral-inverted r8 bar, min 44, max 464,
     p10; message t4 inverted, bold carrot action, positive / critical variants add a prefix icon.
     `inline` renders it in flow (catalogue); otherwise it sits in a bottom-centred region above the
     safe area and dismisses after `duration` ms. -->
<script lang="ts">
	import { variants } from "./seed.ts";

	let {
		open = $bindable(true),
		variant = "default",
		message,
		action,
		onAction,
		duration = 5000,
		inline = false,
	}: {
		open?: boolean;
		variant?: "default" | "positive" | "critical";
		message: string;
		action?: string;
		onAction?: () => void;
		duration?: number;
		inline?: boolean;
	} = $props();

	const v = $derived(variants({ variant }));
	$effect(() => {
		if (!open || inline || !duration) return;
		const t = setTimeout(() => (open = false), duration);
		return () => clearTimeout(t);
	});
</script>

{#snippet bar()}
	<div class="seed-snackbar__root" {...v} role="status" data-state="open">
		{#if variant !== "default"}
			<svg class="seed-snackbar__prefixIcon" {...v} viewBox="0 0 24 24" aria-hidden="true">
				{#if variant === "positive"}<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm4.2 6.6a1.1 1.1 0 0 0-1.56 0l-3.9 3.9-1.39-1.39a1.1 1.1 0 1 0-1.56 1.56l2.17 2.17a1.1 1.1 0 0 0 1.56 0l4.68-4.68a1.1 1.1 0 0 0 0-1.56Z" fill="currentColor" />{:else}<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 13.4a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm0-8.6a1.1 1.1 0 0 0-1.1 1.1v5.2a1.1 1.1 0 1 0 2.2 0V7.9A1.1 1.1 0 0 0 12 6.8Z" fill="currentColor" />{/if}
			</svg>
		{/if}
		<div class="seed-snackbar__content" {...v}>
			<span class="seed-snackbar__message" {...v}>{message}</span>
			{#if action}<button type="button" class="seed-snackbar__actionButton" {...v} onclick={onAction}>{action}</button>{/if}
		</div>
	</div>
{/snippet}

{#if open}
	{#if inline}
		{@render bar()}
	{:else}
		<div class="seed-snackbar-region" role="region" aria-live="polite" style="position: fixed; left: 0; right: 0; bottom: var(--safe-area-bottom); z-index: 50; display: flex; justify-content: center">{@render bar()}</div>
	{/if}
{/if}

<style>
	/* @recipe snackbar, snackbar-region */
	/* SEED recipe: snackbar */
	:global(.seed-snackbar__root) {
		box-sizing: border-box;
		display: flex;
		align-items: center;
		width: 100%;
		max-width: 464px;
		background: var(--bg-neutral-inverted);
		border-radius: var(--radius-r2);
		padding-inline: var(--dimension-x2-5);
		padding-block: var(--dimension-x2-5);
		min-height: 44px;
		animation: seed-enter;
		animation-timing-function: var(--ease-enter);
		animation-duration: var(--duration-d3);
		--seed-enter-translate-x: 0;
		--seed-enter-translate-y: 0;
		--seed-enter-opacity: 0;
		--seed-enter-scale: 0.8;
	}
	:global(.seed-snackbar__root:not([data-open])) {
		animation: seed-exit;
		animation-timing-function: var(--ease-exit);
		animation-duration: var(--duration-d2);
		animation-fill-mode: forwards;
		--seed-exit-translate-x: 0;
		--seed-exit-translate-y: 0;
		--seed-exit-opacity: 0;
		--seed-exit-scale: 0.8;
	}
	:global(.seed-snackbar__root) {
		transition: outline-color var(--duration-d3) var(--ease-easing);
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-snackbar__root:is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-snackbar__content) {
		display: flex;
		flex-grow: 1;
		justify-content: space-between;
		align-items: center;
		padding-inline: var(--dimension-x1-5);
		gap: var(--dimension-x2-5);
	}
	:global(.seed-snackbar__message) {
		margin: 0;
		color: var(--fg-neutral-inverted);
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
		font-weight: var(--font-weight-regular);
	}
	:global(.seed-snackbar__prefixIcon) {
		flex-shrink: 0;
		width: 24px;
		height: 24px;
		padding-right: var(--dimension-x0-5);
	}
	:global(.seed-snackbar__actionButton) {
		position: relative;
		display: inline-flex;
		box-sizing: border-box;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		border: none;
		text-transform: none;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		background-color: unset;
		text-decoration: none;
		flex-shrink: 0;
		color: var(--fg-brand);
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
		font-weight: var(--font-weight-bold);
	}
	:global(.seed-snackbar__actionButton:is(:active, [data-active])) {
		scale: var(--feedback-scale);
	}
	:global(.seed-snackbar__actionButton) {
		transition: scale var(--duration-pressed-scale) var(--ease-pressed-scale);
	}
	:global(.seed-snackbar__actionButton:after) {
		content: '';
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		inset-inline: calc(-1 * var(--dimension-x2));
		min-height: 44px;
		background: transparent;
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: calc(var(--dimension-x0-5) * -1);
		transition: outline-color var(--duration-d3) var(--ease-easing);
	}
	:global(.seed-snackbar__actionButton:is(:focus, [data-focus])) {
		outline: none;
	}
	:global(.seed-snackbar__actionButton:is(:focus-visible, [data-focus-visible]):after) {
		border-radius: var(--radius-r1);
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: calc(var(--dimension-x0-5) * -1);
	}
	:global(.seed-snackbar__prefixIcon[data-variant="default"]) {
		display: none;
	}
	:global(.seed-snackbar__prefixIcon[data-variant="positive"]) {
		color: var(--fg-positive);
	}
	:global(.seed-snackbar__prefixIcon[data-variant="critical"]) {
		color: var(--fg-critical);
	}

	/* SEED recipe: snackbar-region */
	:global(.seed-snackbar-region) {
		z-index: 2147483647;
		display: flex;
		flex-direction: column;
		align-items: center;
		left: calc(env(safe-area-inset-left, 0px));
		right: calc(env(safe-area-inset-right, 0px));
		bottom: calc(env(safe-area-inset-bottom, 0px) + var(--snackbar-region-offset, 0px));
		padding-inline: var(--dimension-x2);
		padding-block: var(--dimension-x2);
		transition-property: bottom;
		transition-duration: var(--duration-d4);
		transition-timing-function: var(--ease-easing);
	}
	/* @end recipe */
</style>
