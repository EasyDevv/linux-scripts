<!-- draft-meta: {"route":"button","title":"Button","style":"toss"} -->
<!-- Reconstruction of https://tossmini-docs.toss.im/tds-mobile/components/button/ :
     same sections in the same order; every preview renders ../../components/button.svelte. -->
<script lang="ts">
	import Demo from "../demo.svelte";
	import Doc from "../doc.svelte";
	import Button from "../../components/button.svelte";

	const COLORS = ["primary", "dark", "danger", "light"] as const;
	const SIZES = [
		["small", "32 · r8 · px10 · 13"],
		["medium", "38 · r10 · px16 · 15"],
		["large", "48 · r14 · px16 · 17"],
		["xlarge", "56 · r16 · px28 · 17"],
	] as const;
</script>

<Doc
	page="button"
	crumb="컴포넌트"
	title="Button"
	lead="Button 컴포넌트는 사용자가 어떤 액션을 트리거하거나 이벤트를 실행할 때 사용해요. 버튼은 기본적인 UI 요소로, 폼 제출, 다이얼로그 열기, 작업 취소, 삭제와 같은 다양한 액션을 처리하는 데 사용해요."
	toc={[
		{ id: "size", label: "크기 조정하기" },
		{ id: "fill", label: "fill" },
		{ id: "weak", label: "weak" },
		{ id: "loading", label: "로딩" },
		{ id: "disabled", label: "비활성화" },
		{ id: "display", label: "너비" },
	]}
>
	<Demo id="basic" title="사용 예제">
		<Button>버튼</Button>
	</Demo>

	<Demo id="size" title="크기 조정하기" spec="height · radius · padding-inline · font-size (label leading × 1.252, weight 600)">
		<div class="grid gap-3">
			{#each SIZES as [size, note] (size)}
				<div class="flex items-center gap-3">
					<Button {size}>Button</Button>
					<code class="text-st12 text-ink-faint">{size} {note}</code>
				</div>
			{/each}
		</div>
	</Demo>

	<Demo id="fill" title="fill" spec="primary blue500 · dark grey700 · danger red500 · light white/blue700">
		<div class="flex flex-wrap justify-center gap-2 rounded-2xl p-4" style="background: var(--grey-100)">
			{#each COLORS as color (color)}<Button {color}>{color}</Button>{/each}
		</div>
	</Demo>

	<Demo id="weak" title="weak" spec="blue300 15% / blue600 · greyOpacity100 / grey700 · red300 15% / red600">
		<div class="flex flex-wrap gap-2">
			{#each COLORS.slice(0, 3) as color (color)}<Button {color} variant="weak">{color}</Button>{/each}
		</div>
		<div class="mt-3 flex flex-wrap justify-center gap-2 rounded-2xl p-4" style="background: var(--blue-500)">
			<Button color="light" variant="weak">light weak</Button>
		</div>
	</Demo>

	<Demo id="loading" title="로딩" spec="aria-busy + aria-live=polite, label hidden, 3 × 8px dots gap 7">
		<div class="flex flex-wrap gap-2">
			<Button loading>Primary</Button>
			<Button color="dark" loading>Dark</Button>
			<Button color="danger" loading>Danger</Button>
		</div>
	</Demo>

	<Demo id="disabled" title="비활성화" spec="opacity .3">
		<div class="flex flex-wrap gap-2">
			<Button disabled>Primary</Button>
			<Button color="dark" disabled>Dark</Button>
			<Button variant="weak" disabled>Weak</Button>
		</div>
	</Demo>

	<Demo id="display" title="너비" spec="display inline | block | full">
		<div class="grid gap-3">
			<Button display="block">block</Button>
			<Button display="block" size="large" variant="weak" color="dark">block large weak</Button>
		</div>
	</Demo>
</Doc>
