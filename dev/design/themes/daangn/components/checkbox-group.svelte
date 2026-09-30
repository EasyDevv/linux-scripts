<!-- SEED CheckboxGroup: a Field (role=group) whose control is the vertical .seed-checkbox-group stack. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import Field from "./field.svelte";
	import { nextId } from "./seed.ts";

	let {
		label,
		labelWeight,
		indicator,
		required,
		description,
		errorMessage,
		ariaLabel,
		children,
	}: {
		label?: string;
		labelWeight?: "medium" | "bold";
		indicator?: string;
		required?: boolean;
		description?: string;
		errorMessage?: string;
		ariaLabel?: string;
		children: Snippet;
	} = $props();
	const labelId = nextId("fieldset-label");
</script>

<Field role="group" {label} {labelWeight} {labelId} {indicator} {required} {description} {errorMessage} invalid={!!errorMessage} {ariaLabel}>
	<div class="seed-checkbox-group">{@render children()}</div>
</Field>

<style>
	/* @recipe checkbox-group */
	/* SEED recipe: checkbox-group */
	:global(.seed-checkbox-group) {
		display: flex;
		flex-direction: column;
		gap: var(--dimension-x1);
	}
	/* @end recipe */
</style>
