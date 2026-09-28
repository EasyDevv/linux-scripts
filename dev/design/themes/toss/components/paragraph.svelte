<!-- TDS Paragraph. 17/25.5 grey900 body, 30/40 display; inline links get 0 4px padding
     with a -4px margin and a 4px radius so the underline does not shift the line. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		size = "body",
		align,
		children,
	}: { size?: "body" | "display"; align?: "left" | "center" | "right"; children: Snippet } = $props();
</script>

<p
	style:margin="0"
	style:font-size={size === "display" ? "var(--text-display)" : "var(--text-body)"}
	style:line-height={size === "display" ? "var(--text-display--line-height)" : "var(--text-body--line-height)"}
	style:font-weight={size === "display" ? "var(--text-display--font-weight)" : "400"}
	style:color="var(--grey-900)"
	style:text-align={align}
>
	{@render children()}
</p>

<!-- link variant: <a style="padding:0 4px; margin:0 -4px; border-radius:4px; color:var(--blue-500)"> -->
