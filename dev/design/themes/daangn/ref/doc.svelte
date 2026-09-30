<!-- Docs page frame: article pad 56 32 → 900 column, h1 60/66/500, lead 16/24/300 muted,
     200px TOC ("목차") on the right. -->
<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import type { Snippet } from "svelte";
	import type { PageId } from "./data.ts";
	import Shell from "./shell.svelte";

	let {
		page,
		title,
		lead,
		toc,
		children,
	}: { page: PageId; title: string; lead?: string; toc: { id: string; label: string }[]; children: Snippet } = $props();
</script>

<Shell {page}>
	<div class="flex">
		<article class="min-w-0 flex-1" style="padding: 56px 32px 96px">
			<div class="mx-auto" style="max-width: 900px">
				<div class="flex items-center justify-between" style="height: 36px">
					<p style="font-size: 14px; line-height: 20px; color: var(--fg-neutral-muted)">React</p>
					<span class="inline-flex items-center" style="gap: 6px; height: 36px; padding: 0 14px; border-radius: 8px; background: var(--bg-transparent-selected); font-size: 14px; font-weight: 500">LLMS.txt <ChevronDown size={16} /></span>
				</div>
				<h1 style="margin-top: 24px; font-size: 60px; line-height: 66px; font-weight: 500; letter-spacing: -0.5px">{title}</h1>
				{#if lead}
					<p style="margin-top: 16px; font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">{lead}</p>
				{/if}
				<div class="text-right" style="margin-top: 72px">
					<p style="font-size: 10px; line-height: 16px; color: var(--fg-neutral-subtle)">사용 가능 버전</p>
					<p style="margin-top: 6px; font-size: 12px; line-height: 16px">@seed-design/react@1.2, @seed-design/css@1.2</p>
				</div>
				{@render children()}
			</div>
		</article>
		<aside class="hidden shrink-0 xl:block" style="width: 200px; padding: 48px 16px 8px 0">
			<nav aria-label="목차" class="sticky top-0">
				<p style="font-size: 12px; line-height: 16px; font-weight: 300; color: var(--fg-neutral-muted)">목차</p>
				<ul class="mt-3" style="border-inline-start: 1px solid var(--stroke-neutral-muted)">
					{#each toc as item, i (item.id)}
						<li><a href={`#${item.id}`} style="display: block; padding: 6px 0 6px 20px; margin-inline-start: -1px; border-inline-start: {i === 0 ? '2px solid var(--fg-neutral)' : '0'}; font-size: 12px; line-height: 20px; color: {i === 0 ? 'var(--fg-neutral)' : 'var(--fg-neutral-muted)'}; text-decoration: none">{item.label}</a></li>
					{/each}
				</ul>
			</nav>
		</aside>
	</div>
</Shell>
