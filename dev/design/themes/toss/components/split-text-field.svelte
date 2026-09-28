<!-- TDS SplitTextField (components/TextField/split-text-field), e.g. 주민등록번호 6-7.
     box   two 55h wells (r14, 0.8px greyOpacity100 on greyOpacity50) with a "-" (17/25.5/600) between,
           row inset 0 20, gap 6px
     line  two underlined inputs at 22/31/600 (1.6px grey100 rule, 4px below), gap 12px, inset 0 24;
           the dash sits 6px above the rule
     Label / help as TextField: 13/19.5 grey800 (0 24 6) and grey600 (6 24 0). -->
<script lang="ts">
	let {
		variant = "box",
		label,
		help,
		first = $bindable(""),
		second = $bindable(""),
		firstPlaceholder = "",
		secondPlaceholder = "",
		secondType = "password",
	}: {
		variant?: "box" | "line";
		label?: string;
		help?: string;
		first?: string;
		second?: string;
		firstPlaceholder?: string;
		secondPlaceholder?: string;
		secondType?: "password" | "tel" | "text";
	} = $props();
</script>

<div class="tds-split" data-tds-mobile-component="SplitTextField" data-variant={variant}>
	{#if label}<div class="label">{label}</div>{/if}
	<div class="row">
		<div class="cell"><input type="tel" inputmode="numeric" bind:value={first} placeholder={firstPlaceholder} aria-label={firstPlaceholder || label} /></div>
		<span class="dash" aria-hidden="true">-</span>
		<div class="cell"><input type={secondType} inputmode="numeric" bind:value={second} placeholder={secondPlaceholder} aria-label={secondPlaceholder || "뒷자리"} /></div>
	</div>
	{#if help}<p class="help" aria-live="off">{help}</p>{/if}
</div>

<style>
	.tds-split {
		padding: 16px 0;
	}
	.label {
		padding: 0 var(--row-inset) 6px;
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		color: var(--ink);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 var(--field-inset);
	}
	[data-variant="line"] .row {
		gap: 12px;
		padding: 0 var(--row-inset);
	}
	.cell {
		flex: 1;
		display: flex;
		align-items: center;
		min-width: 0;
	}
	[data-variant="box"] .cell {
		min-height: var(--field-box-height);
		padding: var(--field-box-padding);
		border: var(--hairline-width) solid var(--grey-opacity-100);
		border-radius: var(--field-box-radius);
		background: var(--surface-well);
	}
	[data-variant="line"] .cell {
		padding-bottom: 4px;
		border-bottom: var(--field-underline-width) solid var(--grey-100);
	}
	.cell:focus-within {
		border-color: var(--status-info);
	}
	input {
		width: 100%;
		min-width: 0;
		padding: 0;
		border: 0;
		outline: none;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
	}
	[data-variant="line"] input {
		font-size: var(--text-t3);
		line-height: var(--text-t3--line-height);
		font-weight: 600;
	}
	input::placeholder {
		color: var(--ink-disabled);
	}
	.dash {
		color: var(--ink);
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		font-weight: 600;
	}
	[data-variant="line"] .dash {
		padding-bottom: 6px;
		font-size: var(--text-t3);
		line-height: var(--text-t3--line-height);
	}
	.help {
		margin: 0;
		padding: 6px var(--row-inset) 0;
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		color: var(--ink-subtle);
	}
</style>
