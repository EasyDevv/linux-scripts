<!-- SEED IdentityPlaceholder: the grey person (or shop) silhouette used as the Avatar fallback. -->
<script lang="ts">
	let { identity = "person" }: { identity?: "person" | "business" } = $props();
	const PATH = {
		person: "M496 460q4 5 0 11c-42 52-97 81-176 81s-134-29-176-81q-3-5-1-10c33-50 104-74 177-74s144 23 176 73M222 251a98 98 0 0 1 196 0c0 54-44 97-98 97s-98-43-98-97",
		business:
			"m512 250-29-73c-7-17-24-29-42-29H200c-18 0-35 12-42 29l-29 73q-3 7 2 14c17 23 42 41 71 41q35-2 59-26 25 24 59 26 35-2 59-26 25 24 59 26c28 0 56-18 72-41 2-3 3-11 2-14M439 340c-28 0-47-12-59-23a86 86 0 0 1-59 23c-28 0-48-12-59-23a86 86 0 0 1-60 23q-33-2-53-17v119c0 27 22 49 49 49h138l107 1c27 0 49-22 49-50V323q-20 15-53 17m-143 72q-1 11-12 12h-18q-11-2-12-12v-19q1-10 12-11h18q11 1 12 11zm91 0q-1 11-11 12h-19q-11-2-12-12v-19q1-10 12-11h19q10 1 11 11z",
	};
</script>

<div class="seed-identity-placeholder__root">
	<svg class="seed-identity-placeholder__image" viewBox="0 0 640 640" fill="none" role="img" aria-label="Identity placeholder"><path d={PATH[identity]} /></svg>
</div>

<style>
	/* @recipe identity-placeholder */
	/* SEED recipe: identity-placeholder */
	:global(.seed-identity-placeholder__root) {
		box-sizing: border-box;
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		vertical-align: top;
		width: 100%;
		height: 100%;
		background-color: var(--palette-gray-500);
	}
	:global(.seed-identity-placeholder__image) {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		overflow: hidden;
		fill: var(--palette-static-white-alpha-800);
	}
	/* @end recipe */
</style>
