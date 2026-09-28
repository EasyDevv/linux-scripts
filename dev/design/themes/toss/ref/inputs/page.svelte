<!-- draft-meta: {"route":"inputs","title":"Inputs","style":"toss"} -->
<!-- TextField (box / line / big / hero), TextArea, SplitTextField, SearchField, NumericSpinner, Slider, Rating. -->
<script lang="ts">
	import Demo from "../demo.svelte";
	import Doc from "../doc.svelte";
	import NumericSpinner from "../../components/numeric-spinner.svelte";
	import Rating from "../../components/rating.svelte";
	import SearchField from "../../components/search-field.svelte";
	import Slider from "../../components/slider.svelte";
	import SplitTextField from "../../components/split-text-field.svelte";
	import TextArea from "../../components/text-area.svelte";
	import TextField from "../../components/text-field.svelte";

	let name = $state("김토스");
	let amount = $state("");
	let query = $state("토스뱅크");
	let count = $state(1);
	let slide = $state(50);
	let stars = $state(4);
</script>

<Doc
	page="inputs"
	crumb="컴포넌트"
	title="Inputs"
	lead="값을 입력받는 컴포넌트입니다. 입력 박스는 greyOpacity50 웰 위에 0.8px greyOpacity100 선을 두르고, 라벨·도움말은 화면 가장자리에서 24px, 박스는 20px 들여 씁니다."
	toc={[
		{ id: "text-field", label: "TextField" },
		{ id: "text-field-line", label: "TextField line · big · hero" },
		{ id: "text-area", label: "TextArea" },
		{ id: "split-text-field", label: "SplitTextField" },
		{ id: "search-field", label: "SearchField" },
		{ id: "numeric-spinner", label: "Numeric Spinner" },
		{ id: "slider", label: "Slider" },
		{ id: "rating", label: "Rating" },
	]}
>
	<Demo id="text-field" bleed title="TextField" spec="box 55h · padding 14 16 · r14 · 0.8px greyOpacity100 on greyOpacity50 · 17/25.5 · label/help 13/19.5">
		<TextField label="이름" help="실명을 입력해주세요" placeholder="이름" bind:value={name} clearable />
		<TextField label="금액" placeholder="0" suffix="원" bind:value={amount} inputmode="numeric" />
		<TextField label="에러 상태" help="3글자 이상 입력해주세요" value="토스뱅크 계좌" hasError />
		<TextField label="비활성화" placeholder="Placeholder" disabled />
	</Demo>

	<Demo id="text-field-line" bleed title="TextField line · big · hero" spec="line 22/31/600 + 1.6px grey100 rule · big 30/40/600 · hero 30/40/600 no rule">
		<TextField variant="line" label="line" placeholder="Placeholder" help="help" />
		<TextField variant="big" label="big" placeholder="Placeholder" help="help" />
		<TextField variant="hero" label="hero" placeholder="Placeholder" help="help" />
	</Demo>

	<Demo id="text-area" bleed title="TextArea" spec="same well as box, aligned top · fixed height 200 or min-height 100 (grows)">
		<TextArea label="문의 내용" placeholder="텍스트를 입력해보세요." help="높이가 자동으로 조절되는 텍스트 필드" />
	</Demo>

	<Demo id="split-text-field" bleed title="SplitTextField" spec="box: two 55h wells + '-' gap 6 · line: 22/31/600 underlines gap 12">
		<SplitTextField label="주민등록번호" firstPlaceholder="생년월일" secondPlaceholder="뒷자리" help="주민등록번호를 입력해주세요." />
		<SplitTextField variant="line" label="주민등록번호" firstPlaceholder="앞자리" />
	</Demo>

	<Demo id="search-field" bleed title="SearchField" spec="bar 14px 16px + 16px fade · well 44h r12 greyOpacity100 · padding 8 10 · gap 8 · 16/20">
		<SearchField bind:value={query} />
		<SearchField />
	</Demo>

	<Demo id="numeric-spinner" title="Numeric Spinner" spec="tiny 87×32 r8 · small 105×39 r10 · medium 125×50 r14 · large 153×58 r16 · value box white + 0 1px 3px .09">
		<div class="flex flex-wrap items-center gap-3">
			<NumericSpinner size="tiny" />
			<NumericSpinner size="small" number={3} />
			<NumericSpinner size="medium" number={12} />
			<NumericSpinner bind:number={count} />
		</div>
		<div class="mt-3"><NumericSpinner disable number={2} /></div>
	</Demo>

	<Demo id="slider" title="Slider" spec="40h hit · 5px grey200 track r2.5 · fill blue400 inside a 12px inset · labels 13/19.5/500 grey600">
		<div class="grid gap-3">
			<Slider bind:value={slide} />
			<Slider value={70} color="var(--green-500)" />
			<Slider value={30} color="var(--red-500)" label={{ min: "100 만원", mid: "150 만원", max: "200 만원" }} />
			<Slider value={60} tooltip="60%" />
		</div>
	</Demo>

	<Demo id="rating" title="Rating" spec="star yellow400 · tiny 20 · small 24 · medium 32 · large 40 · readOnly value 17/20/22/24">
		<div class="grid gap-4">
			<Rating bind:value={stars} size="large" />
			<Rating value={5} size="tiny" readOnly />
			<Rating value={4} size="small" readOnly />
			<Rating value={4} size="medium" readOnly />
			<Rating value={4.8} size="small" variant="compact" readOnly />
			<Rating value={3} size="small" disabled />
		</div>
	</Demo>
</Doc>
