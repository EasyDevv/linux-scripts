<!-- SEED MannerTemp (매너온도): "36.5°C" in the level colour + the level emote image.
     Level from temperature: <30 l1 · <36 l2 · <36.5 l3 · <37 l4 · <40 l5 · <45 l6 · <55 l7 · <65 l8 · <80 l9 · else l10.
     Emotes are Daangn's hosted images (assetstorage.krrt.io), referenced exactly as SEED's MannerTempEmote does. -->
<script lang="ts">
	let { temperature, level }: { temperature: number; level?: string } = $props();
	const BOUNDS = [30, 36, 36.5, 37, 40, 45, 55, 65, 80];
	const EMOTE = [
		"b63c9b3c-410c-4cf5-ba83-d787a03c3c57",
		"8e4bc458-f6d4-41ce-bfa2-17ea34022f5b",
		"906ff501-edf6-402d-a3a4-a93ce9e04d30",
		"10753976-b25d-4e4c-84b2-dbbe196dd0d9",
		"ddfbd296-5089-408c-aa37-919f45074e5e",
		"bf8f9b4d-c72e-4bf2-a094-460d3ad1b11f",
		"9906a459-a4e3-4521-a6e5-0cc24c0aa763",
		"438edadb-d31d-4711-aebd-a72f303fdf49",
		"61f6c297-11da-4d72-ba90-20cd69c09c22",
		"6cc410ac-3a55-4542-b49f-53551db74c4d",
	];
	const lv = $derived(level ?? `l${BOUNDS.findIndex((b) => temperature < b) + 1 || 10}`);
	const base = $derived(`https://assetstorage.krrt.io/1123529253537884138/${EMOTE[Number(lv.slice(1)) - 1]}`);
</script>

<span class="seed-manner-temp" data-level={lv}>
	{temperature}°C<img class="seed-suffix-icon" aria-hidden="true" alt="" src="{base}/width_64_height_64.webp" srcset="{base}/width_64_height_64.webp 2x, {base}/width_96_height_96.webp 3x, {base}/width_128_height_128.webp 4x" />
</span>

<style>
	/* @recipe manner-temp */
	/* SEED recipe: manner-temp */
	:global(.seed-manner-temp) {
		display: inline-flex;
		justify-content: flex-start;
		align-items: center;
		gap: var(--dimension-x1);
		box-sizing: border-box;
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		font-weight: var(--font-weight-bold);
		--seed-suffix-icon-size: var(--dimension-x8);
		--seed-suffix-icon-margin-left: calc(var(--dimension-x1) * -1);
		--seed-suffix-icon-margin-right: calc(var(--dimension-x1) * -1);
		--seed-suffix-icon-margin-top: calc(var(--dimension-x1) * -1);
		--seed-suffix-icon-margin-bottom: calc(var(--dimension-x1) * -1);
	}
	:global(.seed-manner-temp[data-level="l1"]) {
		color: var(--manner-temp-l1-text);
	}
	:global(.seed-manner-temp[data-level="l2"]) {
		color: var(--manner-temp-l2-text);
	}
	:global(.seed-manner-temp[data-level="l3"]) {
		color: var(--manner-temp-l3-text);
	}
	:global(.seed-manner-temp[data-level="l4"]) {
		color: var(--manner-temp-l4-text);
	}
	:global(.seed-manner-temp[data-level="l5"]) {
		color: var(--manner-temp-l5-text);
	}
	:global(.seed-manner-temp[data-level="l6"]) {
		color: var(--manner-temp-l6-text);
	}
	:global(.seed-manner-temp[data-level="l7"]) {
		color: var(--manner-temp-l7-text);
	}
	:global(.seed-manner-temp[data-level="l8"]) {
		color: var(--manner-temp-l8-text);
	}
	:global(.seed-manner-temp[data-level="l9"]) {
		color: var(--manner-temp-l9-text);
	}
	:global(.seed-manner-temp[data-level="l10"]) {
		color: var(--manner-temp-l10-text);
	}
	/* @end recipe */
</style>
