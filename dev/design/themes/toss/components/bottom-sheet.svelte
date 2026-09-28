<!-- TDS BottomSheet. White surface, 16px padding, 56px primary button in the header,
     rgba(0,0,0,.56) scrim. Wrap in shadcn Dialog with side="bottom" and this body. -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import Button from "./button.svelte";

	let { title, description, children }: { title: string; description?: string; children: Snippet } = $props();
</script>

<div style:padding="16px" style:background="var(--surface-float)" style:border-radius="var(--radius) var(--radius) 0 0">
	<div style:display="grid" style:gap="8px">
		<h2 style:margin="0" style:font-size="var(--text-heading)" style:line-height="var(--text-heading--line-height)" style:font-weight="600">
			{title}
		</h2>
		{#if description}
			<p
				style:margin="0"
				style:font-size="var(--text-body-sm)"
				style:line-height="var(--text-body-sm--line-height)"
				style:color="var(--grey-600)"
			>
				{description}
			</p>
		{/if}
	</div>
	<div style:margin-top="16px">{@render children()}</div>
	<div style:margin-top="16px"><Button onclick={() => {}}>확인</Button></div>
</div>
