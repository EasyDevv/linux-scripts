<!-- draft-meta: {"route":"content","title":"Content","style":"toss"} -->
<!-- Paragraph, Post, Top, Result, Asset, Bubble, BottomInfo, BarChart, Highlight, Agreement. -->
<script lang="ts">
	import Demo from "../demo.svelte";
	import Doc from "../doc.svelte";
	import Agreement from "../../components/agreement.svelte";
	import Asset, { frameShape } from "../../components/asset.svelte";
	import Badge from "../../components/badge.svelte";
	import BarChart from "../../components/bar-chart.svelte";
	import BottomInfo from "../../components/bottom-info.svelte";
	import Bubble from "../../components/bubble.svelte";
	import Button from "../../components/button.svelte";
	import Highlight from "../../components/highlight.svelte";
	import ListRow from "../../components/list-row.svelte";
	import Paragraph from "../../components/paragraph.svelte";
	import Post from "../../components/post.svelte";
	import Result from "../../components/result.svelte";
	import Top from "../../components/top.svelte";

	let spot = $state(true);
	let all = $state(false);
	let terms = $state(true);
	let open = $state(true);
</script>

{#snippet coin()}<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="var(--yellow-400)" /><path d="M9 8h6M12 8v8" stroke="var(--yellow-800)" stroke-width="2" stroke-linecap="round" /></svg>{/snippet}
{#snippet empty()}<Asset shape={{ w: 60, h: 60, r: 9999, s: 0.55 }}>{@render coin()}</Asset>{/snippet}
{#snippet retry()}<Button size="medium">다시 시도하기</Button>{/snippet}
{#snippet topRight()}<Button size="medium">송금</Button>{/snippet}
{#snippet topUpper()}<Asset shape={frameShape.SquareMedium}>{@render coin()}</Asset>{/snippet}
{#snippet topLower()}<Button size="small" variant="weak">왜 사용할 수 없나요?</Button>{/snippet}
{#snippet acc()}<Badge size="xsmall" color="red">N</Badge>{/snippet}

<Doc
	page="content"
	crumb="컴포넌트"
	title="Content"
	lead="화면을 구성하는 텍스트와 시각 요소입니다. Paragraph는 t1…t7 / st1…st13 스케일을 그대로 쓰고, Post와 Top은 그 위에 들여쓰기와 행간 규칙(× 1.35)을 얹습니다."
	toc={[
		{ id: "paragraph", label: "Paragraph" },
		{ id: "top", label: "Top" },
		{ id: "post", label: "Post" },
		{ id: "result", label: "Result" },
		{ id: "asset", label: "Asset" },
		{ id: "bubble", label: "Bubble" },
		{ id: "agreement", label: "Agreement" },
		{ id: "bar-chart", label: "BarChart" },
		{ id: "bottom-info", label: "BottomInfo" },
		{ id: "highlight", label: "Highlight" },
	]}
>
	<Demo id="paragraph" title="Paragraph" spec="typography t1 … st13 · fontWeight regular/medium/semibold/bold · ink grey900">
		<div class="grid gap-2">
			<Paragraph typography="t1" fontWeight="bold">동해물과 백두산이</Paragraph>
			<Paragraph typography="t3" fontWeight="semibold">마르고 닳도록</Paragraph>
			<Paragraph typography="t5">하느님이 보우하사 우리나라 만세</Paragraph>
			<Paragraph typography="t7" color="var(--ink-subtle)">무궁화 삼천리 화려강산 대한사람 대한으로 길이 보전하세</Paragraph>
		</div>
	</Demo>

	<Demo id="top" bleed title="Top" spec="padding 24/24 · title t3 22/31/700 (large 28/37) · subtitle 17/25.5/500 grey700 · right Button medium margin 0 24 0 8">
		<Top title="동해물과 백두산이 마르고 닳도록" subtitleBottom="텍스트를 적어주세요." upper={topUpper} right={topRight} />
		<Top title="동해물과 백두산이" size="large" subtitleTop="보조 제목" />
		<Top title="동해물과 백두산이" lower={topLower} />
	</Demo>

	<Demo id="post" bleed title="Post" spec="h1 26 · h2 22 · h3 19 · h4 17 (all 700, × 1.35) · p 17/25.5 · lists inset 0 24 0 16, li padding 32, gap 8">
		<Post
			blocks={[
				{ type: "h2", text: "토스머니 이용약관 변경 안내" },
				{ type: "p", text: "2018년 11월 22일부터 토스 가입 시 자동 발급되는 토스 계좌의 명칭이 '토스머니'로 변경됩니다." },
				{ type: "h4", text: "변경 내용" },
				{ type: "ol", items: ["토스머니 명칭 변경", { text: "수수료 정책 변경", items: ["송금 수수료 무료", "출금 수수료 월 5회 무료"] }, "고객센터 운영 시간 변경"] },
				{ type: "hr" },
				{ type: "fine", text: "자세한 내용은 고객센터로 문의해주세요." },
			]}
		/>
	</Demo>

	<Demo id="result" bleed title="Result" spec="padding 32 40 40 · figure 60 + 12 · title 17/25.5/600 · desc 15/22.5 grey700 · Button medium after 16">
		<Result title="다시 시도해주세요" description="시스템에 잠깐 문제가 생겨 화면을 불러오지 못했어요." figure={empty} button={retry} />
	</Demo>

	<Demo id="asset" title="Asset" spec="frame presets · square 40/52 · rectangle 80×54/100×68 · circle 30/36/40 · card 24×36…32×48 · fill grey100">
		<div class="flex flex-wrap items-center gap-4">
			{#each Object.entries(frameShape) as [name, shape] (name)}
				<div class="grid justify-items-center gap-1">
					<Asset {shape}>{@render coin()}</Asset>
					<code class="text-st13 text-ink-faint">{name}</code>
				</div>
			{/each}
			<div class="grid justify-items-center gap-1">
				<Asset shape={frameShape.SquareMedium} {acc}>{@render coin()}</Asset>
				<code class="text-st13 text-ink-faint">acc</code>
			</div>
		</div>
	</Demo>

	<Demo id="bubble" title="Bubble" spec="padding 12 14 · r16 · 16/24 · max 253 · blue500/white (mine) · grey200/grey800 (theirs) · 13×17 tail">
		<div class="grid gap-2">
			<Bubble background="grey">안녕하세요!</Bubble>
			<Bubble background="grey" withTail={false}>토스 고객센터입니다. 무엇을 도와드릴까요?</Bubble>
			<Bubble>송금 한도를 늘리고 싶어요</Bubble>
		</div>
	</Demo>

	<Demo id="agreement" bleed title="Agreement" spec="row margin 4 20 0 · 28px check box · text padding 2 4 · 15/22.5/600 grey700 · xLarge 19/28 · small 13/19.5/500 grey500 · 필수 blue500">
		<Agreement label="전체 동의하기" variant="xLarge" bind:checked={all} />
		<Agreement label="서비스 이용 동의" necessity="mandatory" bind:checked={terms} badge="안심" badgeTone="yellow" badgeVariant="fill" />
		<Agreement label="개인정보 수집 및 이용" necessity="mandatory" bind:open />
		{#if open}
			<Agreement label="고유식별정보 수집/이용" variant="small" control="dot" indent={0} />
			<Agreement label="개인(신용)정보 수집/이용" variant="small" control="dot" />
		{/if}
		<Agreement label="마케팅 정보 수신" necessity="optional" />
		<Agreement label="헤더" variant="medium-title" />
	</Demo>

	<Demo id="bar-chart" bleed title="BarChart" spec="205h · padding 12 24 · bar 28 r7, radial 300→500 · annotation 12/18/600 700-step · axis 11/16.5/500 grey600">
		<BarChart
			data={[
				{ value: 6, label: "1월", annotation: 6 },
				{ value: 5, label: "2월", annotation: 5 },
				{ value: 4, label: "3월", annotation: 4 },
				{ value: 3, label: "4월", annotation: 3 },
				{ value: 2, label: "5월", annotation: 2 },
				{ value: 1, label: "6월", annotation: 1 },
			]}
		/>
		<BarChart
			height={160}
			fill={{ type: "single-bar", theme: "green", barIndex: 3 }}
			data={[{ value: 30, label: "월" }, { value: 45, label: "화" }, { value: 20, label: "수" }, { value: 80, label: "목", annotation: "80%" }, { value: 50, label: "금" }]}
		/>
	</Demo>

	<Demo id="bottom-info" bleed title="BottomInfo" spec="greyBackground · padding-top 24 · 13/19.5 grey700 at 28px lines · li padding-left 24 · 160px fade">
		<BottomInfo
			items={[
				"대출기간 40년의 경우 만39세 이하 또는 신혼부부만 이용할 수 있어요.",
				"회사 및 대출모집인은 해당상품에 대해 충분히 설명할 의무가 있으며, 고객님께서는 설명을 들으신 후 거래하시기 바랍니다.",
			]}
		/>
	</Demo>

	<Demo id="highlight" bleed title="Highlight" spec="greyOpacity700 mask with a rounded hole around the target (padding) · message 15/22.5/700 white">
		<div class="relative overflow-hidden pb-16">
			<ul class="m-0 p-0">
				<ListRow title="첫 번째 항목" />
				<Highlight open={spot} padding={4} message="여기를 눌러 계좌를 연결해보세요" onclick={() => (spot = false)}>
					<ListRow title="강조하고 싶은 영역" description="padding 4 적용" />
				</Highlight>
				<ListRow title="세 번째 항목" />
			</ul>
			{#if !spot}<div class="px-6 pt-2"><Button size="small" variant="weak" onclick={() => (spot = true)}>다시 보기</Button></div>{/if}
		</div>
	</Demo>
</Doc>
