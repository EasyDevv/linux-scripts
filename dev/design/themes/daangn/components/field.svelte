<!-- SEED Field / Fieldset frame (seed-design.io/react/components/field): header label
     (t5, weight medium | bold) + optional indicator text (t4 subtle) and required mark, the control,
     then a footer with description (t3 subtle) or an error message (critical + alert icon) and an
     optional character count. `labelFor` renders a <label for>; without it the header label is a
     <div> and the root is a role=group / radiogroup fieldset like CheckboxGroup / RadioGroup. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { glyph, states, variants } from "./seed.ts";

	let {
		label,
		labelWeight = "medium",
		labelFor,
		labelId,
		indicator,
		required = false,
		description,
		errorMessage,
		invalid = false,
		disabled = false,
		readonly = false,
		count,
		max,
		role,
		ariaLabel,
		children,
	}: {
		label?: string;
		labelWeight?: "medium" | "bold";
		/** id of the control this label names; renders a <label for> */
		labelFor?: string;
		labelId?: string;
		/** trailing "(선택)" style indicator text */
		indicator?: string;
		/** show the red required mark */
		required?: boolean;
		description?: string;
		errorMessage?: string;
		invalid?: boolean;
		disabled?: boolean;
		readonly?: boolean;
		/** character count footer: current / max */
		count?: number;
		max?: number;
		role?: "group" | "radiogroup";
		ariaLabel?: string;
		children: Snippet;
	} = $props();

	const s = $derived(states({ disabled, invalid, readonly }));
	const showError = $derived(!!errorMessage && invalid);
	const footer = $derived(!!description || showError || max !== undefined);
</script>

{#snippet labelBody()}
	{label}{#if required}<svg class="seed-field-label__indicatorIcon" viewBox="0 0 6 6" fill="none" aria-hidden="true"><path d={glyph.required} fill="currentColor" /></svg>{/if}{#if indicator}<span class="seed-field-label__indicatorText" {...variants({ weight: labelWeight })}>{indicator}</span>{/if}
{/snippet}

<div class="seed-field__root" {role} aria-label={ariaLabel} aria-labelledby={!ariaLabel && label ? labelId : undefined} {...s}>
	{#if label || indicator}
		<div class="seed-field__header" {...s}>
			{#if labelFor}
				<label class="seed-field-label__root" id={labelId} for={labelFor} {...variants({ weight: labelWeight })} {...s}>{@render labelBody()}</label>
			{:else}
				<div class="seed-field-label__root" id={labelId} {...variants({ weight: labelWeight })} {...s}>{@render labelBody()}</div>
			{/if}
		</div>
	{/if}
	{@render children()}
	{#if footer}
		<div class="seed-field__footer" {...s}>
			{#if description}
				<span class="seed-field__description" {...s} style={showError ? "position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)" : undefined}>{description}</span>
			{/if}
			{#if showError}
				<div class="seed-field__errorMessage" {...s} aria-live="polite">
					<svg class="seed-prefix-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={glyph.alert} fill="currentColor" /></svg>
					{errorMessage}
				</div>
			{/if}
			{#if max !== undefined}
				<div class="seed-field__characterCountArea">
					<span class="seed-field__characterCount" data-empty={count === 0 ? "" : undefined} data-exceeded={(count ?? 0) > max ? "" : undefined} {...s}>{count ?? 0}</span>
					<span class="seed-field__maxCharacterCount" {...s}>/{max}</span>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* @recipe field, field-label */
	/* SEED recipe: field */
	:global(.seed-field__root) {
		display: flex;
		flex-direction: column;
		width: 100%;
		position: relative;
		gap: var(--dimension-x2);
	}
	:global(.seed-field__header) {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding-inline: var(--dimension-x0-5);
		gap: var(--dimension-x2-5);
	}
	:global(.seed-field__footer) {
		display: flex;
		align-items: flex-start;
		padding-inline: var(--dimension-x0-5);
		gap: var(--dimension-x2);
	}
	:global(.seed-field__description) {
		display: flex;
		color: var(--fg-neutral-subtle);
		font-weight: var(--font-weight-regular);
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
		--seed-prefix-icon-size: var(--dimension-x4);
		--seed-prefix-icon-color: var(--fg-neutral-subtle);
		--seed-prefix-icon-margin-right: var(--dimension-x1-5);
		--seed-prefix-icon-margin-top: calc((var(--text-t4--line-height) - var(--dimension-x4)) / 2);
	}
	:global(.seed-field__errorMessage) {
		display: flex;
		color: var(--fg-critical);
		font-weight: var(--font-weight-regular);
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
		--seed-prefix-icon-size: var(--dimension-x4);
		--seed-prefix-icon-color: var(--fg-critical);
		--seed-prefix-icon-margin-right: var(--dimension-x1-5);
		--seed-prefix-icon-margin-top: calc((var(--text-t4--line-height) - var(--dimension-x4)) / 2);
	}
	:global(.seed-field__characterCountArea) {
		margin-left: auto;
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
	}
	:global(.seed-field__characterCount) {
		color: var(--fg-neutral);
		font-weight: var(--font-weight-regular);
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
	}
	:global(.seed-field__characterCount[data-empty]:not(:is(:invalid, [data-invalid]))) {
		color: var(--fg-neutral-subtle);
	}
	:global(.seed-field__characterCount:is(:invalid, [data-invalid])) {
		color: var(--fg-critical);
	}
	:global(.seed-field__maxCharacterCount) {
		color: var(--fg-neutral-subtle);
		font-weight: var(--font-weight-regular);
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
	}
	:global(.seed-field__maxCharacterCount:is(:invalid, [data-invalid])) {
		color: var(--fg-critical);
	}

	/* SEED recipe: field-label */
	:global(.seed-field-label__root) {
		color: var(--fg-neutral);
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
	}
	:global(.seed-field-label__indicatorText) {
		display: inline;
		vertical-align: bottom;
		padding-left: clamp(calc(4px * var(--font-size-limit-min)), 0.25rem, calc(4px * var(--font-size-limit-max)));
		color: var(--fg-neutral-subtle);
		font-size: var(--text-t4);
		line-height: var(--text-t5--line-height);
		font-weight: var(--font-weight-regular);
	}
	:global(.seed-field-label__indicatorIcon) {
		display: inline;
		vertical-align: top;
		width: clamp(calc(6px * var(--font-size-limit-min)), 0.375rem, calc(6px * var(--font-size-limit-max)));
		height: clamp(calc(6px * var(--font-size-limit-min)), 0.375rem, calc(6px * var(--font-size-limit-max)));
		margin-top: clamp(calc(4px * var(--font-size-limit-min)), 0.25rem, calc(4px * var(--font-size-limit-max)));
		margin-left: clamp(calc(2px * var(--font-size-limit-min)), 0.125rem, calc(2px * var(--font-size-limit-max)));
		color: var(--fg-critical);
	}
	:global(.seed-field-label__root[data-weight="medium"]) {
		font-weight: var(--font-weight-medium);
	}
	:global(.seed-field-label__root[data-weight="bold"]) {
		font-weight: var(--font-weight-bold);
	}
	/* @end recipe */
</style>
