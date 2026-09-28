<!-- TDS TextArea (components/TextField/text-area).
     Same wrapper as the box TextField (16px 0, row inset 0 20), but the well aligns to the top:
     padding 14px 16px, r14, 0.8px greyOpacity100 on greyOpacity50, 17/25.5 grey800.
     height fixes the box (measured 200); minHeight lets it grow with content (measured 100). -->
<script lang="ts">
	import type { HTMLTextareaAttributes } from "svelte/elements";

	let {
		label,
		help,
		hasError = false,
		value = $bindable(""),
		height,
		minHeight = 100,
		id = `ta-${Math.random().toString(36).slice(2, 8)}`,
		...rest
	}: {
		label?: string;
		help?: string;
		hasError?: boolean;
		value?: string;
		height?: number;
		minHeight?: number;
	} & Omit<HTMLTextareaAttributes, "value"> = $props();
</script>

<div class="tds-text-area" data-tds-mobile-component="TextArea" data-error={hasError}>
	{#if label}<label class="label" for={id}>{label}</label>{/if}
	<div class="row">
		<div class="well" style:height={height ? `${height}px` : undefined} style:min-height={height ? undefined : `${minHeight}px`}>
			<textarea {...rest} {id} bind:value aria-invalid={hasError}></textarea>
		</div>
	</div>
	{#if help}<p class="help" aria-live="off">{help}</p>{/if}
</div>

<style>
	.tds-text-area {
		padding: 16px 0;
	}
	.label {
		display: block;
		padding: 0 var(--row-inset) 6px;
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		color: var(--ink);
	}
	.row {
		padding: 0 var(--field-inset);
	}
	.well {
		display: flex;
		padding: var(--field-box-padding);
		border: var(--hairline-width) solid var(--grey-opacity-100);
		border-radius: var(--field-box-radius);
		background: var(--surface-well);
	}
	.well:focus-within {
		border-color: var(--status-info);
	}
	[data-error="true"] .well {
		border-color: var(--status-danger);
	}
	textarea {
		flex: 1;
		min-height: calc(var(--text-t5--line-height) * 2);
		padding: 0;
		border: 0;
		outline: none;
		resize: none;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		field-sizing: content;
	}
	textarea::placeholder {
		color: var(--ink-disabled);
	}
	.help {
		margin: 0;
		padding: 6px var(--row-inset) 0;
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		color: var(--ink-subtle);
	}
	[data-error="true"] .help {
		color: var(--status-danger);
	}
</style>
