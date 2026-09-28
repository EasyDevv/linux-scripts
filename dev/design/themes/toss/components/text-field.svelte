<!-- TDS TextField (components/TextField/text-field).
     wrapper  padding 16px 0; label 13/19.5 grey800, padding 0 24 6; help 13/19.5 grey600, padding 6 24 0
     box      row inset 0 20, 55h, padding 14px 16px, r14, 0.8px greyOpacity100 rule on a greyOpacity50 well,
              17/25.5 grey800; disabled = grey200 fill + grey400 ink
     line     row inset 0 24, text 22/31/600, 1.6px bottom rule grey100, 4px under the text
     big      as line at 30/40/600 · hero 30/40/600 with no rule (40h)
     error    help and rule turn red500 · focus turns the rule blue500
     prefix / suffix sit inline in the same type; right = trailing snippet (button, unit) -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLInputAttributes } from "svelte/elements";

	let {
		variant = "box",
		label,
		help,
		hasError = false,
		value = $bindable(""),
		prefix,
		suffix,
		clearable = false,
		right,
		id = `tf-${Math.random().toString(36).slice(2, 8)}`,
		...rest
	}: {
		variant?: "box" | "line" | "big" | "hero";
		label?: string;
		help?: string;
		hasError?: boolean;
		value?: string;
		prefix?: string;
		suffix?: string;
		clearable?: boolean;
		right?: Snippet;
	} & Omit<HTMLInputAttributes, "prefix" | "value"> = $props();
</script>

<div class="tds-text-field" data-tds-mobile-component="TextField" data-variant={variant} data-error={hasError}>
	{#if label}<label class="label" for={id}>{label}</label>{/if}
	<div class="row">
		<div class="control">
			{#if prefix}<span class="affix">{prefix}</span>{/if}
			<input {...rest} {id} bind:value aria-invalid={hasError} />
			{#if suffix}<span class="affix">{suffix}</span>{/if}
			{#if clearable && value}
				<button type="button" class="clear" aria-label="지우기" onclick={() => (value = "")}>
					<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M9 9l6 6M15 9l-6 6" /></svg>
				</button>
			{/if}
			{#if right}{@render right()}{/if}
		</div>
	</div>
	{#if help}<p class="help" aria-live="off">{help}</p>{/if}
</div>

<style>
	.tds-text-field {
		--fs: var(--text-t5);
		--lh: var(--text-t5--line-height);
		--fw: 400;
		padding: 16px 0;
		font-size: var(--fs);
		line-height: var(--lh);
	}
	.tds-text-field[data-variant="line"] {
		--fs: var(--text-t3);
		--lh: var(--text-t3--line-height);
		--fw: 600;
	}
	.tds-text-field[data-variant="big"] {
		--fs: var(--text-t1);
		--lh: var(--text-t1--line-height);
		--fw: 600;
	}
	.tds-text-field[data-variant="hero"] {
		--fs: var(--text-t1);
		--lh: var(--text-t1--line-height);
		--fw: 600;
	}
	.label {
		display: block;
		padding: 0 var(--row-inset) 6px;
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		color: var(--ink);
	}
	.row {
		display: flex;
		align-items: center;
		padding: 0 var(--field-inset);
	}
	.tds-text-field:not([data-variant="box"]) .row {
		padding: 0 var(--row-inset);
	}
	.control {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		color: var(--ink);
		font-weight: var(--fw);
	}
	[data-variant="box"] .control {
		min-height: var(--field-box-height);
		padding: var(--field-box-padding);
		border: var(--hairline-width) solid var(--grey-opacity-100);
		border-radius: var(--field-box-radius);
		background: var(--surface-well);
	}
	[data-variant="line"] .control,
	[data-variant="big"] .control {
		padding-bottom: 4px;
		border-bottom: var(--field-underline-width) solid var(--grey-100);
	}
	.control:focus-within {
		border-color: var(--status-info);
	}
	[data-error="true"] .control {
		border-color: var(--status-danger);
	}
	input {
		flex: 1;
		min-width: 0;
		padding: 0;
		border: 0;
		outline: none;
		background: transparent;
		color: inherit;
		font: inherit;
	}
	input::placeholder {
		color: var(--ink-disabled);
	}
	[data-variant="box"] .control:has(input:disabled) {
		background: var(--grey-200);
		color: var(--ink-disabled);
	}
	.affix {
		flex-shrink: 0;
		color: var(--ink);
	}
	.clear {
		display: inline-flex;
		flex-shrink: 0;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
	}
	.clear svg {
		width: 20px;
		height: 20px;
	}
	.clear circle {
		fill: var(--grey-300);
	}
	.clear path {
		stroke: var(--static-white);
		stroke-width: 2;
		stroke-linecap: round;
	}
	.help {
		margin: 0;
		padding: 6px var(--row-inset) 0;
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		font-weight: 400;
		color: var(--ink-subtle);
	}
	[data-error="true"] .help {
		color: var(--status-danger);
	}
</style>
