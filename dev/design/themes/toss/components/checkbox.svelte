<!-- TDS Checkbox (components/checkbox).
     circle  24px box, 22px disc: grey300 unchecked / blue500 checked, white check (11x8) on top
     line    check mark only (16x11): grey300 unchecked / blue500 checked
     label   8px gap, t6 (15/22.5) ink; disabled = graphic opacity .4
     role=checkbox + aria-checked on the label, native input hidden. inputType radio keeps the look. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		checked = $bindable(false),
		variant = "circle",
		size = 24,
		disabled = false,
		inputType = "checkbox",
		children,
	}: {
		checked?: boolean;
		variant?: "circle" | "line";
		size?: number;
		disabled?: boolean;
		inputType?: "checkbox" | "radio";
		children?: Snippet;
	} = $props();
</script>

<label
	class="tds-checkbox"
	data-tds-mobile-component="Checkbox"
	role={inputType}
	aria-checked={checked}
	aria-disabled={disabled}
	tabindex={disabled ? -1 : 0}
	data-variant={variant}
	data-checked={checked}
	style:--size={`${size}px`}
	onkeydown={(e) => {
		if (!disabled && (e.key === " " || e.key === "Enter")) {
			e.preventDefault();
			checked = !checked;
		}
	}}
>
	<input type="checkbox" bind:checked {disabled} hidden />
	<svg class="graphic" viewBox="0 0 24 24" aria-hidden="true">
		{#if variant === "circle"}
			<circle class="disc" cx="12" cy="12" r="11" />
			<path class="tick" d="M7.2 12.4l3.2 3.1 6.4-6.6" />
		{:else}
			<path class="mark" d="M4.5 12.6l5 4.9 10-10.4" />
		{/if}
	</svg>
	{#if children}<span class="label">{@render children()}</span>{/if}
</label>

<style>
	.tds-checkbox {
		display: inline-flex;
		align-items: center;
		gap: var(--checkbox-label-gap);
		color: var(--ink);
		font-size: var(--text-t6);
		line-height: var(--text-t6--line-height);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	.tds-checkbox[aria-disabled="true"] {
		cursor: default;
	}
	.tds-checkbox[aria-disabled="true"] .graphic {
		opacity: 0.4;
	}
	.graphic {
		flex-shrink: 0;
		width: var(--size);
		height: var(--size);
	}
	.disc {
		fill: var(--grey-300);
		transition: fill 0.15s;
	}
	[data-checked="true"] .disc {
		fill: var(--status-info);
	}
	.tick {
		fill: none;
		stroke: var(--static-white);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.mark {
		fill: none;
		stroke: var(--grey-300);
		stroke-width: 2.4;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: stroke 0.15s;
	}
	[data-checked="true"] .mark {
		stroke: var(--status-info);
	}
</style>
