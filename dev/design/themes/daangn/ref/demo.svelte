<!-- One docs preview block: r12 box with a 0.8px stroke-neutral-muted hairline, a chip-tabs row
     (미리보기 selected / 코드) over a hairline, and a 320px min stage centring the example (pad 20).
     `wide` stretches the stage content (lists, fields) instead of centring it. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		id,
		title,
		level = 2,
		spec,
		wide = false,
		stage = 320,
		live,
		children,
	}: {
		id: string;
		title?: string;
		level?: 2 | 3;
		spec?: string;
		wide?: boolean;
		stage?: number;
		/** the live census preview this block reproduces, "page:index" (ref/seed-design.io/census) */
		live?: string;
		children: Snippet;
	} = $props();
</script>

<section {id} class="scroll-mt-6" data-live={live}>
	{#if title}
		{#if level === 2}
			<h2 style="margin: 48px 0 24px; font-size: 24px; line-height: 32px; font-weight: 500">{title}</h2>
		{:else}
			<h3 style="margin: 32px 0 16px; font-size: 20px; line-height: 28px; font-weight: 500">{title}</h3>
		{/if}
	{/if}
	{#if spec}
		<p style="margin: -12px 0 16px; font-family: var(--font-mono); font-size: 12px; line-height: 20px; color: var(--fg-neutral-subtle)">{spec}</p>
	{/if}
	<div data-role="preview" style="margin: 16px 0; border: 0.8px solid var(--stroke-neutral-muted); border-radius: 12px; overflow: hidden">
		<div class="flex items-center" style="gap: 8px; padding: 12px 16px; border-bottom: 0.8px solid var(--stroke-neutral-muted)">
			<span style="display: inline-flex; align-items: center; height: 36px; padding: 0 14px; border-radius: 9999px; background: var(--bg-transparent-selected); font-size: 14px; font-weight: 500; color: var(--fg-neutral)">미리보기</span>
			<span style="display: inline-flex; align-items: center; height: 36px; padding: 0 14px; font-size: 14px; font-weight: 500; color: var(--fg-neutral-muted)">코드</span>
		</div>
		<div data-role="stage" class="flex items-center justify-center" style="min-height: {stage}px; padding: 20px; line-height: normal; color: color-mix(in oklab, var(--fg-neutral) 90%, transparent)">
			<div class={wide ? "w-full" : "flex flex-col items-center"} style={wide ? undefined : "gap: 8px"}>
				{@render children()}
			</div>
		</div>
	</div>
</section>
