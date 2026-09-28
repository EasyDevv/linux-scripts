<!-- TDS Badge. padding 3px 7px (4px 8px at large); radius tracks height, not one scale step:
     21->9, 24->11, 26->12, 29->13. Weak variants are the hue at ~16%. -->
<script lang="ts">
	type Size = "xsmall" | "small" | "medium" | "large";
	type Tone = "blue" | "teal" | "green" | "red" | "blue-weak" | "teal-weak" | "green-weak" | "red-weak";

	let { size = "medium", tone = "blue", children }: { size?: Size; tone?: Tone; children: import("svelte").Snippet } =
		$props();

	const SIZES: Record<Size, { h: string; r: string; pad: string; fs: string; lh: string; w: number }> = {
		xsmall: { h: "21px", r: "9px", pad: "3px 7px", fs: "10px", lh: "15px", w: 600 },
		small: { h: "24px", r: "11px", pad: "3px 7px", fs: "12px", lh: "18px", w: 700 },
		medium: { h: "26px", r: "12px", pad: "3px 7px", fs: "13px", lh: "19.5px", w: 700 },
		large: { h: "29px", r: "13px", pad: "4px 8px", fs: "14px", lh: "21px", w: 700 },
	};
	const TONES: Record<Tone, { fill: string; ink: string }> = {
		blue: { fill: "var(--blue-500)", ink: "var(--surface-float)" },
		teal: { fill: "var(--teal-500)", ink: "var(--surface-float)" },
		green: { fill: "var(--green-600)", ink: "var(--surface-float)" },
		red: { fill: "var(--red-500)", ink: "var(--surface-float)" },
		"blue-weak": { fill: "var(--weak-info)", ink: "var(--blue-400)" },
		"teal-weak": { fill: "var(--weak-info)", ink: "var(--teal-500)" },
		"green-weak": { fill: "var(--weak-info)", ink: "var(--green-400)" },
		"red-weak": { fill: "var(--weak-info)", ink: "var(--red-400)" },
	};

	const box = $derived(SIZES[size]);
	const paint = $derived(TONES[tone]);
</script>

<span
	data-tds-mobile-component="Badge"
	style:height={box.h}
	style:min-height={box.h}
	style:padding={box.pad}
	style:border-radius={box.r}
	style:background={paint.fill}
	style:color={paint.ink}
	style:font-size={box.fs}
	style:line-height={box.lh}
	style:font-weight={box.w}
	style:display="inline-flex"
	style:align-items="center"
>
	{@render children()}
</span>
