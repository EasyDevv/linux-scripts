<!-- SEED Chip (seed-design.io/react/components/chip).
     type    button (<button>) · toggle (<label> + checkbox) · radio (<label> + radio, bind:group)
     size    small 32 · medium 36 · large 40, pill; label t4 medium
     variant solid (neutral-weak-alpha; checked = neutral-inverted) · outlineStrong · outlineWeak
     slots   prefixIcon / suffixIcon wrappers, prefixAvatar (Avatar 24/28), iconOnly via `icon`. -->
<script lang="ts">
	import type { Component, Snippet } from "svelte";
	import Avatar from "./avatar.svelte";
	import { scaleFeedback, states, variants, visuallyHidden } from "./seed.ts";

	let {
		type = "button",
		checked = $bindable(false),
		group = $bindable(),
		value,
		name,
		variant = "solid",
		size = "medium",
		disabled = false,
		prefixIcon: PrefixIcon,
		suffixIcon: SuffixIcon,
		icon: IconOnly,
		avatar,
		ariaLabel,
		onclick,
		children,
	}: {
		type?: "button" | "toggle" | "radio";
		checked?: boolean;
		/** radio chips: the selected value, shared by every chip of the group */
		group?: string;
		value?: string;
		name?: string;
		variant?: "solid" | "outlineStrong" | "outlineWeak";
		size?: "small" | "medium" | "large";
		disabled?: boolean;
		prefixIcon?: Component;
		suffixIcon?: Component;
		icon?: Component;
		/** prefix avatar image URL */
		avatar?: string;
		ariaLabel?: string;
		onclick?: () => void;
		children?: Snippet;
	} = $props();

	const layout = $derived(IconOnly ? "iconOnly" : "withText");
	const on = $derived(type === "radio" ? group === value : type === "toggle" ? checked : false);
	const v = $derived(variants({ variant, size, layout }));
	const s = $derived(states({ checked: on, disabled }));
</script>

{#snippet body()}
	{#if IconOnly}
		<IconOnly class="seed-icon" aria-hidden="true" />
	{:else}
		{#if PrefixIcon}<div class="seed-chip__prefixIcon" {...v} {...s}><PrefixIcon class="seed-icon" aria-hidden="true" /></div>{/if}
		{#if avatar}<div class="seed-chip__prefixAvatar" {...v} {...s}><Avatar src={avatar} size={size === "large" ? "24" : "24"} /></div>{/if}
		<span class="seed-chip__label" {...v} {...s}>{@render children?.()}</span>
		{#if SuffixIcon}<div class="seed-chip__suffixIcon" {...v} {...s}><SuffixIcon class="seed-icon" aria-hidden="true" /></div>{/if}
	{/if}
{/snippet}

{#if type === "button"}
	<button type="button" class="seed-chip__root seed-scale-feedback" {...v} {...s} {disabled} aria-label={ariaLabel} {onclick} {@attach scaleFeedback}>{@render body()}</button>
{:else}
	<label class="seed-chip__root seed-scale-feedback" {...v} {...s} {@attach scaleFeedback}>
		{@render body()}
		{#if type === "toggle"}
			<input type="checkbox" {name} {value} {disabled} bind:checked aria-label={ariaLabel} style={visuallyHidden} />
		{:else}
			<input type="radio" {name} {value} {disabled} bind:group aria-label={ariaLabel} style={visuallyHidden} />
		{/if}
	</label>
{/if}

<style>
	/* @recipe chip */
	/* SEED recipe: chip */
	:global(.seed-chip__root) {
		position: relative;
		display: inline-flex;
		justify-content: center;
		align-items: center;
		box-sizing: border-box;
		cursor: pointer;
		border: none;
		text-transform: none;
		text-align: start;
		white-space: nowrap;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		font-family: inherit;
		flex-shrink: 0;
		line-height: 1;
		border-radius: var(--radius-full);
	}
	:global(.seed-chip__root:not(:is(:disabled, [disabled], [data-disabled])):is(:active, [data-active])) {
		scale: var(--feedback-scale);
	}
	:global(.seed-chip__root) {
		transition: background-color var(--duration-color-transition) var(--ease-easing), color var(--duration-color-transition) var(--ease-easing), border-color var(--duration-color-transition) var(--ease-easing), box-shadow var(--duration-color-transition) var(--ease-easing), outline-color var(--duration-color-transition) var(--ease-easing), scale var(--duration-pressed-scale) var(--ease-pressed-scale);
		outline: var(--dimension-x0-5) solid transparent;
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-chip__root:is(:focus-visible, [data-focus-visible])) {
		outline: var(--dimension-x0-5) solid var(--stroke-focus-ring);
		outline-offset: var(--dimension-x0-5);
	}
	:global(.seed-chip__root:is(:disabled, [disabled], [data-disabled])) {
		cursor: not-allowed;
	}
	:global(.seed-chip__label) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: var(--font-weight-medium);
		padding-inline: var(--dimension-x1-5);
	}
	:global(.seed-chip__prefixIcon) {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		padding-left: var(--dimension-x1-5);
	}
	:global(.seed-chip__prefixAvatar) {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}
	:global(.seed-chip__suffixIcon) {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		padding-right: var(--dimension-x1-5);
	}
	:global(.seed-chip__root[data-variant="solid"]) {
		background: var(--bg-neutral-weak-alpha);
		--seed-icon-color: var(--fg-neutral);
	}
	:global(.seed-chip__root[data-variant="solid"]:is(:checked, [data-checked])) {
		box-shadow: none;
		background: var(--bg-neutral-inverted);
		--seed-icon-color: var(--fg-neutral-inverted);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-chip__root[data-variant="solid"]:is(:hover, [data-hover]):not(:is(:disabled, [disabled], [data-disabled]))) {
			background: var(--bg-neutral-weak-alpha-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-chip__root[data-variant="solid"]:is(:active, [data-active]):not(:is(:disabled, [disabled], [data-disabled]))) {
			background: var(--bg-neutral-weak-alpha-pressed);
		}
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-chip__root[data-variant="solid"]:is(:checked, [data-checked]):is(:hover, [data-hover]):not(:is(:disabled, [disabled], [data-disabled]))) {
			background: var(--bg-neutral-inverted-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-chip__root[data-variant="solid"]:is(:checked, [data-checked]):is(:active, [data-active]):not(:is(:disabled, [disabled], [data-disabled]))) {
			background: var(--bg-neutral-inverted-pressed);
		}
	}
	:global(.seed-chip__root[data-variant="solid"]:is(:disabled, [disabled], [data-disabled])) {
		opacity: 0.5;
	}
	:global(.seed-chip__label[data-variant="solid"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-chip__label[data-variant="solid"]:is(:checked, [data-checked])) {
		color: var(--fg-neutral-inverted);
	}
	:global(.seed-chip__prefixIcon[data-variant="solid"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-chip__suffixIcon[data-variant="solid"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-chip__root[data-variant="outlineStrong"]) {
		background: var(--bg-transparent);
		box-shadow: inset 0 0 0 1px var(--stroke-neutral-muted);
		--seed-icon-color: var(--fg-neutral);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-chip__root[data-variant="outlineStrong"]:is(:hover, [data-hover]):not(:is(:disabled, [disabled], [data-disabled]))) {
			background: var(--bg-transparent-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-chip__root[data-variant="outlineStrong"]:is(:active, [data-active]):not(:is(:disabled, [disabled], [data-disabled]))) {
			background: var(--bg-transparent-pressed);
		}
	}
	:global(.seed-chip__root[data-variant="outlineStrong"]:is(:checked, [data-checked])) {
		background: var(--bg-neutral-inverted);
		--seed-icon-color: var(--fg-neutral-inverted);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-chip__root[data-variant="outlineStrong"]:is(:checked, [data-checked]):is(:hover, [data-hover]):not(:is(:disabled, [disabled], [data-disabled]))) {
			background: var(--bg-neutral-inverted-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-chip__root[data-variant="outlineStrong"]:is(:checked, [data-checked]):is(:active, [data-active]):not(:is(:disabled, [disabled], [data-disabled]))) {
			background: var(--bg-neutral-inverted-pressed);
		}
	}
	:global(.seed-chip__root[data-variant="outlineStrong"]:is(:disabled, [disabled], [data-disabled])) {
		opacity: 0.5;
	}
	:global(.seed-chip__label[data-variant="outlineStrong"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-chip__label[data-variant="outlineStrong"]:is(:checked, [data-checked])) {
		color: var(--fg-neutral-inverted);
	}
	:global(.seed-chip__prefixIcon[data-variant="outlineStrong"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-chip__suffixIcon[data-variant="outlineStrong"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-chip__root[data-variant="outlineWeak"]) {
		background: var(--bg-transparent);
		box-shadow: inset 0 0 0 1px var(--stroke-neutral-muted);
		--seed-icon-color: var(--fg-neutral);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-chip__root[data-variant="outlineWeak"]:is(:hover, [data-hover]):not(:is(:disabled, [disabled], [data-disabled]))) {
			background: var(--bg-transparent-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-chip__root[data-variant="outlineWeak"]:is(:active, [data-active]):not(:is(:disabled, [disabled], [data-disabled]))) {
			background: var(--bg-transparent-pressed);
		}
	}
	:global(.seed-chip__root[data-variant="outlineWeak"]:is(:checked, [data-checked])) {
		background: var(--bg-neutral-weak);
		box-shadow: inset 0 0 0 1px var(--stroke-neutral-contrast);
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.seed-chip__root[data-variant="outlineWeak"]:is(:checked, [data-checked]):is(:hover, [data-hover]):not(:is(:disabled, [disabled], [data-disabled]))) {
			background: var(--bg-neutral-weak-pressed);
		}
	}
	@media not all and (hover: hover) and (pointer: fine) {
		:global(.seed-chip__root[data-variant="outlineWeak"]:is(:checked, [data-checked]):is(:active, [data-active]):not(:is(:disabled, [disabled], [data-disabled]))) {
			background: var(--bg-neutral-weak-pressed);
		}
	}
	:global(.seed-chip__root[data-variant="outlineWeak"]:is(:disabled, [disabled], [data-disabled])) {
		opacity: 0.5;
	}
	:global(.seed-chip__label[data-variant="outlineWeak"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-chip__prefixIcon[data-variant="outlineWeak"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-chip__suffixIcon[data-variant="outlineWeak"]) {
		color: var(--fg-neutral);
	}
	:global(.seed-chip__root[data-size="large"]) {
		height: 40px;
		padding-inline: var(--dimension-x2-5);
		--seed-icon-size: var(--dimension-x4);
	}
	:global(.seed-chip__label[data-size="large"]) {
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
	}
	:global(.seed-chip__prefixIcon[data-size="large"]) {
		--seed-icon-size: var(--dimension-x4);
	}
	:global(.seed-chip__suffixIcon[data-size="large"]) {
		--seed-icon-size: var(--dimension-x4);
	}
	:global(.seed-chip__root[data-size="medium"]) {
		height: 36px;
		padding-inline: var(--dimension-x2);
		--seed-icon-size: var(--dimension-x4);
	}
	:global(.seed-chip__label[data-size="medium"]) {
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
	}
	:global(.seed-chip__prefixIcon[data-size="medium"]) {
		--seed-icon-size: var(--dimension-x4);
	}
	:global(.seed-chip__suffixIcon[data-size="medium"]) {
		--seed-icon-size: var(--dimension-x3-5);
	}
	:global(.seed-chip__root[data-size="small"]) {
		height: 32px;
		padding-inline: var(--dimension-x1-5);
		--seed-icon-size: var(--dimension-x3-5);
	}
	:global(.seed-chip__label[data-size="small"]) {
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
	}
	:global(.seed-chip__prefixIcon[data-size="small"]) {
		--seed-icon-size: var(--dimension-x3-5);
	}
	:global(.seed-chip__suffixIcon[data-size="small"]) {
		--seed-icon-size: var(--dimension-x3-5);
	}
	:global(.seed-chip__root[data-size="small"][data-layout="withText"]) {
		min-width: 44px;
	}
	:global(.seed-chip__root[data-size="medium"][data-layout="withText"]) {
		min-width: var(--dimension-x12);
	}
	:global(.seed-chip__root[data-size="large"][data-layout="withText"]) {
		min-width: var(--dimension-x13);
	}
	:global(.seed-chip__root[data-size="small"][data-layout="iconOnly"]) {
		min-width: var(--dimension-x8);
	}
	:global(.seed-chip__root[data-size="medium"][data-layout="iconOnly"]) {
		min-width: var(--dimension-x9);
	}
	:global(.seed-chip__root[data-size="large"][data-layout="iconOnly"]) {
		min-width: var(--dimension-x10);
	}
	/* @end recipe */
</style>
