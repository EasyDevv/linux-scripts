<!-- draft-meta: {"route":"overlays","title":"Overlays","style":"toss"} -->
<!-- Dialog (alert / confirm), Modal, BottomSheet, Toast, Tooltip, Menu.
     Each block shows the open state inline (measured geometry) on a dimmed canvas,
     plus a trigger that opens the real fixed overlay. -->
<script lang="ts">
	import Demo from "../demo.svelte";
	import Doc from "../doc.svelte";
	import BottomSheet from "../../components/bottom-sheet.svelte";
	import Button from "../../components/button.svelte";
	import Dialog from "../../components/dialog.svelte";
	import ListRow from "../../components/list-row.svelte";
	import Menu from "../../components/menu.svelte";
	import Modal from "../../components/modal.svelte";
	import Toast from "../../components/toast.svelte";
	import Tooltip from "../../components/tooltip.svelte";

	let alert = $state(false);
	let confirm = $state(false);
	let modal = $state(false);
	let sheet = $state(false);
	let toastTop = $state(false);
	let toastBottom = $state(false);
	let tip = $state(false);
</script>

{#snippet sheetCta()}<Button display="block" variant="weak" color="dark" onclick={() => (sheet = false)}>닫기</Button><Button display="block" onclick={() => (sheet = false)}>확인</Button>{/snippet}
{#snippet sheetCtaStatic()}<Button display="block">확인</Button>{/snippet}
{#snippet check()}<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="var(--green-500)" /><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>{/snippet}

<Doc
	page="overlays"
	crumb="컴포넌트"
	title="Overlays"
	lead="화면 위에 뜨는 요소입니다. 딤은 라이트에서 검정 20%, 다크에서 56%이고, 다이얼로그 계열은 320px 폭 · 24px 반경의 floatBackground 패널입니다."
	toc={[
		{ id: "dialog", label: "Dialog" },
		{ id: "modal", label: "Modal" },
		{ id: "bottom-sheet", label: "BottomSheet" },
		{ id: "toast", label: "Toast" },
		{ id: "tooltip", label: "Tooltip" },
		{ id: "menu", label: "Menu" },
	]}
>
	<Demo id="dialog" title="Dialog" canvas="grey" spec="320 · r24 · body 22 22 0 gap 8 · title 20/27/700 · desc 15/22.5/500 grey600 · alert TextButton 700 blue500 · confirm 2 × Button large gap 8">
		<div class="grid gap-4 rounded-2xl px-4 py-6" style="background: var(--overlay-dimmed)">
			<Dialog inline title={"김토스님의 의견이\n잘 전달되었어요"} description="소중한 의견을 바탕으로 더 간편한 서비스를 만들게요." />
			<Dialog inline variant="confirm" title={"김토스님의 의견이\n잘 전달되었어요"} description={"소중한 의견을 바탕으로 더 간편한\n서비스를 만들게요."} />
		</div>
		<div class="mt-4 flex justify-center gap-2">
			<Button size="medium" onclick={() => (alert = true)}>알림 다이얼로그</Button>
			<Button size="medium" variant="weak" onclick={() => (confirm = true)}>확인 다이얼로그</Button>
		</div>
		<Dialog bind:open={alert} title="송금을 완료했어요" description="김토스님에게 50,000원을 보냈어요." />
		<Dialog bind:open={confirm} variant="confirm" title="정말 해지할까요?" description="해지하면 쌓인 포인트가 사라져요." confirmText="해지하기" cancelText="취소" />
	</Demo>

	<Demo id="modal" title="Modal" canvas="grey" spec="320 · r24 · padding 32 20 20 · centred column · free content">
		<div class="rounded-2xl px-4 py-6" style="background: var(--overlay-dimmed)">
			<Modal inline>
				<p class="m-0 mb-6 text-t5 text-ink-soft">동해물과 백두산이 마르고 닳도록 하느님이 보우하사 우리나라 만세 무궁화 삼천리 화려강산 대한사람 대한으로 길이 보전하세</p>
				<Button display="block">확인</Button>
			</Modal>
		</div>
		<div class="mt-4 flex justify-center"><Button size="medium" onclick={() => (modal = true)}>모달 열기</Button></div>
		<Modal bind:open={modal}>
			<p class="m-0 mb-6 text-t5 text-ink-soft">모달 내용이에요. 딤을 누르면 닫혀요.</p>
			<Button display="block" onclick={() => (modal = false)}>확인</Button>
		</Modal>
	</Demo>

	<Demo id="bottom-sheet" title="BottomSheet" canvas="grey" spec="floating · 10px inset · r28 · grip 48×4 r5 grey200 @12 · body 17/25.5 grey700 inset 24 · CTA padding 16 20 20">
		<div class="overflow-hidden rounded-2xl pt-16" style="background: var(--overlay-dimmed)">
			<BottomSheet inline title="계좌를 선택해주세요" description="자주 쓰는 계좌가 위에 보여요" cta={sheetCtaStatic}>
				<ul class="m-0 p-0">
					<ListRow title="토스뱅크" description="1000-1234-5678" withArrow />
					<ListRow title="국민은행" description="123-45-678901" withArrow />
				</ul>
			</BottomSheet>
		</div>
		<div class="mt-4 flex justify-center"><Button size="medium" onclick={() => (sheet = true)}>BottomSheet 열기</Button></div>
		<BottomSheet bind:open={sheet} cta={sheetCta}><p>저는 BottomSheet 내용이에요</p></BottomSheet>
	</Demo>

	<Demo id="toast" title="Toast" canvas="grey" spec="top: pill · 12 16 · float + 0 2px 30px greyOpacity200 · 15/22.5/600 · bottom: grey500 · 14 20 · button 32h pill greyOpacity400">
		<div class="grid justify-items-center gap-3">
			<Toast inline text="기본 토스트 메시지이에요" />
			<Toast inline text="아이콘이 포함된 토스트이에요" leftAddon={check} />
			<Toast inline position="bottom" text="하단 토스트 메시지이에요" />
			<Toast inline position="bottom" text="버튼이 포함된 토스트이에요" buttonText="확인" />
		</div>
		<div class="mt-4 flex justify-center gap-2">
			<Button size="medium" onclick={() => (toastTop = true)}>상단 토스트</Button>
			<Button size="medium" variant="weak" onclick={() => (toastBottom = true)}>하단 토스트</Button>
		</div>
		<Toast bind:open={toastTop} text="복사했어요" leftAddon={check} />
		<Toast bind:open={toastBottom} position="bottom" text="계좌번호를 복사했어요" buttonText="보기" />
	</Demo>

	<Demo id="tooltip" title="Tooltip" spec="small 8 12 r12 13/19.5/600 · medium 13 16 r16 15/22.5/700 · float + 0 16px 60px greyOpacity300 · arrow">
		<div class="grid justify-items-center gap-4">
			<Tooltip inline size="small" message="툴팁입니다." />
			<Tooltip inline message="툴팁입니다." anchorPositionByRatio={0.2} />
			<Tooltip inline size="large" message="송금 한도는 하루 1천만원이에요." />
			<div class="pt-2 pb-20">
				<Tooltip message="눌러서 열고 닫아요" bind:open={tip}>
					<Button size="small" variant="weak">Click Me</Button>
				</Tooltip>
			</div>
		</div>
	</Demo>

	<Demo id="menu" title="Menu" canvas="grey" frame="wide" spec="182 · r20 · glass white 80% + blur 30 · padding 10 0 · header 13/19.5/700 grey500 · item 42h, 8 20, 17/25.5/500 grey700">
		<div class="flex flex-wrap items-start justify-center gap-6 py-2">
			<Menu header="편집" items={[{ label: "첫 번째 메뉴" }, { label: "두 번째 메뉴" }, { label: "세 번째 메뉴" }]} />
			<Menu header="정렬" items={[{ label: "최신순", checked: true }, { label: "금액순", checked: false }, { label: "이름순", checked: false }]} />
		</div>
	</Demo>
</Doc>
