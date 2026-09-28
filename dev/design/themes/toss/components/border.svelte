<!-- TDS Border (components/border). role=presentation hr.
     full       1px hairline, edge to edge (항목 나누기)
     padding24  1px hairline starting at x 24 (왼쪽에 여백주기)
     height16   16px grey100 band between sections (구간 나누기); height overrides it -->
<script lang="ts">
	let { variant = "full", height }: { variant?: "full" | "padding24" | "height16"; height?: string } = $props();
</script>

<hr class="tds-border" data-tds-mobile-component="Border" data-variant={variant} role="presentation" style:height />

<style>
	.tds-border {
		width: auto;
		height: 1px;
		margin: 0;
		border: 0;
		background: var(--hairline);
	}
	[data-variant="padding24"] {
		margin-left: var(--row-inset);
	}
	[data-variant="height16"] {
		height: var(--section-divider-height);
		background: var(--grey-100);
	}
</style>
