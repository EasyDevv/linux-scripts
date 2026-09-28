<!-- TDS BottomCTA. Bar padding 0 20px 20px on white, 56px solid button.
     The two actions stack with an 8px gap in the Double variant. -->
<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		primary,
		secondary,
	}: { primary: { label: string; onclick?: () => void }; secondary?: { label: string; onclick?: () => void } } =
		$props();

	const solid =
		"display:flex; align-items:center; justify-content:center; width:100%; height:var(--control-height-xl); border:none; border-radius:var(--control-radius-xl); font-size:var(--text-control); font-weight:var(--text-control--font-weight); line-height:var(--control-label-leading); cursor:pointer";
</script>

<div style:padding="0 var(--cta-inset) var(--cta-inset)" style:background="var(--surface-float)">
	{#if secondary}
		<button type="button" style={solid + `; background: var(--surface-hover); color: var(--grey-700);`} onclick={secondary.onclick}>
			{secondary.label}
		</button>
		<div style:height="8px"></div>
	{/if}
	<button type="button" style={solid + `; background: var(--blue-500); color: var(--surface-float);`} onclick={primary.onclick}>
		{primary.label}
	</button>
</div>
