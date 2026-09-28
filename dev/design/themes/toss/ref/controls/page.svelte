<!-- draft-meta: {"route":"controls","title":"Controls","style":"toss"} -->
<!-- TextButton, IconButton, Badge, Checkbox, Switch, SegmentedControl, Tab — each block mirrors
     the live docs examples for that route and renders the copy-paste snippet from ../../components. -->
<script lang="ts">
	import Demo from "../demo.svelte";
	import Doc from "../doc.svelte";
	import Badge from "../../components/badge.svelte";
	import Checkbox from "../../components/checkbox.svelte";
	import IconButton from "../../components/icon-button.svelte";
	import SegmentedControl from "../../components/segmented-control.svelte";
	import Switch from "../../components/switch.svelte";
	import Tab from "../../components/tab.svelte";
	import TextButton from "../../components/text-button.svelte";

	const TB_SIZES = ["xsmall", "small", "medium", "large", "xlarge", "xxlarge"] as const;
	const BADGE_COLORS = ["blue", "teal", "green", "red", "yellow", "elephant"] as const;
	const BADGE_SIZES = ["xsmall", "small", "medium", "large"] as const;

	let agree = $state(true);
	let pick = $state(false);
	let line = $state(true);
	let on = $state(true);
	let off = $state(false);
	let seg = $state("a");
	let tab = $state("1");
</script>

{#snippet search()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 20 20" /></svg>
{/snippet}
{#snippet bell()}
	<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.4 15.3A1 1 0 0 0 5.3 17h13.4a1 1 0 0 0 .9-1.7L18 12.6V9a6 6 0 0 0-6-6Zm-2.5 15a2.5 2.5 0 0 0 5 0Z" /></svg>
{/snippet}

<Doc
	page="controls"
	crumb="컴포넌트"
	title="Controls"
	lead="눌러서 바로 반응하는 작은 컨트롤입니다. 모든 수치는 390px 뷰포트에서 실측했고, 색은 전부 adaptive 토큰이라 다크에서도 그대로 동작합니다."
	toc={[
		{ id: "text-button", label: "Text Button" },
		{ id: "icon-button", label: "Icon Button" },
		{ id: "badge", label: "Badge" },
		{ id: "checkbox", label: "Checkbox" },
		{ id: "switch", label: "Switch" },
		{ id: "segmented-control", label: "Segmented Control" },
		{ id: "tab", label: "Tab" },
	]}
>
	<Demo id="text-button" title="Text Button" spec="13 · 15 · 17 · 20/600 · 22/700 · 28/700, leading × 1.252, grey600; press layer greyOpacity100">
		<div class="flex flex-wrap items-center gap-x-5 gap-y-3">
			{#each TB_SIZES as size (size)}<TextButton {size}>텍스트 버튼</TextButton>{/each}
		</div>
		<div class="mt-4 flex flex-wrap items-center gap-5">
			<TextButton variant="arrow">화살표</TextButton>
			<TextButton variant="underline" tone="soft">밑줄</TextButton>
			<TextButton tone="link" size="small">링크 색상</TextButton>
		</div>
	</Demo>

	<Demo id="icon-button" title="Icon Button" spec="48 × 48 (12px padding, 24px icon), r12 · clear · fill greyOpacity100 · border 0.8px">
		<div class="flex items-center gap-2">
			<IconButton label="검색하기">{@render search()}</IconButton>
			<IconButton label="검색하기" variant="fill">{@render search()}</IconButton>
			<IconButton label="검색하기" variant="border">{@render search()}</IconButton>
			<IconButton label="알림 열기" iconSize={20}>{@render bell()}</IconButton>
		</div>
	</Demo>

	<Demo id="badge" title="Badge" spec="21/24/26/29 high → r 9/11/12/13 · fill 500-600 · weak = 400 at 16%">
		<div class="grid gap-3">
			<div class="flex flex-wrap items-center gap-2">
				{#each BADGE_SIZES as size (size)}<Badge {size}>{size}</Badge>{/each}
			</div>
			<div class="flex flex-wrap gap-2">
				{#each BADGE_COLORS as color (color)}<Badge size="small" {color}>{color}</Badge>{/each}
			</div>
			<div class="flex flex-wrap gap-2">
				{#each BADGE_COLORS as color (color)}<Badge size="small" {color} variant="weak">{color}</Badge>{/each}
			</div>
		</div>
	</Demo>

	<Demo id="checkbox" title="Checkbox" spec="24px · circle (grey300 → blue500 disc) · line (check only) · label gap 8 · disabled .4">
		<div class="grid gap-3">
			<Checkbox bind:checked={agree}>약관에 동의해요</Checkbox>
			<Checkbox bind:checked={pick}>마케팅 수신 동의</Checkbox>
			<Checkbox variant="line" bind:checked={line}>line 형태</Checkbox>
			<div class="flex gap-4">
				<Checkbox checked disabled>비활성화</Checkbox>
				<Checkbox variant="line" checked disabled>line</Checkbox>
			</div>
		</div>
	</Demo>

	<Demo id="switch" title="Switch" spec="50 × 30 r15 · thumb 16 off / 24 on, 7px inset · grey200 / blue500 · disabled .3">
		<div class="flex items-center gap-3">
			<Switch bind:checked={on} label="알림" />
			<Switch bind:checked={off} label="마케팅" />
			<Switch checked disabled label="비활성화" />
			<Switch disabled label="비활성화" />
		</div>
	</Demo>

	<Demo id="segmented-control" bleed title="Segmented Control" spec="48h track r14 greyOpacity100 · padding 4 5 · thumb r10 white + 0 1px 2px .09 · 17/25.5 600/500">
		<div class="grid gap-4">
			<SegmentedControl
				items={[
					{ value: "a", label: "아이템1" },
					{ value: "b", label: "아이템2" },
					{ value: "c", label: "아이템3" },
				]}
				bind:value={seg}
			/>
			<SegmentedControl
				alignment="fluid"
				name="fluid"
				items={[
					{ value: "d", label: "일간" },
					{ value: "w", label: "주간" },
					{ value: "m", label: "월간" },
					{ value: "y", label: "연간" },
				]}
			/>
		</div>
	</Demo>

	<Demo id="tab" bleed title="Tab" spec="large 47h / small 37h · item padding 0 8 · 17 (15) × 1.252 · 700 selected / 600 idle · indicator 2px inset 10">
		<div class="grid gap-4">
			<Tab
				items={[
					{ key: "1", label: "탭1" },
					{ key: "2", label: "탭2" },
					{ key: "3", label: "탭3", redBean: true },
				]}
				bind:value={tab}
			/>
			<Tab
				size="small"
				fluid
				items={[
					{ key: "a", label: "전체" },
					{ key: "b", label: "입금" },
					{ key: "c", label: "출금" },
					{ key: "d", label: "예약" },
				]}
			/>
		</div>
	</Demo>
</Doc>
