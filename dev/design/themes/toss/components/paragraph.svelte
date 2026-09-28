<!-- TDS Paragraph + Paragraph.Text (components/paragraph).
     typography t1..t7 / st1..st13 from --text-{step}; default t5 (17/25.5). Ink grey900 by default.
     fontWeight regular 400 · medium 500 · semibold 600 · bold 700.
     as = the element (p, h1..h6, span). The outer box sets line-height 0 in TDS and each
     Paragraph.Text restores the scale line height; this port keeps one element. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	type Step =
		| "t1" | "t2" | "t3" | "t4" | "t5" | "t6" | "t7"
		| "st1" | "st2" | "st3" | "st4" | "st5" | "st6" | "st7" | "st8" | "st9" | "st10" | "st11" | "st12" | "st13";

	let {
		as = "p",
		typography = "t5",
		fontWeight = "regular",
		color = "var(--ink-strong)",
		children,
	}: {
		as?: string;
		typography?: Step;
		fontWeight?: "regular" | "medium" | "semibold" | "bold";
		color?: string;
		children: Snippet;
	} = $props();

	const WEIGHT = { regular: 400, medium: 500, semibold: 600, bold: 700 };
</script>

<svelte:element
	this={as}
	class="tds-paragraph"
	data-tds-mobile-component="Paragraph"
	role="text"
	style:font-size={`var(--text-${typography})`}
	style:line-height={`var(--text-${typography}--line-height)`}
	style:font-weight={WEIGHT[fontWeight]}
	style:color
>
	{@render children()}
</svelte:element>

<style>
	.tds-paragraph {
		margin: 0;
		word-break: keep-all;
		overflow-wrap: anywhere;
	}
</style>
