<!-- TDS Badge (components/badge).
     size   xsmall 21h r9 10/15/600 · small 24h r11 12/18/700 · medium 26h r12 13/19.5/700 · large 29h r13 14/21/700
            padding 3px 7px (4px 8px at large); radius follows height, not one scale step
     color  blue · teal · green · red · yellow · elephant (grey)
     variant fill: 500-600 hue + white ink · weak: 400 hue at 16% + 400 ink -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		size = "medium",
		color = "blue",
		variant = "fill",
		children,
	}: {
		size?: "xsmall" | "small" | "medium" | "large";
		color?: "blue" | "teal" | "green" | "red" | "yellow" | "elephant";
		variant?: "fill" | "weak";
		children: Snippet;
	} = $props();
</script>

<span class="tds-badge" data-tds-mobile-component="Badge" data-size={size} data-color={color} data-variant={variant}>
	{@render children()}
</span>

<style>
	.tds-badge {
		--hue: var(--blue-500);
		--weak: var(--blue-400);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 26px;
		padding: 3px 7px;
		border-radius: 12px;
		background: var(--hue);
		color: var(--ink-on-fill);
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		font-weight: 700;
		white-space: nowrap;
	}
	.tds-badge[data-size="xsmall"] {
		height: 21px;
		border-radius: 9px;
		font-size: 10px;
		line-height: 15px;
		font-weight: 600;
	}
	.tds-badge[data-size="small"] {
		height: 24px;
		border-radius: 11px;
		font-size: var(--text-st12);
		line-height: var(--text-st12--line-height);
	}
	.tds-badge[data-size="large"] {
		height: 29px;
		padding: 4px 8px;
		border-radius: 13px;
		font-size: var(--text-st11);
		line-height: var(--text-st11--line-height);
	}
	.tds-badge[data-color="teal"] {
		--hue: var(--teal-600);
		--weak: var(--teal-400);
	}
	.tds-badge[data-color="green"] {
		--hue: var(--green-600);
		--weak: var(--green-400);
	}
	.tds-badge[data-color="red"] {
		--hue: var(--red-500);
		--weak: var(--red-400);
	}
	.tds-badge[data-color="yellow"] {
		--hue: var(--yellow-600);
		--weak: var(--yellow-700);
	}
	.tds-badge[data-color="elephant"] {
		--hue: var(--grey-600);
		--weak: var(--grey-600);
	}
	.tds-badge[data-variant="weak"] {
		background: color-mix(in srgb, var(--weak) 16%, transparent);
		color: var(--weak);
	}
</style>
