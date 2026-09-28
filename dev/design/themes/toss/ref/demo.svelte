<!-- One component block: h2 (anchor) + measured spec line + preview.
     phone  = the docs' mobile preview: 375px wide on the TDS base surface (components are built for 390)
     wide   = full content column (swatches, tables)
     canvas = grey background (greyBackground) behind the preview, for white-surface components -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { docsMark } from "./chrome.ts";

	let {
		id,
		title,
		spec,
		frame = "phone",
		canvas = "base",
		bleed = false,
		children,
	}: {
		id: string;
		title: string;
		spec?: string;
		frame?: "phone" | "wide";
		canvas?: "base" | "grey";
		/** no side padding: for snippets that carry their own 20/24px screen inset */
		bleed?: boolean;
		children: Snippet;
	} = $props();
</script>

<section {id} class="scroll-mt-6">
	<h2
		class="mt-12 border-b border-(--border) pb-1 text-[30px]/[45px] font-semibold"
		style:border-bottom-width="var(--hairline-width)"
		style:color={docsMark.headingInk}
	>
		{title}
	</h2>
	{#if spec}
		<p class="mt-3 font-mono text-[12.5px]/[20px]" style:color={docsMark.subtleInk}>{spec}</p>
	{/if}
	<div
		data-role="preview"
		class="mt-5 overflow-hidden rounded-xl border border-(--hairline) py-5"
		class:px-5={!bleed}
		class:bg-surface-grey={canvas === "grey"}
		class:bg-surface-base={canvas === "base"}
		style:border-width="var(--hairline-width)"
	>
		<div class={frame === "phone" ? "mx-auto w-full max-w-[375px]" : "w-full"}>
			{@render children()}
		</div>
	</div>
</section>
