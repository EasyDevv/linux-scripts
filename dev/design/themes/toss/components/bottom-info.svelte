<!-- TDS BottomInfo (components/bottom-info). Legal fine print at the bottom of a screen.
     Grey background block (greyBackground), padding-top 24; ul padding 0 24 24, 13/19.5 grey700
     (paragraph lines at 28px), li padding-left 24 with a 16px bullet column, 8px between items.
     bottomGradient: 160px fade from greyBackground to transparent (default), a custom
     linear-gradient, or none (24px solid tail instead). -->
<script lang="ts">
	let {
		items,
		bottomGradient = "default",
	}: { items: string[]; bottomGradient?: "default" | "none" | string } = $props();

	const fade = $derived(
		bottomGradient === "default" ? "linear-gradient(var(--surface-grey), transparent)" : bottomGradient,
	);
</script>

<div class="tds-bottom-info" data-tds-mobile-component="BottomInfo">
	<div class="body">
		<ul>
			{#each items as item (item)}<li><p>{item}</p></li>{/each}
		</ul>
	</div>
	{#if bottomGradient === "none"}
		<div class="tail"></div>
	{:else}
		<div class="fade" style:background-image={fade}></div>
	{/if}
</div>

<style>
	.body {
		padding-top: 24px;
		background: var(--surface-grey);
	}
	ul {
		margin: 0;
		padding: 0 var(--row-inset) 24px;
		list-style: none;
		color: var(--ink-soft);
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
	}
	li {
		position: relative;
		padding-left: 24px;
	}
	li + li {
		margin-top: 8px;
	}
	li::before {
		content: "·";
		position: absolute;
		left: 0;
		width: 16px;
		text-align: center;
		line-height: 28px;
	}
	p {
		margin: 0;
		line-height: 28px;
		word-break: keep-all;
	}
	.fade {
		height: 160px;
	}
	.tail {
		height: 24px;
		background: var(--surface-grey);
	}
</style>
