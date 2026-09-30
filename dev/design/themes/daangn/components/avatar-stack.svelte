<!-- SEED AvatarStack: overlapping avatars; each item is ringed by bg-layer-default (1-2px) and pulled
     left by a quarter of its size. Pass the image URLs; items render Avatar at the stack size. -->
<script lang="ts">
	import Avatar from "./avatar.svelte";
	type Size = "20" | "24" | "36" | "42" | "48" | "56" | "64" | "80" | "96" | "108";
	let { srcs, size = "48" }: { srcs: (string | undefined)[]; size?: Size } = $props();
</script>

<div class="seed-avatar-stack__root" data-size={size}>
	{#each srcs as src, i (i)}
		<div class="seed-avatar-stack__item" data-size={size}><Avatar {src} {size} /></div>
	{/each}
</div>

<style>
	/* @recipe avatar-stack */
	/* SEED recipe: avatar-stack */
	:global(.seed-avatar-stack__root) {
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
	}
	:global(.seed-avatar-stack__item) {
		display: block;
		border-radius: var(--radius-full);
		background-clip: padding-box;
	}
	:global(.seed-avatar-stack__item[data-size="20"]:not(:first-child)) {
		margin-left: -5px;
	}
	:global(.seed-avatar-stack__item[data-size="20"]) {
		clip-path: inset(-1px);
		box-shadow: 0 0 0 1px var(--bg-layer-default);
	}
	:global(.seed-avatar-stack__item[data-size="24"]:not(:first-child)) {
		margin-left: -6px;
	}
	:global(.seed-avatar-stack__item[data-size="24"]) {
		clip-path: inset(-1px);
		box-shadow: 0 0 0 1px var(--bg-layer-default);
	}
	:global(.seed-avatar-stack__item[data-size="36"]:not(:first-child)) {
		margin-left: -8px;
	}
	:global(.seed-avatar-stack__item[data-size="36"]) {
		clip-path: inset(-2px);
		box-shadow: 0 0 0 2px var(--bg-layer-default);
	}
	:global(.seed-avatar-stack__item[data-size="42"]:not(:first-child)) {
		margin-left: -10px;
	}
	:global(.seed-avatar-stack__item[data-size="42"]) {
		clip-path: inset(-2px);
		box-shadow: 0 0 0 2px var(--bg-layer-default);
	}
	:global(.seed-avatar-stack__item[data-size="48"]:not(:first-child)) {
		margin-left: -12px;
	}
	:global(.seed-avatar-stack__item[data-size="48"]) {
		clip-path: inset(-2px);
		box-shadow: 0 0 0 2px var(--bg-layer-default);
	}
	:global(.seed-avatar-stack__item[data-size="56"]:not(:first-child)) {
		margin-left: -13px;
	}
	:global(.seed-avatar-stack__item[data-size="56"]) {
		clip-path: inset(-3px);
		box-shadow: 0 0 0 3px var(--bg-layer-default);
	}
	:global(.seed-avatar-stack__item[data-size="64"]:not(:first-child)) {
		margin-left: -16px;
	}
	:global(.seed-avatar-stack__item[data-size="64"]) {
		clip-path: inset(-3px);
		box-shadow: 0 0 0 3px var(--bg-layer-default);
	}
	:global(.seed-avatar-stack__item[data-size="80"]:not(:first-child)) {
		margin-left: -20px;
	}
	:global(.seed-avatar-stack__item[data-size="80"]) {
		clip-path: inset(-4px);
		box-shadow: 0 0 0 4px var(--bg-layer-default);
	}
	:global(.seed-avatar-stack__item[data-size="96"]:not(:first-child)) {
		margin-left: -24px;
	}
	:global(.seed-avatar-stack__item[data-size="96"]) {
		clip-path: inset(-5px);
		box-shadow: 0 0 0 5px var(--bg-layer-default);
	}
	:global(.seed-avatar-stack__item[data-size="108"]:not(:first-child)) {
		margin-left: -27px;
	}
	:global(.seed-avatar-stack__item[data-size="108"]) {
		clip-path: inset(-5px);
		box-shadow: 0 0 0 5px var(--bg-layer-default);
	}
	/* @end recipe */
</style>
