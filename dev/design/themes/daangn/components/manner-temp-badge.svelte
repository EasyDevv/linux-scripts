<!-- SEED MannerTempBadge: the temperature as a tinted pill (manner-temp-l{n}-bg / -text). -->
<script lang="ts">
	let { temperature, level }: { temperature: number; level?: string } = $props();
	const BOUNDS = [30, 36, 36.5, 37, 40, 45, 55, 65, 80];
	const lv = $derived(level ?? `l${BOUNDS.findIndex((b) => temperature < b) + 1 || 10}`);
</script>

<span class="seed-manner-temp-badge" data-level={lv}>{temperature}°C</span>

<style>
	/* @recipe manner-temp-badge */
	/* SEED recipe: manner-temp-badge */
	:global(.seed-manner-temp-badge) {
		display: inline-flex;
		box-sizing: border-box;
		align-items: center;
		justify-content: center;
		text-transform: none;
		text-align: start;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		text-decoration: none;
		border-radius: var(--radius-full);
		min-height: var(--dimension-x5);
		padding-inline: var(--dimension-x1-5);
		padding-block: var(--dimension-x0-5);
		font-size: var(--text-t1);
		line-height: var(--text-t1--line-height);
		font-weight: var(--font-weight-bold);
	}
	:global(.seed-manner-temp-badge[data-level="l1"]) {
		background-color: var(--manner-temp-l1-bg);
		color: var(--manner-temp-l1-text);
	}
	:global(.seed-manner-temp-badge[data-level="l2"]) {
		background-color: var(--manner-temp-l2-bg);
		color: var(--manner-temp-l2-text);
	}
	:global(.seed-manner-temp-badge[data-level="l3"]) {
		background-color: var(--manner-temp-l3-bg);
		color: var(--manner-temp-l3-text);
	}
	:global(.seed-manner-temp-badge[data-level="l4"]) {
		background-color: var(--manner-temp-l4-bg);
		color: var(--manner-temp-l4-text);
	}
	:global(.seed-manner-temp-badge[data-level="l5"]) {
		background-color: var(--manner-temp-l5-bg);
		color: var(--manner-temp-l5-text);
	}
	:global(.seed-manner-temp-badge[data-level="l6"]) {
		background-color: var(--manner-temp-l6-bg);
		color: var(--manner-temp-l6-text);
	}
	:global(.seed-manner-temp-badge[data-level="l7"]) {
		background-color: var(--manner-temp-l7-bg);
		color: var(--manner-temp-l7-text);
	}
	:global(.seed-manner-temp-badge[data-level="l8"]) {
		background-color: var(--manner-temp-l8-bg);
		color: var(--manner-temp-l8-text);
	}
	:global(.seed-manner-temp-badge[data-level="l9"]) {
		background-color: var(--manner-temp-l9-bg);
		color: var(--manner-temp-l9-text);
	}
	:global(.seed-manner-temp-badge[data-level="l10"]) {
		background-color: var(--manner-temp-l10-bg);
		color: var(--manner-temp-l10-text);
	}
	/* @end recipe */
</style>
