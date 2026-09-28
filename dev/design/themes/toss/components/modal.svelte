<!-- TDS Modal (components/modal). Modal.Overlay + Modal.Content.
     Same frame as Dialog: black 20% dim (56% dark), 320 wide panel, r24, floatBackground,
     but free content: padding 32px 20px 20px, column centred. The docs demo ends in an xlarge
     (56h r16) full-width primary Button with 24px above it. inline renders in flow (catalogue). -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		open = $bindable(false),
		inline = false,
		label = "모달",
		onOverlayClick,
		children,
	}: {
		open?: boolean;
		inline?: boolean;
		label?: string;
		onOverlayClick?: () => void;
		children: Snippet;
	} = $props();
</script>

{#if open || inline}
	<div class="tds-modal" data-tds-mobile-component="Modal" data-inline={inline}>
		{#if !inline}
			<button type="button" class="overlay" aria-label="닫기" onclick={() => (onOverlayClick ? onOverlayClick() : (open = false))}></button>
		{/if}
		<div class="content" role="dialog" aria-modal={!inline} aria-label={label}>
			{@render children()}
		</div>
	</div>
{/if}

<style>
	.tds-modal {
		position: fixed;
		inset: 0;
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	/* inline keeps the fixed layout's centring, just in flow */
	.tds-modal[data-inline="true"] {
		position: static;
		display: flex;
		justify-content: center;
	}
	.overlay {
		position: absolute;
		inset: 0;
		padding: 0;
		border: 0;
		background: var(--overlay-dimmed);
	}
	.content {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
		max-width: var(--dialog-width);
		padding: 32px 20px 20px;
		border-radius: var(--dialog-radius);
		background: var(--surface-float);
		color: var(--ink);
	}
</style>
