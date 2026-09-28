<script lang="ts">
	import { docsMark } from "./chrome.ts";
</script>

<!-- The live TDS docs page has no footer. This strip exists because the
     dashboard shell contract expects one (measure-theme-ref gates on
     data-role=app-footer); it is a ref affordance, not a TDS page element. -->
<footer
	data-role="app-footer"
	class="absolute bottom-0 left-0 flex w-full items-center gap-2 bg-card"
	style="height: var(--shell-footer-height); padding-left: var(--sidebar-width); padding-right: 16px; border-top: var(--hairline-width) solid var(--border); font-size: 12px; line-height: 18px; color: {docsMark.subtleInk}"
>
	<button type="button" aria-label="Help" style="font-size: 12px; color: {docsMark.subtleInk}">Help</button>
	<span class="mr-auto" style="padding-left: 12px">토스 디자인 시스템 모바일</span>
	<button type="button" aria-label="Agent" style="font-size: 12px; color: {docsMark.subtleInk}">
		Agent
	</button>
</footer>
