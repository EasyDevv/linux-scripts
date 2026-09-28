<!-- TDS Checkbox. 24x24 graphic, 8px label gap, 1px stroke, hidden native input.
     Graphic variants: circle | line, each with a -disabled form.
     Port note: TDS draws the graphic in an SVG, so the live box reports
     border-radius 0. This CSS port puts the shape on the box instead, so its
     computed radius is 9999px (circle) / 4px (line) where TDS reads 0. -->
<script lang="ts">
	let {
		checked = $bindable(false),
		graphic = "circle",
		disabled = false,
		label,
	}: { checked?: boolean; graphic?: "circle" | "line"; disabled?: boolean; label: string } = $props();

	const R = $derived(graphic === "circle" ? 12 : 7);
	const box = $derived(disabled ? `var(--grey-300)` : checked ? `var(--blue-500)` : `var(--grey-400)`);
</script>

<label
	role="checkbox"
	data-tds-mobile-component="Checkbox"
	aria-checked={checked}
	aria-disabled={disabled}
	style:display="inline-flex"
	style:align-items="center"
	style:gap="var(--checkbox-label-gap)"
	style:color="var(--grey-800)"
	style:font-size="var(--text-body-sm)"
>
	<input type="checkbox" bind:checked {disabled} style:display="none" />
	<span
		data-checkbox-graphic={disabled ? `${graphic}-disabled` : graphic}
		style:width="var(--checkbox-size)"
		style:height="var(--checkbox-size)"
		style:border-radius={graphic === "circle" ? "9999px" : "4px"}
		style:border="1px solid {box}"
		style:background={checked && !disabled ? box : "transparent"}
		style:display="inline-flex"
		style:align-items="center"
		style:justify-content="center"
	>
		{#if checked}
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<path
					d={graphic === "circle" ? "M5 12.5l4.5 4.5L19 7.5" : "M5 12.5h14"}
					stroke={disabled ? "var(--grey-400)" : "var(--surface-float)"}
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		{/if}
	</span>
	<span>{label}</span>
</label>
