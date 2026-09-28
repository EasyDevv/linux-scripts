<!-- TDS Switch. Track 50x30 r15; thumb 24 on / 16 off, radius 9999px.
     role=switch + aria-checked + aria-disabled is the live contract. -->
<script lang="ts">
	let { checked = $bindable(false), disabled = false }: { checked?: boolean; disabled?: boolean } = $props();
</script>

<label
	role="switch"
	data-tds-mobile-component="Switch"
	aria-checked={checked}
	aria-disabled={disabled}
	style:width="var(--switch-width)"
	style:height="var(--switch-height)"
	style:border-radius="calc(var(--switch-height) / 2)"
	style:background={checked ? "var(--blue-500)" : "var(--grey-200)"}
	style:display="inline-flex"
	style:align-items="center"
	style:position="relative"
	style:border="none"
	style:color="var(--grey-800)"
>
	<input type="checkbox" bind:checked {disabled} style:display="none" />
	<span
		style:position="absolute"
		style:left={checked ? "calc(100% - var(--switch-thumb-on) - 3px)" : "3px"}
		style:top="50%"
		style:translate="0 -50%"
		style:width={checked ? "var(--switch-thumb-on)" : "var(--switch-thumb-off)"}
		style:height={checked ? "var(--switch-thumb-on)" : "var(--switch-thumb-off)"}
		style:border-radius="9999px"
		style:background="var(--surface-float)"
		style:transition="left 0.2s cubic-bezier(0.33, 1, 0.68, 1), width 0.2s cubic-bezier(0.33, 1, 0.68, 1), height 0.2s cubic-bezier(0.33, 1, 0.68, 1)"
	></span>
</label>
