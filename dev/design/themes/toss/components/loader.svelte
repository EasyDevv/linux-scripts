<!-- TDS Loader (components/loader). role=image, aria-label "로딩 중", aria-live polite.
     size   small 48 box / 24 ring · medium 60 / 36 · large 80 / 48 (ring = box minus 12/16px margins)
     ring   SVG circle, stroke 6 on a 66 viewBox, round caps, rotating arc
     type   primary blue500 · dark grey600 · light white (place it on a dark or photo surface)
     label  15/22.5 grey800 under the ring, margin-top 2, centred -->
<script lang="ts">
	let {
		size = "medium",
		type = "primary",
		label,
	}: { size?: "small" | "medium" | "large"; type?: "primary" | "dark" | "light"; label?: string } = $props();
</script>

<div class="tds-loader" data-tds-mobile-component="Loader" data-size={size} data-type={type} role="img" aria-label={label ?? "로딩 중"} aria-live="polite">
	<svg viewBox="0 0 66 66" aria-hidden="true"><circle cx="33" cy="33" r="27" /></svg>
	{#if label}<span class="label">{label}</span>{/if}
</div>

<style>
	.tds-loader {
		--box: 60px;
		--m: 12px;
		--c: var(--blue-500);
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		min-width: var(--box);
	}
	.tds-loader[data-size="small"] {
		--box: 48px;
	}
	.tds-loader[data-size="large"] {
		--box: 80px;
		--m: 16px;
	}
	.tds-loader[data-type="dark"] {
		--c: var(--grey-600);
	}
	.tds-loader[data-type="light"] {
		--c: var(--static-white);
	}
	svg {
		width: calc(var(--box) - var(--m) * 2);
		height: calc(var(--box) - var(--m) * 2);
		margin: var(--m);
		animation: tds-loader-spin 1.4s linear infinite;
	}
	circle {
		fill: none;
		stroke: var(--c);
		stroke-width: 6;
		stroke-linecap: round;
		stroke-dasharray: 120 170;
		animation: tds-loader-dash 1.4s ease-in-out infinite;
		transform-origin: center;
	}
	.label {
		margin-top: 2px;
		color: var(--ink);
		font-size: var(--text-t6);
		line-height: var(--text-t6--line-height);
		text-align: center;
		white-space: pre-line;
	}
	@keyframes tds-loader-spin {
		to {
			rotate: 360deg;
		}
	}
	@keyframes tds-loader-dash {
		0% {
			stroke-dasharray: 1 170;
			stroke-dashoffset: 0;
		}
		50% {
			stroke-dasharray: 120 170;
			stroke-dashoffset: -30;
		}
		100% {
			stroke-dasharray: 120 170;
			stroke-dashoffset: -160;
		}
	}
</style>
