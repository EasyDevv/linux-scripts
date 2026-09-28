<!-- draft-meta: {"route":"button","title":"Button","style":"toss"} -->
<!-- Reconstruction of https://tossmini-docs.toss.im/tds-mobile/components/button/
     Docs shell 1440x900 measured; component boxes measured at 390px. -->
<script lang="ts">
	import { BUTTON_SECTIONS } from "../data.ts";
	import { bodyStyle, breadcrumbStyle, contentStyle, pageTitleStyle, previewStyle, sectionTitleStyle } from "../chrome.ts";
	import Shell from "../shell.svelte";
	import TdsButton from "../../components/button.svelte";

	const SIZES = [
		{ name: "small", h: "32px", r: "8px", px: "10px", fs: "13px" },
		{ name: "medium", h: "38px", r: "10px", px: "16px", fs: "15px" },
		{ name: "large", h: "48px", r: "14px", px: "16px", fs: "17px" },
		{ name: "default", h: "56px", r: "16px", px: "28px", fs: "17px" },
	] as const;
</script>

<Shell page="button">
	<main class="flex" style="padding: 16px 48px 0">
		<div class="min-w-0 flex-1" style={contentStyle}>
			<nav style={breadcrumbStyle} aria-label="breadcrumb">
				<span>컴포넌트</span>
				<span aria-hidden="true">›</span>
				<span>Button</span>
			</nav>
			<h1 style="margin: 8px 0 0; {pageTitleStyle}">Button</h1>

			<p style="margin: 24px 0 0; {bodyStyle}">
				<span style="border-radius: 6px; padding: 2px 3.6px; background: var(--surface-well);">Button</span>
				컴포넌트는 사용자가 어떤 액션을 트리거하거나 프로세스를 진행할 때 사용해요. 버튼은 기본적인 UI 요소로, 곧
				다이얼로그 열기, 작업 취소, sticky와 같은 다양한 상황에서 사용돼요.
			</p>

			<div style="margin-top: 24px; display: flex; align-items: center; gap: 12px; {previewStyle}">
				<TdsButton>버튼</TdsButton>
			</div>

			<h2 style="margin: 48px 0 0; padding-bottom: 4px; border-bottom: var(--hairline-width) solid var(--border); {sectionTitleStyle}">
				크기 조정하기
			</h2>
			<div style="display: grid; gap: 12px; margin-top: 20px; {previewStyle}">
				{#each SIZES as size (size.name)}
					<div style="display: flex; align-items: center; gap: 12px">
						<TdsButton size={size.name}>{size.name}</TdsButton>
						<span style="font-size: 13px; line-height: 19.5px; color: var(--grey-500)">
							{size.h} · r {size.r} · px {size.px} · {size.fs}/1.252
						</span>
					</div>
				{/each}
			</div>

			<h2 style="margin: 48px 0 0; padding-bottom: 4px; border-bottom: var(--hairline-width) solid var(--border); {sectionTitleStyle}">
				버튼 종류
			</h2>
			{#each BUTTON_SECTIONS as section (section.id)}
				<p style="margin: 24px 0 0; {bodyStyle}">
					<code style="border-radius: 6px; padding: 2px 3.6px; background: var(--surface-well);">{section.id}</code>
				</p>
				<div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; {previewStyle}">
					{#each section.rows as row (row.label)}
						<TdsButton variant={row.tone} size={row.size ?? "default"} disabled={row.disabled ?? false}>
							{row.label}
						</TdsButton>
					{/each}
				</div>
			{/each}
		</div>

		<aside class="hidden shrink-0 xl:block" style="width: 256px; padding: 0 16px">
			<nav aria-label="On this page" style="position: sticky; top: 88px; padding-top: 24px">
				<p style="margin: 0 0 12px; font-size: 14px; line-height: 21px; font-weight: 600">On This Page</p>
				<ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 14px; line-height: 21px; color: var(--grey-600)">
					<li>사용 예제</li>
					<li>크기 조정하기</li>
					<li>fill</li>
					<li>weak</li>
					<li>크기</li>
					<li>danger</li>
					<li>비활성화하기</li>
					<li>접근성</li>
				</ul>
			</nav>
		</aside>
	</main>
</Shell>
