<!-- draft-meta: {"route":"feedback","title":"Feedback & Actions","style":"toss"} -->
<!-- Loader, Skeleton, ProgressBar, ProgressStepper, BottomCTA, Keypad (number / alphabet / full secure). -->
<script lang="ts">
	import Demo from "../demo.svelte";
	import Doc from "../doc.svelte";
	import BottomCta from "../../components/bottom-cta.svelte";
	import Button from "../../components/button.svelte";
	import FullSecureKeypad from "../../components/full-secure-keypad.svelte";
	import Loader from "../../components/loader.svelte";
	import NumberKeypad from "../../components/number-keypad.svelte";
	import ProgressBar from "../../components/progress-bar.svelte";
	import ProgressStepper from "../../components/progress-stepper.svelte";
	import Skeleton from "../../components/skeleton.svelte";

	let pin = $state("");
	let progress = $state(0.5);
	let step = $state(1);
</script>

{#snippet top()}<span>토스뱅크에 연결된 계좌만 보여요</span>{/snippet}

<Doc
	page="feedback"
	crumb="컴포넌트"
	title="Feedback & Actions"
	lead="진행 상태와 화면 하단 액션입니다. 트랙은 5px grey200, 진행 색은 blue400이 기본이고, 하단 CTA는 36px 그라데이션 위에 20px 여백으로 붙습니다."
	toc={[
		{ id: "loader", label: "Loader" },
		{ id: "skeleton", label: "Skeleton" },
		{ id: "progress-bar", label: "ProgressBar" },
		{ id: "progress-stepper", label: "ProgressStepper" },
		{ id: "bottom-cta", label: "BottomCTA" },
		{ id: "keypad", label: "Keypad" },
	]}
>
	<Demo id="loader" title="Loader" spec="small 48 · medium 60 · large 80 box · stroke 6 on a 66 viewBox · primary / dark / light · label 15/22.5 grey800">
		<div class="flex flex-wrap items-center gap-5">
			<Loader size="small" />
			<Loader />
			<Loader size="large" />
			<Loader type="dark" />
			<div class="rounded-2xl" style="background: var(--highlight-dim)"><Loader type="light" /></div>
			<Loader label={"김토스님의 카드를\n불러오고있어요."} />
		</div>
	</Demo>

	<Demo id="skeleton" bleed title="Skeleton" spec="padding 24 24 0 · title 126×30 r11 · subtitle 83×22 r9 · card 64h r18 · listWithIcon 40 disc + 42h r13 · grey100">
		<Skeleton />
		<Skeleton pattern="topListWithIcon" repeatLastItemCount={2} />
	</Demo>

	<Demo id="progress-bar" title="ProgressBar" spec="light 2 · normal 5 (r2.5) · bold 8 (r4) · grey200 track · blue400 fill">
		<div class="grid gap-4">
			<ProgressBar progress={progress} animate />
			<ProgressBar progress={0.7} size="light" />
			<ProgressBar progress={0.7} size="bold" color="var(--green-400)" />
			<ProgressBar progress={0.3} color="var(--red-400)" />
			<div class="flex gap-2">
				<Button size="small" variant="weak" color="dark" onclick={() => (progress = Math.max(0, progress - 0.1))}>-10%</Button>
				<Button size="small" variant="weak" onclick={() => (progress = Math.min(1, progress + 0.1))}>+10%</Button>
			</div>
		</div>
	</Demo>

	<Demo id="progress-stepper" bleed title="ProgressStepper" spec="compact: 8px track r40 grey100 + blue500 24-29% fill · 8px dots · 13/19.5 700 active / 600 · icon: 28px discs">
		<ProgressStepper steps={[{ title: "유심 신청" }, { title: "배송 완료" }, { title: "개통 완료" }]} activeStepIndex={step} />
		<ProgressStepper variant="icon" steps={[{ title: "유심 신청" }, { title: "배송 완료" }, { title: "개통 완료" }]} activeStepIndex={step} />
		<div class="flex gap-2 px-6 pt-2">
			<Button size="small" variant="weak" color="dark" onclick={() => (step = Math.max(0, step - 1))}>이전</Button>
			<Button size="small" variant="weak" onclick={() => (step = Math.min(2, step + 1))}>다음</Button>
		</div>
	</Demo>

	<Demo id="bottom-cta" bleed title="BottomCTA" spec="36px fade (to top, base 25%) · bar padding 0 20 20 · Single 56h r16 · Double gap 8 (weak dark + primary)">
		<div class="pt-6">
			<BottomCta><Button display="block">다음</Button></BottomCta>
			<BottomCta topAccessory={top}>
				<Button display="block" variant="weak" color="dark">닫기</Button>
				<Button display="block">확인했어요</Button>
			</BottomCta>
		</div>
	</Demo>

	<Demo id="keypad" bleed title="Keypad" spec="number: rows 66h · 30/64 grey700 · backspace 20 · alphabet 7 cols · secure: dark chrome, random empty cell per row, 56h bottom row">
		<p class="m-0 px-6 pb-2 text-center text-t3 font-bold tracking-[0.3em] text-ink">{pin.padEnd(6, "·")}</p>
		<NumberKeypad onKeyClick={(k) => pin.length < 6 && (pin += k)} onBackspaceClick={() => (pin = pin.slice(0, -1))} />
		<div class="h-4"></div>
		<NumberKeypad variant="alphabet" />
		<div class="h-4"></div>
		<FullSecureKeypad />
	</Demo>
</Doc>
