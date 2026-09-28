<!-- draft-meta: {"route":"components","title":"Components","style":"toss"} -->
<!-- Composed catalogue of the measured TDS Mobile controls. Not a 1:1 live page:
     the source routes are listed per block and their measurements are in ../chrome.json. -->
<script lang="ts">
	import {
		bodyStyle,
		breadcrumbStyle,
		contentStyle,
		pageTitleStyle,
		previewStyle,
		sectionTitleStyle,
	} from "../chrome.ts";
	import Shell from "../shell.svelte";
	import TdsBadge from "../../components/badge.svelte";
	import TdsBoardRow from "../../components/board-row.svelte";
	import TdsButton from "../../components/button.svelte";
	import TdsCheckbox from "../../components/checkbox.svelte";
	import TdsGridList from "../../components/grid-list.svelte";
	import TdsIconButton from "../../components/icon-button.svelte";
	import TdsListFooter from "../../components/list-footer.svelte";
	import TdsListHeader from "../../components/list-header.svelte";
	import TdsListRow from "../../components/list-row.svelte";
	import TdsSearchField from "../../components/search-field.svelte";
	import TdsSegmentedControl from "../../components/segmented-control.svelte";
	import TdsStepper from "../../components/stepper.svelte";
	import TdsSwitch from "../../components/switch.svelte";
	import TdsTab from "../../components/tab.svelte";
	import TdsTextButton from "../../components/text-button.svelte";
	import TdsTextField from "../../components/text-field.svelte";
	import Search from "@lucide/svelte/icons/search";

	const meta = (s: string) => `font-size: 12px; line-height: 18px; color: var(--grey-500)`;
</script>

<Shell page="components">
	<main class="flex" style="padding: 16px 48px 0">
		<div class="min-w-0 flex-1" style={contentStyle}>
			<nav style={breadcrumbStyle} aria-label="breadcrumb">
				<span>컴포넌트</span>
			</nav>
			<h1 style="margin: 8px 0 0; {pageTitleStyle}">Components</h1>
			<p style="margin: 24px 0 0; {bodyStyle}">
				TDS Mobile 문서 67개 라우트를 전수 목록으로 정리하고, 그중 19개 페이지를 실측해
				박스 수치를 토큰과 스니펫으로 옮긴 결과입니다. 각 블록의 수치는 토큰 이름 옆에 적어 두었습니다.
			</p>

			<h2 style="margin: 48px 0 0; padding-bottom: 4px; border-bottom: var(--hairline-width) solid var(--border); {sectionTitleStyle}">
				Button · TextButton · IconButton
			</h2>
			<div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 20px; {previewStyle}">
				<TdsButton size="small">small</TdsButton>
				<TdsButton size="medium">medium</TdsButton>
				<TdsButton size="large">large</TdsButton>
				<TdsButton>default</TdsButton>
				<TdsButton variant="weak">weak</TdsButton>
				<TdsButton variant="danger">danger</TdsButton>
				<TdsTextButton>텍스트 버튼</TdsTextButton>
				<TdsIconButton label="검색하기"><Search size={24} /></TdsIconButton>
				<TdsIconButton label="검색하기" fill><Search size={24} /></TdsIconButton>
				<TdsIconButton label="검색하기" bordered><Search size={24} /></TdsIconButton>
			</div>

			<h2 style="margin: 48px 0 0; padding-bottom: 4px; border-bottom: var(--hairline-width) solid var(--border); {sectionTitleStyle}">
				Badge · Checkbox · Switch
			</h2>
			<div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 20px; {previewStyle}">
				<TdsBadge size="xsmall">xsmall</TdsBadge>
				<TdsBadge size="small">small</TdsBadge>
				<TdsBadge size="medium">medium</TdsBadge>
				<TdsBadge size="large">large</TdsBadge>
				<TdsBadge tone="green">green</TdsBadge>
				<TdsBadge tone="blue-weak">weak</TdsBadge>
				<TdsCheckbox checked label="동의해요" />
				<TdsCheckbox label="선택해요" />
				<TdsCheckbox graphic="line" checked label="line" />
				<TdsSwitch checked />
				<TdsSwitch />
			</div>

			<h2 style="margin: 48px 0 0; padding-bottom: 4px; border-bottom: var(--hairline-width) solid var(--border); {sectionTitleStyle}">
				TextField · SearchField
			</h2>
			<div style="margin-top: 20px; background: var(--surface-float); {previewStyle}">
				<TdsTextField label="Label" help="help" />
				<TdsTextField label="line" variant="underline" help="underline 는 1.6px 밑줄" />
				<TdsSearchField />
			</div>

			<h2 style="margin: 48px 0 0; padding-bottom: 4px; border-bottom: var(--hairline-width) solid var(--border); {sectionTitleStyle}">
				ListRow · ListHeader · ListFooter
			</h2>
			<div style="margin-top: 20px; background: var(--surface-float); {previewStyle}">
				<TdsListHeader title="타이틀 내용" support="보조설명 내용" accessory="악세사리" />
				<ul style="list-style: none; margin: 0; padding: 0">
					<TdsListRow title="동해물과 백두산이" support="마르고 닳도록 하느님이 보우하사" chevron />
					<TdsListRow title="우리나라 만세" />
				</ul>
				<TdsListFooter />
			</div>

			<h2 style="margin: 48px 0 0; padding-bottom: 4px; border-bottom: var(--hairline-width) solid var(--border); {sectionTitleStyle}">
				GridList · SegmentedControl · Tab
			</h2>
			<div style="margin-top: 20px; background: var(--surface-float); {previewStyle}">
				<TdsGridList items={[{ label: "아이템 1" }, { label: "아이템 2" }, { label: "아이템 3" }]} columns={3} />
				<div style:height="16px"></div>
				<TdsSegmentedControl items={["아이템1", "아이템2", "아이팀3"]} />
				<div style:height="16px"></div>
				<TdsTab items={["홈", "장부", "별장"]} />
			</div>

			<h2 style="margin: 48px 0 0; padding-bottom: 4px; border-bottom: var(--hairline-width) solid var(--border); {sectionTitleStyle}">
				Stepper · BoardRow
			</h2>
			<div style="margin-top: 20px; background: var(--surface-float); {previewStyle}">
				<TdsStepper
					steps={[
						{ title: "휴대폰 번호 입력", support: "약관에 동의해 주세요" },
						{ title: "본인 인증", support: "주민등록번호를 입력해 주세요" },
					]}
					done={1}
				/>
				<ul style="list-style: none; margin: 0; padding: 0">
					<TdsBoardRow title="매도 환전이 무엇인가요?" body="매도 환전은 보유 계좌의 돈을 다른 계좌로 옮기는 것입니다." />
					<TdsBoardRow title="토스포인트가 뭐예요?" body="토스에서 사용할 수 있는 포인트예요." />
				</ul>
			</div>
			<p style="margin: 24px 0 48px; {meta('x')}"
				>Snippets: <code>themes/toss/components/</code> · tokens: <code>themes/toss/layout.css</code></p
			>
		</div>
		<aside class="hidden shrink-0 xl:block" style="width: 256px; padding: 0 16px">
			<nav aria-label="On this page" style="position: sticky; top: 88px; padding-top: 24px">
				<p style="margin: 0 0 12px; font-size: 14px; line-height: 21px; font-weight: 600">On This Page</p>
				<ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 14px; line-height: 21px; color: var(--grey-600)">
					<li>Button · TextButton · IconButton</li>
					<li>Badge · Checkbox · Switch</li>
					<li>TextField · SearchField</li>
					<li>ListRow · ListHeader · ListFooter</li>
					<li>GridList · SegmentedControl · Tab</li>
					<li>Stepper · BoardRow</li>
				</ul>
			</nav>
		</aside>
	</main>
</Shell>
