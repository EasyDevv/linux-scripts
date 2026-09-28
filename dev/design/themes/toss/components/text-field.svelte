<!-- TDS TextField. Box variant: 55h, 14px 16px padding, 14px radius, 0.8px hairline on a 2% well.
     Underline variant: 1.6px bottom rule, 4px below the text, no fill.
     Label 13/19.5 grey800 with 6px gap; help 13/19.5 grey600; both inset 24px (row 20px). -->
<script lang="ts">
	type Variant = "box" | "underline";

	let {
		label,
		help,
		placeholder = "Placeholder",
		value = $bindable(""),
		variant = "box",
		size = "17px",
		disabled = false,
		error = false,
		clearable = false,
	}: {
		label: string;
		help?: string;
		placeholder?: string;
		value?: string;
		variant?: Variant;
		size?: "17px" | "22px" | "30px";
		disabled?: boolean;
		error?: boolean;
		clearable?: boolean;
	} = $props();

	const pad = $derived(variant === "box" ? "14px 16px" : "0 0 4px");
	const radius = $derived(variant === "box" ? "var(--field-box-radius)" : "0");
	const bg = $derived(disabled ? "var(--grey-200)" : "var(--surface-well)");
</script>

<div style:padding-block="16px"
	data-tds-mobile-component="TextField" style:display="grid" style:gap="var(--field-label-gap)">
	<label
		for="tds-text-field"
		style:padding-inline="var(--row-inset)"
		style:padding-bottom="6px"
		style:font-size="var(--text-label)"
		style:line-height="var(--text-label--line-height)"
		style:color="var(--grey-800)"
	>
		{label}
	</label>
	<div style:padding-inline="var(--field-inset)">
		{#if variant === "box"}
			<div
				style:padding={pad}
				style:border-radius={radius}
				style:background={bg}
				style:border="var(--hairline-width) solid {error ? 'var(--red-500)' : 'var(--hairline)'}"
				style:display="flex"
				style:align-items="center"
				style:gap="8px"
			>
				<input
					id="tds-text-field"
					bind:value
					{placeholder}
					{disabled}
					aria-label={placeholder}
					style:flex="1"
					style:border="none"
					style:outline="none"
					style:background="transparent"
					style:font-size={size}
					style:line-height="var(--control-label-leading)"
					style:color={disabled ? "var(--grey-400)" : "var(--grey-800)"}
				/>
				{#if clearable && value}
					<button type="button" aria-label="지우기" style:color="var(--grey-400)">×</button>
				{/if}
			</div>
		{:else}
			<div style:padding={pad} style:border-bottom="var(--field-underline-width) solid var(--grey-100)">
				<input
					id="tds-text-field"
					bind:value
					{placeholder}
					{disabled}
					aria-label={placeholder}
					style:width="100%"
					style:border="none"
					style:outline="none"
					style:background="transparent"
					style:font-size={size}
					style:line-height="var(--control-label-leading)"
					style:font-weight="600"
					style:color={disabled ? "var(--grey-400)" : "var(--grey-800)"}
				/>
			</div>
		{/if}
	</div>
	{#if help}
		<p
			aria-live="off"
			style:padding-inline="var(--row-inset)"
			style:margin="0"
			style:font-size="var(--text-label)"
			style:line-height="var(--text-label--line-height)"
			style:color={error ? "var(--red-500)" : "var(--grey-600)"}
		>
			{help}
		</p>
	{/if}
</div>
