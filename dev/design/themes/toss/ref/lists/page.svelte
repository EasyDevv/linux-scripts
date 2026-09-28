<!-- draft-meta: {"route":"lists","title":"Lists","style":"toss"} -->
<!-- ListRow (+ assets), ListHeader, ListFooter, BoardRow, GridList, TableRow, Border, Stepper. -->
<script lang="ts">
	import Demo from "../demo.svelte";
	import Doc from "../doc.svelte";
	import BoardRow from "../../components/board-row.svelte";
	import Border from "../../components/border.svelte";
	import Button from "../../components/button.svelte";
	import GridList from "../../components/grid-list.svelte";
	import ListFooter from "../../components/list-footer.svelte";
	import ListHeader from "../../components/list-header.svelte";
	import ListRowAsset from "../../components/list-row-asset.svelte";
	import ListRow from "../../components/list-row.svelte";
	import Stepper from "../../components/stepper.svelte";
	import Switch from "../../components/switch.svelte";
	import TableRow from "../../components/table-row.svelte";

	let push = $state(true);
	let faq = $state(true);
</script>

{#snippet bank()}<ListRowAsset text="토스" />{/snippet}
{#snippet card()}<ListRowAsset shape="card" size="small"><svg viewBox="0 0 24 24" fill="var(--blue-500)"><rect x="3" y="6" width="18" height="12" rx="2" /></svg></ListRowAsset>{/snippet}
{#snippet person()}<ListRowAsset shape="circle"><svg viewBox="0 0 24 24" fill="var(--grey-400)"><circle cx="12" cy="9" r="4" /><path d="M4 20c1-4 4.5-6 8-6s7 2 8 6Z" /></svg></ListRowAsset>{/snippet}
{#snippet sendButton()}<Button size="small" variant="weak">송금</Button>{/snippet}
{#snippet pushSwitch()}<Switch bind:checked={push} label="푸시 알림" />{/snippet}
{#snippet amount()}<span>1,250,000원</span>{/snippet}
{#snippet arrowRight()}<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="var(--grey-400)" stroke-width="2" stroke-linecap="round"><path d="M9.5 6l6 6-6 6" /></svg>{/snippet}
{#snippet goButton()}<Button size="small" variant="weak" color="dark">보기</Button>{/snippet}

<Doc
	page="lists"
	crumb="컴포넌트"
	title="Lists"
	lead="리스트는 화면 가장자리에서 24px 들여 쓰고, 텍스트 행간은 글자 크기 × 1.35를 씁니다(본문 스케일이 아님). 구분선은 1px hairline입니다."
	toc={[
		{ id: "list-row", label: "ListRow" },
		{ id: "list-header", label: "ListHeader" },
		{ id: "list-footer", label: "ListFooter" },
		{ id: "board-row", label: "BoardRow" },
		{ id: "grid-list", label: "GridList" },
		{ id: "table-row", label: "TableRow" },
		{ id: "border", label: "Border" },
		{ id: "stepper", label: "Stepper" },
	]}
>
	<Demo id="list-row" bleed title="ListRow" spec="padding 8/12/16/24 × 24 · asset → 12 → texts → 16 → right · 17/22.95/500 grey700 · 2-row 700 grey800 + 15/20.25 grey600">
		<ul class="m-0 p-0">
			<ListRow title="동해물과 백두산이" />
			<ListRow title="토스뱅크 통장" description="1000-1234-5678" left={bank} right={sendButton} />
			<ListRow title="토스카드" description="이번 달 사용 금액" caption="결제일 14일" left={card} right={amount} border="indented" />
			<ListRow title="푸시 알림" description="중요한 소식을 알려드려요" right={pushSwitch} border="indented" />
			<ListRow title="김토스" description="최근 송금 3일 전" left={person} withArrow onclick={() => {}} border="indented" />
			<ListRow title="small" padding="small" border="indented" />
			<ListRow title="large" padding="large" border="indented" />
			<ListRow title="xlarge" padding="xlarge" border="indented" />
		</ul>
	</Demo>

	<Demo id="list-header" bleed title="ListHeader" spec="padding 24 0 8 · description 13/19.5 grey600 · title 17/25.5/700 grey800 · right 13/19.5 grey700 + chevron">
		<ListHeader title="타이틀 내용" description="보조설명 내용" rightText="악세사리" />
		<ListHeader title="최근 거래 내역" rightText="전체보기" rightArrow />
		<ListHeader title="자주 쓰는 계좌" description="아래에 보조 설명" descriptionPosition="bottom" />
	</Demo>

	<Demo id="list-footer" bleed title="ListFooter" spec="59h · 1px hairline full / indented / none · 17 × 1.252 / 500 blue500">
		<ul class="m-0 p-0">
			<ListFooter>더 보기</ListFooter>
			<ListFooter border="indented" tone="subtle">더 보기</ListFooter>
			<ListFooter weight="bold">더 보기</ListFooter>
		</ul>
	</Demo>

	<Demo id="board-row" bleed title="BoardRow" spec="header 56h · padding 16 16 16 24 · prefix + 8 · 17/22.95/500 · content blue500 4% wash, 15/22.5 grey700">
		<ul class="m-0 p-0">
			<BoardRow title="매도 환전이 무엇인가요?" prefix="Q" bind:open={faq}>
				주식 거래가 실시간이 아니기 때문에, 가격이 변할 것에 대비하는 금액을 미리 환전해두는 거예요.
			</BoardRow>
			<BoardRow title="환전 수수료는 얼마인가요?" prefix="Q">매수, 매도 모두 환율 우대 95%가 적용돼요.</BoardRow>
			<BoardRow title="언제 입금되나요?" prefix="Q">영업일 기준 2일 후 입금돼요.</BoardRow>
		</ul>
	</Demo>

	<Demo id="grid-list" bleed title="GridList" spec="grid 3 cols (1-3) · gap 8 · padding 0 24 8 · cell r9 greyOpacity50 · padding 12 8 · 24px image · 14/21/500">
		<GridList items={[{ label: "송금" }, { label: "결제" }, { label: "투자" }, { label: "대출" }, { label: "보험" }, { label: "혜택" }]} />
		<div class="h-3"></div>
		<GridList column={2} items={[{ label: "아이템 1" }, { label: "아이템 2" }]} />
	</Demo>

	<Demo id="table-row" bleed title="TableRow" spec="42h · left 10 8 10 24 grey700 · right 10 24 10 8 grey900 · 16/21.6">
		<TableRow
			rows={[
				{ left: "받는 분", right: "김토스" },
				{ left: "받는 분 통장표시", right: "강토스" },
				{ left: "보내는 금액", right: "50,000원" },
				{ left: "미리알림", right: "이체 1일 전" },
			]}
		/>
		<div class="h-3"></div>
		<TableRow align="left" rows={[{ left: "입금 계좌", right: "토스뱅크 1000-1234" }, { left: "메모", right: "월세" }]} />
	</Demo>

	<Demo id="border" bleed title="Border" spec="full 1px hairline · padding24 from x 24 · height16 grey100 section band">
		<ul class="m-0 p-0">
			<ListRow title="동해물과 백두산이" />
			<Border />
			<ListRow title="마르고 닳도록" />
			<Border variant="padding24" />
			<ListRow title="하느님이 보우하사" />
			<Border variant="height16" />
			<ListRow title="우리나라 만세" />
		</ul>
	</Demo>

	<Demo id="stepper" bleed title="Stepper" spec="row padding 3 24 · 30px grey100 number disc + 14 gap · 2px grey200 connector · A 17/25.5/700 + 15/22.5 · B 20/29/700 + 13/19.5/500">
		<Stepper
			steps={[
				{ title: "신분증 촬영", description: "주민등록증 또는 운전면허증" },
				{ title: "본인 계좌 인증", description: "1원을 보내드려요", right: arrowRight },
				{ title: "비밀번호 설정", description: "6자리 숫자", right: goButton },
			]}
		/>
		<Stepper type="B" steps={[{ title: "큰 크기의 제목", description: "작은 크기의 설명" }, { title: "두 번째 단계" }]} />
	</Demo>
</Doc>
