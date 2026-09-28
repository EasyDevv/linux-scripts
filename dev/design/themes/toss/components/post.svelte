<!-- TDS Post (components/post). Long-form notice / terms body. Every block is inset 0 24, grey700,
     headings use leading 1.35 (not the text scale):
       h1 t2 26/35.1/700, padding-top 16 · h2 t3 22/29.7/700, padding-top 16
       h3 st8 19/25.65/700, padding-top 8 · h4 t5 17/22.95/700, padding-top 8
       p  t5 17/25.5 (or t7 13/19.5 for fine print)
       ol / ul  17/25.5, inset 0 24 0 16; li padding-left 32, 8px between items, marker in a 24px column;
                nested lists margin 8 0 0 -8
       hr 1px hairline, margin 24px 24px
     Pass HTML-free structure through `blocks`. -->
<script lang="ts">
	type Block =
		| { type: "h1" | "h2" | "h3" | "h4" | "p" | "fine"; text: string }
		| { type: "ol" | "ul"; items: (string | { text: string; items: string[] })[] }
		| { type: "hr" };

	let { blocks }: { blocks: Block[] } = $props();
</script>

<article class="tds-post" data-tds-mobile-component="Post">
	{#each blocks as block, i (i)}
		{#if block.type === "hr"}
			<hr />
		{:else if block.type === "ol" || block.type === "ul"}
			<svelte:element this={block.type} class="list">
				{#each block.items as item, j (j)}
					{#if typeof item === "string"}
						<li>{item}</li>
					{:else}
						<li>
							{item.text}
							<svelte:element this={block.type} class="list nested">
								{#each item.items as sub, k (k)}<li>{sub}</li>{/each}
							</svelte:element>
						</li>
					{/if}
				{/each}
			</svelte:element>
		{:else if block.type === "fine"}
			<p class="fine">{block.text}</p>
		{:else}
			<svelte:element this={block.type} class={block.type}>{block.text}</svelte:element>
		{/if}
	{/each}
</article>

<style>
	.tds-post {
		color: var(--ink-soft);
		word-break: keep-all;
	}
	.h1,
	.h2,
	.h3,
	.h4 {
		margin: 0;
		padding: 16px var(--row-inset) 0;
		font-weight: 700;
	}
	.h1 {
		font-size: var(--text-t2);
		line-height: 1.35;
	}
	.h2 {
		font-size: var(--text-t3);
		line-height: 1.35;
	}
	.h3 {
		padding-top: 8px;
		font-size: var(--text-st8);
		line-height: 1.35;
	}
	.h4 {
		padding-top: 8px;
		font-size: var(--text-t5);
		line-height: 1.35;
	}
	.p,
	.fine {
		margin: 0;
		padding: 0 var(--row-inset);
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
	}
	.p + .p,
	.p + .fine,
	.fine + .p {
		padding-top: 16px;
	}
	.fine {
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
	}
	.list {
		margin: 8px 0 0;
		padding: 0 var(--row-inset) 0 16px;
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		list-style: none;
		counter-reset: tds-post;
	}
	.list.nested {
		margin: 8px 0 0 -8px;
		padding: 0;
	}
	.list li {
		position: relative;
		padding-left: 32px;
		counter-increment: tds-post;
	}
	.list li + li {
		margin-top: 8px;
	}
	ol.list > li::before {
		content: counter(tds-post) ".";
		position: absolute;
		left: 0;
		width: 24px;
		text-align: right;
	}
	ul.list > li::before {
		content: "";
		position: absolute;
		top: calc(var(--text-t5--line-height) / 2 - 2px);
		left: 10px;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: currentColor;
	}
	hr {
		height: 1px;
		margin: 24px var(--row-inset);
		border: 0;
		background: var(--hairline);
	}
</style>
