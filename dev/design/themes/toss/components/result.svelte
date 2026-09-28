<!-- TDS Result (components/result). Empty / error / done state.
     column centred, padding 32px 40px 40px
     figure   60px asset (or 24px icon), 12px below
     title    t5 17/25.5/600 grey900 (h5)
     desc     t6 15/22.5 grey700, margin-top 4, centred
     button   16px spacer, then Button medium (38h) -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		title,
		description,
		figure,
		button,
	}: { title: string; description?: string; figure?: Snippet; button?: Snippet } = $props();
</script>

<section class="tds-result" data-tds-mobile-component="Result">
	{#if figure}<div class="figure">{@render figure()}</div>{/if}
	<h5 class="title">{title}</h5>
	{#if description}<p class="desc">{description}</p>{/if}
	{#if button}<div class="button">{@render button()}</div>{/if}
</section>

<style>
	.tds-result {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 32px 40px 40px;
		text-align: center;
	}
	.figure {
		display: flex;
		margin-bottom: 12px;
	}
	.title {
		margin: 0;
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		font-weight: 600;
		color: var(--ink-strong);
	}
	.desc {
		margin: 4px 0 0;
		font-size: var(--text-t6);
		line-height: var(--text-t6--line-height);
		color: var(--ink-soft);
		white-space: pre-line;
		word-break: keep-all;
	}
	.button {
		margin-top: 16px;
	}
</style>
