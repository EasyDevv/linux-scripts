<!-- seed-design.io header: logo, centred section nav, theme + search round buttons. -->
<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Moon from "@lucide/svelte/icons/moon";
	import Search from "@lucide/svelte/icons/search";
	import { headerStyle, navLink, roundButton } from "./chrome.ts";

	const SECTIONS = ["Get Started", "Foundations", "Components", "Patterns", "Develop", "AI & Tools", "Updates"];
</script>

<header data-role="app-header" class="absolute inset-x-0 top-0 z-20 flex items-center bg-bg-layer-default" style={headerStyle}>
	<a href="#top" class="flex items-center gap-2" style="height: 40px; color: var(--fg-neutral); text-decoration: none" aria-label="SEED">
		<svg width="36" height="40" viewBox="0 0 36 40" aria-hidden="true">
			<path d="M18 2v36M6 12l24 16M30 12 6 28" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" fill="none" />
		</svg>
		<span style="font-size: 32px; line-height: 40px; font-weight: 600; letter-spacing: -0.5px">SEED</span>
	</a>
	<nav class="absolute left-1/2 flex -translate-x-1/2 items-center" aria-label="Main">
		{#each SECTIONS as label (label)}
			{#if label === "Develop"}
				<button type="button" style="{navLink}; gap: 4px; background: var(--bg-transparent-selected)">{label} <ChevronDown size={12} /></button>
			{:else}
				<a href="#top" style={navLink}>{label}</a>
			{/if}
		{/each}
	</nav>
	<div class="ml-auto flex items-center gap-2">
		<button type="button" aria-label="테마 전환" style={roundButton}><Moon size={18} /></button>
		<button type="button" aria-label="검색" style={roundButton}><Search size={18} /></button>
	</div>
</header>
