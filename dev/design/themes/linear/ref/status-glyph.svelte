<script lang="ts">
	import { boardMark, type BoardTone } from "./chrome.ts";

	/**
	 * Linear issue status glyph, geometry copied from the live app's 14x14 SVGs
	 * (outer ring + inner 4/6-wide stroke circle), used by the board and the list.
	 */
	let { tone, size = 14 }: { tone: BoardTone; size?: number } = $props();

	const ink = $derived(boardMark.statusInk[tone]);
</script>

<svg viewBox="0 0 14 14" width={size} height={size} fill="none" aria-hidden="true">
	{#if tone === "backlog"}
		<circle
			cx="7"
			cy="7"
			r="6"
			stroke={ink}
			stroke-width="1.5"
			stroke-dasharray="1.4 1.74"
			stroke-dashoffset="0.65"
		/>
		<circle
			cx="7"
			cy="7"
			r="2"
			stroke={ink}
			stroke-width="4"
			stroke-dasharray="11.31 22.62"
			stroke-dashoffset="11.31"
			transform="rotate(-90 7 7)"
		/>
	{:else if tone === "duplicate"}
		<circle cx="7" cy="7" r="6" fill={ink} />
		<path d="M4.6 4.6 9.4 9.4" stroke="var(--card)" stroke-width="1.6" stroke-linecap="round" />
	{:else}
		<circle
			cx="7"
			cy="7"
			r="6"
			stroke={ink}
			stroke-width="1.5"
			stroke-dasharray="3.14 0"
			stroke-dashoffset="-0.7"
		/>
		{#if tone === "todo" || tone === "progress"}
			<circle
				cx="7"
				cy="7"
				r="2"
				stroke={ink}
				stroke-width="4"
				stroke-dasharray="11.31 22.62"
				stroke-dashoffset={tone === "progress" ? "5.655" : "11.31"}
				transform="rotate(-90 7 7)"
			/>
		{:else}
			<circle
				cx="7"
				cy="7"
				r="3"
				stroke={ink}
				stroke-width="6"
				stroke-dasharray="18.85 37.7"
				transform="rotate(-90 7 7)"
			/>
			{#if tone === "done"}
				<path
					d="M5 8.4 6.9 10.3 11.1 6"
					stroke="var(--card)"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			{:else}
				<path
					d="M5.9 5.9 10.1 10.1 M10.1 5.9 5.9 10.1"
					stroke="var(--card)"
					stroke-width="2"
					stroke-linecap="round"
				/>
			{/if}
		{/if}
	{/if}
</svg>
