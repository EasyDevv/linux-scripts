<!-- Docs page frame: the live TDS docs column (main 16px 48px 0, 832px content, 256px TOC aside).
     Nextra ink is docs chrome, not TDS, so it stays in chrome.ts as docsMark. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { docsMark } from "./chrome.ts";
	import type { PageId } from "./data.ts";
	import Shell from "./shell.svelte";

	let {
		page,
		crumb,
		title,
		lead,
		toc,
		children,
	}: {
		page: PageId;
		crumb: string;
		title: string;
		lead?: string;
		toc: { id: string; label: string }[];
		children: Snippet;
	} = $props();
</script>

<Shell {page}>
	<main class="flex px-12 pt-4">
		<div class="mx-auto min-w-0 max-w-(--content-narrow) flex-1 pb-16">
			<nav class="text-[14px]/[21px]" style:color={docsMark.subtleInk} aria-label="breadcrumb">{crumb} › {title}</nav>
			<h1 class="mt-2 text-[36px]/[54px] font-bold" style:color={docsMark.headingInk}>{title}</h1>
			{#if lead}
				<p class="mt-6 text-[16px]/[28px]" style:color={docsMark.bodyInk}>{lead}</p>
			{/if}
			{@render children()}
		</div>
		<aside class="hidden w-64 shrink-0 px-4 xl:block">
			<nav aria-label="On this page" class="sticky top-6 pt-6">
				<p class="mb-3 text-[14px]/[21px] font-semibold" style:color={docsMark.headingInk}>On This Page</p>
				<ul class="grid gap-2 text-[14px]/[21px]" style:color={docsMark.subtleInk}>
					{#each toc as item (item.id)}
						<li><a href={`#${item.id}`} class="hover:underline">{item.label}</a></li>
					{/each}
				</ul>
			</nav>
		</aside>
	</main>
</Shell>
