<!-- TDS Button. Measured: 32/38/48/56 height, 8/10/14/16 radius, 10/16/16/28 padding-inline,
     label leading = fontSize x 1.252, weight 600. Fill layer is a child div, not the button box. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	type Variant = "fill" | "weak" | "danger" | "danger-weak";
	type Size = "small" | "medium" | "large" | "default";

	let {
		variant = "fill",
		size = "default",
		disabled = false,
		loading = false,
		onclick,
		children,
	}: {
		variant?: Variant;
		size?: Size;
		disabled?: boolean;
		loading?: boolean;
		onclick?: () => void;
		children: Snippet;
	} = $props();

	const SIZES: Record<Size, { h: string; r: string; px: string; fs: string }> = {
		small: { h: "32px", r: "8px", px: "10px", fs: "13px" },
		medium: { h: "38px", r: "10px", px: "16px", fs: "15px" },
		large: { h: "48px", r: "14px", px: "16px", fs: "17px" },
		default: { h: "56px", r: "16px", px: "28px", fs: "17px" },
	};
	const VARIANTS: Record<Variant, { fill: string; ink: string }> = {
		fill: { fill: "var(--blue-500)", ink: "var(--surface-float)" },
		weak: { fill: "var(--surface-hover)", ink: "var(--grey-700)" },
		danger: { fill: "var(--red-500)", ink: "var(--surface-float)" },
		"danger-weak": { fill: "var(--weak-danger)", ink: "var(--red-600)" },
	};

	const box = $derived(SIZES[size]);
	const paint = $derived(VARIANTS[variant]);
</script>

<button
	type="button"
	data-tds-mobile-component="Button"
	disabled={disabled || loading}
	{onclick}
	aria-busy={loading}
	aria-live={loading ? "polite" : "off"}
	style:height={box.h}
	style:min-height={box.h}
	style:display="flex"
	style:align-items="center"
	style:border="none"
	style:border-radius={box.r}
	style:color={paint.ink}
	style:font-size={box.fs}
	style:font-weight="600"
	style:line-height="var(--control-label-leading)"
>
	<div style:background={paint.fill} style:height="100%" style:border-radius="inherit">
		<span style:min-height={box.h} style:padding-inline={box.px} style:display="flex" style:align-items="center"
			>{@render children()}</span
		>
	</div>
</button>
