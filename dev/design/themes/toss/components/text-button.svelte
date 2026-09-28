<!-- TDS TextButton. 28h hit box, 8px radius, press layer 9px at 36h, 17/21.284/500. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		tone = "idle",
		size = "17px",
		weight = 500,
		children,
	}: {
		tone?: "idle" | "active";
		size?: "13px" | "15px" | "17px" | "20px" | "22px" | "28px";
		weight?: 500 | 600 | 700;
		children: Snippet;
	} = $props();
</script>

<button
	type="button"
	data-tds-mobile-component="TextButton"
	style:border-radius="var(--control-radius-nav)"
	style:color={tone === "active" ? "var(--blue-500)" : "var(--grey-600)"}
	style:font-size={size}
	style:line-height="var(--control-label-leading)"
	style:font-weight={weight}
>
	<div style:border-radius="var(--control-radius)" aria-hidden="true">
		<span style:display="inline-flex" style:align-items="center">{@render children()}</span>
	</div>
</button>
