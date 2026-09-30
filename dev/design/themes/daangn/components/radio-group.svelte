<!-- SEED RadioGroup (seed-design.io/react/components/radio-group): a Field (role=radiogroup)
     over .seed-radio-group; each item is a <label> with a radiomark (20 / 24, 1px stroke; checked =
     tone fill + inner dot), a label (t4 / t5, regular | bold) and a visually hidden radio input. -->
<script lang="ts">
	import { nextId, scaleFeedback, states, variants, visuallyHidden } from "./seed.ts";

	import type { Snippet } from "svelte";
	type Item = { value: string; label: string; disabled?: boolean; size?: "medium" | "large"; tone?: "brand" | "neutral"; weight?: "regular" | "bold" };
	let {
		value = $bindable(),
		items,
		size = "medium",
		tone = "brand",
		weight = "regular",
		disabled = false,
		label,
		labelWeight,
		indicator,
		required,
		description,
		errorMessage,
		ariaLabel,
		name = nextId("radio"),
		custom,
	}: {
		value?: string;
		items: Item[];
		size?: "medium" | "large";
		tone?: "brand" | "neutral";
		weight?: "regular" | "bold";
		disabled?: boolean;
		label?: string;
		labelWeight?: "medium" | "bold";
		indicator?: string;
		required?: boolean;
		description?: string;
		errorMessage?: string;
		ariaLabel?: string;
		name?: string;
		/** custom item body (Radiomark + your own label), stacked like the docs' CustomRadioGroupItem */
		custom?: Snippet<[Item]>;
	} = $props();

	import Field from "./field.svelte";
	const labelId = nextId("fieldset-label");
</script>

{#snippet list()}
		{#each items as item (item.value)}
			{@const s = states({ checked: value === item.value, disabled: disabled || item.disabled })}
			{@const iv = { size: item.size ?? size, tone: item.tone ?? tone, weight: item.weight ?? weight }}
			<label class={custom ? undefined : "seed-radio__root"} {...variants({ size: iv.size, weight: iv.weight })} {...s} style={custom ? "display: flex; flex-direction: column; align-items: center; gap: var(--dimension-x2)" : undefined}>
				<div class="seed-radiomark__root seed-scale-feedback" {...variants({ tone: iv.tone, size: iv.size })} {...s} aria-hidden="true" {@attach scaleFeedback}>
					{#if value === item.value}
						<svg class="seed-radiomark__icon" {...variants({ tone: iv.tone, size: iv.size })} {...s} aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="currentColor" /></svg>
					{/if}
				</div>
				{#if custom}{@render custom(item)}{:else}<span class="seed-radio__label" {...variants({ size: iv.size, weight: iv.weight })} {...s}>{item.label}</span>{/if}
				<input type="radio" {name} value={item.value} bind:group={value} disabled={disabled || item.disabled} style={visuallyHidden} />
			</label>
		{/each}
{/snippet}

{#if custom}
	<!-- custom items: bare radiogroup + row, like the docs' RadioGroup.Root + HStack gap x6 -->
	<div role="radiogroup" aria-label={ariaLabel}><div style="display: flex; gap: var(--dimension-x6)">{@render list()}</div></div>
{:else}
	<Field role="radiogroup" {label} {labelWeight} {labelId} {indicator} {required} {description} {errorMessage} invalid={!!errorMessage} {ariaLabel} {disabled}>
		<div class="seed-radio-group">{@render list()}</div>
	</Field>
{/if}

<style>
	/* @recipe radio-group, radio, radiomark */
	/* SEED recipe: radio-group */
	:global(.seed-radio-group) {
		display: flex;
		flex-direction: column;
		gap: var(--dimension-x1);
	}

	/* SEED recipe: radio */
	:global(.seed-radio__root) {
		display: inline-flex;
		align-items: flex-start;
		position: relative;
		max-width: 100%;
		vertical-align: top;
		isolation: isolate;
		cursor: pointer;
		gap: var(--dimension-x2);
	}
	:global(.seed-radio__root:is(:disabled, [disabled], [data-disabled])) {
		cursor: not-allowed;
	}
	:global(.seed-radio__label) {
		color: var(--fg-neutral);
	}
	:global(.seed-radio__label:is(:disabled, [disabled], [data-disabled])) {
		color: var(--fg-disabled);
	}
	:global(.seed-radio__label[data-weight="regular"]) {
		font-weight: var(--font-weight-regular);
	}
	:global(.seed-radio__label[data-weight="bold"]) {
		font-weight: var(--font-weight-bold);
	}
	:global(.seed-radio__root[data-size="large"]) {
		min-height: var(--dimension-x9);
		--radiomark-margin-top: calc((var(--dimension-x9) - var(--dimension-x6)) / 2);
	}
	:global(.seed-radio__label[data-size="large"]) {
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		margin-top: calc(var(--dimension-x9) / 2 - var(--text-t5--line-height) / 2);
	}
	:global(.seed-radio__root[data-size="medium"]) {
		min-height: var(--dimension-x8);
		--radiomark-margin-top: calc((var(--dimension-x8) - var(--dimension-x5)) / 2);
	}
	:global(.seed-radio__label[data-size="medium"]) {
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
		margin-top: calc(var(--dimension-x8) / 2 - var(--text-t4--line-height) / 2);
	}

	/* SEED recipe: radiomark */
	:global(.seed-radiomark__root) {
		border-style: solid;
		box-sizing: border-box;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		border-width: 1px;
		border-color: var(--stroke-neutral-weak);
		border-radius: var(--radius-full);
		margin-top: var(--radiomark-margin-top, 0);
	}
	:global(.seed-radiomark__root:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
		scale: var(--seed-radiomark-feedback-scale, var(--feedback-scale));
	}
	:global(.seed-radiomark__root) {
		transition: background-color var(--duration-color-transition) var(--ease-easing), scale var(--duration-pressed-scale) var(--ease-pressed-scale), outline-color var(--duration-d3) var(--ease-easing);
		outline: var(--seed-focus-ring, var(--dimension-x0-5) solid transparent);
		outline-offset: var(--dimension-x0-5);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-radiomark__root:not(:is(:disabled, [disabled], [data-disabled])):is(:hover, [data-hover])) {
			background-color: var(--bg-transparent-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-radiomark__root:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
			background-color: var(--bg-transparent-pressed);
		}
	}
	:global(.seed-radiomark__root:is(:checked, [data-checked])) {
		border-width: 0px;
	}
	:global(.seed-radiomark__root:is(:disabled, [disabled], [data-disabled])) {
		background-color: var(--palette-gray-300);
	}
	:global(.seed-radiomark__root:is(:disabled, [disabled], [data-disabled]):is(:checked, [data-checked])) {
		background-color: var(--bg-transparent);
		border-width: 1px;
		border-color: var(--palette-gray-300);
	}
	:global(.seed-radiomark__root:is(:focus-visible, [data-focus-visible])) {
		outline: var(--seed-focus-ring, var(--dimension-x0-5) solid var(--stroke-focus-ring));
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-radiomark__icon) {
		display: none;
		border-radius: var(--radius-full);
	}
	:global(.seed-radiomark__icon:is(:checked, [data-checked])) {
		display: block;
	}
	:global(.seed-radiomark__icon:is(:disabled, [disabled], [data-disabled]):is(:checked, [data-checked])) {
		color: var(--palette-gray-300);
	}
	:global(.seed-radiomark__root[data-tone="neutral"]:is(:checked, [data-checked])) {
		background-color: var(--bg-neutral-inverted);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-radiomark__root[data-tone="neutral"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, [data-checked]):is(:hover, [data-hover])) {
			background-color: var(--bg-neutral-inverted-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-radiomark__root[data-tone="neutral"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, [data-checked]):is(:active, [data-active])) {
			background-color: var(--bg-neutral-inverted-pressed);
		}
	}
	:global(.seed-radiomark__icon[data-tone="neutral"]:is(:checked, [data-checked])) {
		color: var(--fg-neutral-inverted);
	}
	:global(.seed-radiomark__root[data-tone="brand"]:is(:checked, [data-checked])) {
		background-color: var(--bg-brand-solid);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-radiomark__root[data-tone="brand"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, [data-checked]):is(:hover, [data-hover])) {
			background-color: var(--bg-brand-solid-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-radiomark__root[data-tone="brand"]:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, [data-checked]):is(:active, [data-active])) {
			background-color: var(--bg-brand-solid-pressed);
		}
	}
	:global(.seed-radiomark__icon[data-tone="brand"]:is(:checked, [data-checked])) {
		color: var(--palette-static-white);
	}
	:global(.seed-radiomark__root[data-size="large"]) {
		width: var(--dimension-x6);
		height: var(--dimension-x6);
	}
	:global(.seed-radiomark__icon[data-size="large"]) {
		width: var(--dimension-x2-5);
		height: var(--dimension-x2-5);
	}
	:global(.seed-radiomark__icon[data-size="large"]:is(:disabled, [disabled], [data-disabled])) {
		width: var(--dimension-x3);
		height: var(--dimension-x3);
	}
	:global(.seed-radiomark__root[data-size="medium"]) {
		width: var(--dimension-x5);
		height: var(--dimension-x5);
	}
	:global(.seed-radiomark__icon[data-size="medium"]) {
		width: var(--dimension-x2);
		height: var(--dimension-x2);
	}
	:global(.seed-radiomark__icon[data-size="medium"]:is(:disabled, [disabled], [data-disabled])) {
		width: var(--dimension-x2-5);
		height: var(--dimension-x2-5);
	}
	/* @end recipe */
</style>
