<!-- The live docs pin a 48px inverted promo strip to the viewport bottom; this is it
     (data-role=app-footer for the dashboard shell contract). -->
<script lang="ts">
	import X from "@lucide/svelte/icons/x";
	import { docsMark } from "./chrome.ts";
</script>

<footer
	data-role="app-footer"
	class="absolute inset-x-0 bottom-0 z-30 flex items-center bg-bg-neutral-inverted"
	style="height: 48px; padding-inline: 20px"
>
	<a href="#top" aria-label="Help" style="font-size: 16px; line-height: 24px; font-weight: 700; color: {docsMark.promoInk}; text-decoration: none">
		우리는 왜 디자인 엔지니어를 찾게 됐을까 →
	</a>
	<button type="button" aria-label="Agent" class="ml-auto" style="color: var(--fg-neutral-inverted)"><X size={20} /></button>
</footer>
