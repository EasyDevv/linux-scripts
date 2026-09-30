<!-- SEED CheckSelectBox / RadioSelectBox (seed-design.io/react/components/select-box).
     A Field over .seed-select-box-group (grid, --seed-select-box-group--columns; >1 column makes items
     vertical). Each item: r12 box, 1px stroke that turns 2px neutral-contrast when checked (::after),
     prefix icon, label t5 bold + description t4, a suffix (checkmark / radiomark / text) and an
     optional footer shown when-selected | when-not-selected | always. -->
<script lang="ts">
	import type { Component } from "svelte";
	import Badge from "./badge.svelte";
	import Field from "./field.svelte";
	import Text from "./text.svelte";
	import { collapsibleHeight, glyph, nextId, scaleFeedback, states, variants, visuallyHidden } from "./seed.ts";

	type Item = {
		value: string;
		label: string;
		description?: string;
		prefixIcon?: Component;
		/** "mark" = checkmark / radiomark (default), a string = trailing text, "none" = nothing */
		suffix?: "mark" | "none" | string;
		badge?: string;
		layout?: "horizontal" | "vertical";
		footer?: string;
		footerVisibility?: "when-selected" | "when-not-selected" | "always";
		/** footer text style / bottom padding (docs: t3Medium + x5, or t4Medium + x4) */
		footerStyle?: string;
		footerPad?: string;
		disabled?: boolean;
	};
	let {
		type = "check",
		value = $bindable(type === "check" ? [] : undefined),
		items,
		columns = 1,
		label,
		labelWeight,
		required,
		indicator,
		description,
		errorMessage,
		ariaLabel,
		name = nextId("select-box"),
	}: {
		type?: "check" | "radio";
		/** check: string[] of checked values · radio: the selected value */
		value?: string[] | string;
		items: Item[];
		columns?: number;
		label?: string;
		labelWeight?: "medium" | "bold";
		required?: boolean;
		indicator?: string;
		description?: string;
		errorMessage?: string;
		ariaLabel?: string;
		name?: string;
	} = $props();

	const isOn = (v: string) => (Array.isArray(value) ? value.includes(v) : value === v);
	function toggle(v: string) {
		if (type === "radio") value = v;
		else value = isOn(v) ? (value as string[]).filter((x) => x !== v) : [...(value as string[]), v];
	}
	const labelId = nextId("fieldset-label");
</script>

<Field role={type === "radio" ? "radiogroup" : "group"} {label} {labelWeight} {required} {labelId} {indicator} {description} {errorMessage} invalid={!!errorMessage} {ariaLabel}>
	<div class="seed-select-box-group" data-columns={columns} style="--seed-select-box-group--columns: {columns}">
		{#each items as item (item.value)}
			{@const on = isOn(item.value)}
			{@const s = states({ checked: on, disabled: item.disabled })}
			{@const v = variants({ layout: item.layout ?? (columns === 1 ? "horizontal" : "vertical") })}
			{@const footerOpen = item.footerVisibility === "always" || (item.footerVisibility === "when-not-selected" ? !on : on)}
			<label class="seed-select-box__root" {...v} {...s} {@attach scaleFeedback}>
				<div class="seed-select-box__trigger" {...v} {...s}>
					<input type={type === "radio" ? "radio" : "checkbox"} {name} value={item.value} checked={on} disabled={item.disabled} onchange={() => toggle(item.value)} style={visuallyHidden} />
					<div class="seed-select-box__content" {...v} {...s}>
						{#if item.prefixIcon}<item.prefixIcon class="seed-prefix-icon" aria-hidden="true" />{/if}
						<div class="seed-select-box__body" {...v} {...s}>
							<div class="seed-select-box__label" {...v} {...s}>{item.label}{#if item.badge}<Badge tone="brand" variant="solid">{item.badge}</Badge>{/if}</div>
							{#if item.description}<div class="seed-select-box__description" {...v} {...s}>{item.description}</div>{/if}
						</div>
					</div>
					{#if (item.suffix ?? "mark") === "mark"}
						{#if type === "radio"}
							<div class="seed-radiomark__root seed-scale-feedback" data-tone="neutral" data-size="medium" {...s} aria-hidden="true" {@attach scaleFeedback}>
								{#if on}<svg class="seed-radiomark__icon" data-tone="neutral" data-size="medium" {...s} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="currentColor" /></svg>{/if}
							</div>
						{:else}
							<div class="seed-select-box-checkmark__root" {...s} aria-hidden="true">
								<svg class="seed-select-box-checkmark__icon" {...s} viewBox="0 0 24 24" aria-hidden="true"><path d={glyph.check} fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
							</div>
						{/if}
					{:else if item.suffix !== "none"}
						<div style="flex-shrink: 0"><Text textStyle="t4Medium" color="--fg-neutral">{item.suffix}</Text></div>
					{/if}
				</div>
				{#if item.footer}
					{#if item.footerVisibility === "always"}
						<div class="seed-select-box__footer" {...v}>
							<div style="padding: 0 var(--dimension-x5) {item.footerPad ?? 'var(--dimension-x5)'}"><Text textStyle={item.footerStyle ?? "t3Medium"}>{item.footer}</Text></div>
						</div>
					{:else}
						<div class="seed-select-box__footer" {...v} data-collapsible="" data-state={footerOpen ? "open" : "closed"} hidden={!footerOpen} {@attach collapsibleHeight}>
							<div style="padding: 0 var(--dimension-x5) {item.footerPad ?? 'var(--dimension-x5)'}"><Text textStyle={item.footerStyle ?? "t3Medium"}>{item.footer}</Text></div>
						</div>
					{/if}
				{/if}
			</label>
		{/each}
	</div>
</Field>

<style>
	/* @recipe select-box-group, select-box, select-box-checkmark, radiomark */
	/* SEED recipe: select-box-group */
	:global(.seed-select-box-group) {
		display: grid;
		width: 100%;
		grid-template-columns: repeat(var(--seed-select-box-group--columns, 1), minmax(0, 1fr));
		row-gap: var(--spacing-component-default);
		column-gap: var(--dimension-x3);
	}
	:global(.seed-select-box-group:not([data-columns='1'])) {
		grid-auto-rows: 1fr;
	}

	/* SEED recipe: select-box */
	:global(.seed-select-box__root) {
		cursor: pointer;
		position: relative;
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-r3);
		background-color: var(--bg-transparent);
		box-shadow: inset 0 0 0 1px var(--stroke-neutral-weak);
		transition: background-color var(--duration-color-transition) var(--ease-easing), outline-color var(--duration-d3) var(--ease-easing);
		overflow: hidden;
	}
	:global(.seed-select-box__root::after) {
		content: "";
		position: absolute;
		inset: 0;
		border-radius: inherit;
		border-style: solid;
		border-color: transparent;
		border-width: 2px;
		transition: border-color 0.1s var(--ease-easing);
		pointer-events: none;
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-select-box__root:not(:is(:disabled, [disabled], [data-disabled])):is(:hover, [data-hover])) {
			background-color: var(--bg-transparent-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-select-box__root:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
			background-color: var(--bg-transparent-pressed);
		}
	}
	:global(.seed-select-box__root:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, [data-checked])::after) {
		border-width: 2px;
		border-color: var(--stroke-neutral-contrast);
	}
	:global(.seed-select-box__root:is(:disabled, [disabled], [data-disabled])) {
		cursor: not-allowed;
		box-shadow: inset 0 0 0 1px var(--stroke-neutral-weak);
	}
	:global(.seed-select-box__root:is(:disabled, [disabled], [data-disabled]):is(:checked, [data-checked])) {
		box-shadow: inset 0 0 0 2px var(--stroke-neutral-weak);
	}
	:global(.seed-select-box__root) {
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-select-box__root:is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-select-box__trigger) {
		display: flex;
		justify-content: space-between;
		gap: var(--dimension-x1-5);
		flex-grow: 1;
		--seed-focus-ring: none;
	}
	:global(.seed-select-box__content) {
		display: flex;
		--seed-prefix-icon-size: 22px;
		--seed-prefix-icon-color: var(--fg-neutral);
	}
	:global(.seed-select-box__content:is(:disabled, [disabled], [data-disabled])) {
		--seed-prefix-icon-color: var(--fg-disabled);
	}
	:global(.seed-select-box__body) {
		display: flex;
		flex-direction: column;
		gap: var(--dimension-x0-5);
		margin-right: auto;
	}
	:global(.seed-select-box__label) {
		display: flex;
		align-items: center;
		gap: var(--dimension-x1);
		justify-content: flex-start;
		color: var(--fg-neutral);
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		font-weight: var(--font-weight-medium);
	}
	:global(.seed-select-box__label:is(:disabled, [disabled], [data-disabled])) {
		color: var(--fg-disabled);
	}
	:global(.seed-select-box__description) {
		color: var(--fg-neutral-muted);
		font-size: var(--text-t3);
		line-height: var(--text-t3--line-height);
		font-weight: var(--font-weight-regular);
	}
	:global(.seed-select-box__description:is(:disabled, [disabled], [data-disabled])) {
		color: var(--fg-disabled);
	}
	:global(.seed-select-box__footer[data-collapsible]) {
		overflow: hidden;
		height: 0;
		opacity: 0;
		transition: height var(--duration-d6) var(--ease-easing), opacity 400ms var(--ease-easing);
	}
	:global(.seed-select-box__footer[data-collapsible]:is([data-state="open"], [data-open])) {
		height: var(--collapsible-content-height);
		opacity: 1;
		transition: height 400ms var(--ease-easing), opacity var(--duration-d6) var(--ease-easing);
	}
	:global(.seed-select-box__trigger[data-layout="horizontal"]) {
		align-items: center;
		padding-left: var(--dimension-x5);
		padding-right: var(--dimension-x4);
		padding-block: var(--dimension-x4);
	}
	:global(.seed-select-box__content[data-layout="horizontal"]) {
		align-items: center;
		gap: var(--dimension-x3);
	}
	:global(.seed-select-box__trigger[data-layout="vertical"]) {
		padding-inline: var(--dimension-x4);
		padding-block: var(--dimension-x5);
	}
	:global(.seed-select-box__content[data-layout="vertical"]) {
		flex-direction: column;
		gap: var(--dimension-x2-5);
	}

	/* SEED recipe: select-box-checkmark */
	:global(.seed-select-box-checkmark__root) {
		position: relative;
		box-sizing: border-box;
		flex: none;
		width: var(--dimension-x5);
		height: var(--dimension-x5);
	}
	:global(.seed-select-box-checkmark__icon) {
		display: block;
		position: absolute;
		margin: auto;
		inset: 0;
		text-align: center;
		overflow: initial;
		width: 15px;
		height: 15px;
		color: var(--fg-placeholder);
		transition: color var(--duration-color-transition) var(--ease-easing);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-select-box-checkmark__icon:not(:is(:disabled, [disabled], [data-disabled])):is(:hover, [data-hover])) {
			color: var(--fg-neutral-subtle);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-select-box-checkmark__icon:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
			color: var(--fg-neutral-subtle);
		}
	}
	:global(.seed-select-box-checkmark__icon:not(:is(:disabled, [disabled], [data-disabled])):is(:checked, [data-checked])) {
		color: var(--fg-neutral);
	}
	:global(.seed-select-box-checkmark__icon:is(:disabled, [disabled], [data-disabled])) {
		color: var(--fg-disabled);
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
