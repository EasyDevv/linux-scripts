<!-- TDS IconButton. 48x48 hit (12px padding around a 24px icon), 12px radius;
     the bordered variant is 50x50 with a 0.8px hairline. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		label,
		bordered = false,
		fill = false,
		children,
	}: { label: string; bordered?: boolean; fill?: boolean; children: Snippet } = $props();
</script>

<button
	type="button"
	data-tds-mobile-component="IconButton"
	aria-label={label}
	style:width={bordered ? "50px" : "48px"}
	style:height={bordered ? "50px" : "48px"}
	style:padding="12px"
	style:border-radius="var(--field-well-radius)"
	style:border={bordered ? "var(--hairline-width) solid var(--hairline)" : "none"}
	style:background={fill ? "var(--surface-hover)" : "transparent"}
>
	{@render children()}
</button>
