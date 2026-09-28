<!-- draft-meta: {"route":"foundation","title":"Foundation","style":"toss"} -->
<!-- Composed from /foundation/colors and /foundation/typography. The ramps and the
     alias table are the live values; the swatch layout is composed, not a 1:1 page. -->
<script lang="ts">
	import { bodyStyle, breadcrumbStyle, contentStyle, pageTitleStyle, previewStyle, sectionTitleStyle } from "../chrome.ts";
	import Shell from "../shell.svelte";

	const GREY = [
		["50", "var(--grey-50)"],
		["100", "var(--grey-100)"],
		["200", "var(--grey-200)"],
		["300", "var(--grey-300)"],
		["400", "var(--grey-400)"],
		["500", "var(--grey-500)"],
		["600", "var(--grey-600)"],
		["700", "var(--grey-700)"],
		["800", "var(--grey-800)"],
		["900", "var(--grey-900)"],
	] as const;

	const HUES = [
		["blue", ["var(--blue-400)", "var(--blue-500)", "var(--blue-600)", "var(--blue-700)"]],
		["red", ["var(--red-400)", "var(--red-500)", "var(--red-600)"]],
		["green", ["var(--green-400)", "var(--green-500)", "var(--green-600)"]],
		["orange", ["var(--orange-500)"]],
		["teal", ["var(--teal-500)"]],
		["yellow", ["var(--yellow-500)"]],
		["purple", ["var(--purple-500)"]],
	] as const;

	/** token, size/lineHeight, weight, usage — the live typography table. */
	const TYPE = [
		["--text-display", "30 / 40", "700", "Typography 1 · 매우 큰 제목"],
		["--text-title", "26 / 35", "600", "Typography 2 · 큰 제목"],
		["--text-heading", "22 / 31", "600", "Typography 3 · 일반 제목"],
		["--text-heading-sm", "17 / 25.5", "600", "Typography 5 · 작은 제목"],
		["--text-body", "17 / 25.5", "400", "Typography 5 · 일반 본문"],
		["--text-body-sm", "15 / 22.5", "400", "Typography 6 · 작은 본문"],
		["--text-label", "13 / 19.5", "400", "Typography 7 · 안 읽어도 됨"],
		["--text-label-sm", "12 / 18", "400", "sub Typography 12"],
		["--text-caption", "11 / 16.5", "400", "sub Typography 13 · 아예 안읽어도 됨"],
	] as const;
</script>

<Shell page="foundation">
	<main class="flex" style="padding: 16px 48px 0">
		<div class="min-w-0 flex-1" style={contentStyle}>
			<nav style={breadcrumbStyle} aria-label="breadcrumb"><span>파운데이션</span></nav>
			<h1 style="margin: 8px 0 0; {pageTitleStyle}">Foundation</h1>

			<h2 style="margin: 48px 0 0; padding-bottom: 4px; border-bottom: var(--hairline-width) solid var(--border); {sectionTitleStyle}">
				Colors
			</h2>
			<p style="margin: 16px 0 0; {bodyStyle}">
				adaptive grey 램프는 다크에서 뒤집힙니다. 아래 값은 다크 모드에서도 각자 다른 토큰으로 전달됩니다.
			</p>
			<div style="display: grid; gap: 8px; margin-top: 20px; {previewStyle}">
				{#each GREY as [step, token] (step)}
					<div style="display: flex; align-items: center; gap: 12px">
						<div style="width: 88px; height: 40px; border-radius: 8px; background: {token}; border: var(--hairline-width) solid var(--hairline)"></div>
						<code style="font-size: 13px; line-height: 19.5px">grey{step}</code>
						<code style="font-size: 13px; line-height: 19.5px; color: var(--grey-500)">{token}</code>
					</div>
				{/each}
			</div>
			<div style="display: grid; gap: 12px; margin-top: 20px; {previewStyle}">
				{#each HUES as [hue, ramp] (hue)}
					<div style="display: flex; align-items: center; gap: 8px">
						<code style="width: 72px; font-size: 13px; line-height: 19.5px">{hue}</code>
						{#each ramp as token (token)}
							<div style="width: 64px; height: 40px; border-radius: 8px; background: {token}"></div>
						{/each}
					</div>
				{/each}
			</div>

			<h2 style="margin: 48px 0 0; padding-bottom: 4px; border-bottom: var(--hairline-width) solid var(--border); {sectionTitleStyle}">
				Typography
			</h2>
			<p style="margin: 16px 0 0; {bodyStyle}">
				raw scale은 <code>f11 … f42</code>이고 line height는 11…29에서 1.5배, 30 이상에서 4/3배입니다.
				의미 토큰(t1…t7, st1…st13)은 이 램프를 가리킵니다. 더 큰 텍스트는 1.01…1.4배로 확대되므로 값을 하드코딩하지 않습니다.
			</p>
			<div style="display: grid; gap: 16px; margin-top: 20px; {previewStyle}">
				{#each TYPE as [token, size, weight, usage] (token)}
					<div style="display: flex; align-items: baseline; gap: 16px">
						<code style="width: 150px; flex-shrink: 0; font-size: 12px; line-height: 18px; color: var(--grey-500)">{token}</code>
						<code style="width: 92px; flex-shrink: 0; font-size: 12px; line-height: 18px; color: var(--grey-500)">{size} / {weight}</code>
						<span
							style="font-size: {token === '--text-display'
								? '30px'
								: token === '--text-title'
									? '26px'
									: token === '--text-heading'
										? '22px'
										: token === '--text-label'
											? '13px'
											: token === '--text-label-sm'
												? '12px'
												: token === '--text-caption'
													? '11px'
													: token === '--text-body-sm'
														? '15px'
														: '17px'}; font-weight: {weight}; line-height: 1.5; color: var(--grey-900)"
						>
							{usage}
						</span>
					</div>
				{/each}
			</div>
			<div style="height: 48px"></div>
		</div>
		<aside class="hidden shrink-0 xl:block" style="width: 256px; padding: 0 16px">
			<nav aria-label="On this page" style="position: sticky; top: 88px; padding-top: 24px">
				<p style="margin: 0 0 12px; font-size: 14px; line-height: 21px; font-weight: 600">On This Page</p>
				<ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 14px; line-height: 21px; color: var(--grey-600)">
					<li>Colors</li>
					<li>Typography</li>
				</ul>
			</nav>
		</aside>
	</main>
</Shell>
