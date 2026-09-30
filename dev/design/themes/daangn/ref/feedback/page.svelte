<!-- draft-meta: {"route":"feedback","title":"Feedback","style":"daangn"} -->
<!-- Reconstruction of seed-design.io/react/components/{callout, page-banner, progress-circle, skeleton,
     help-bubble, snackbar}: the visual docs previews in order (data-live = census index). Snackbar and
     tooltip-mode HelpBubble open on interaction in the docs, so their previews here render inline
     (no census pair). -->
<script lang="ts">
	import Calendar from "@lucide/svelte/icons/calendar";
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import Info from "@lucide/svelte/icons/info";
	import Sparkles from "@lucide/svelte/icons/sparkles";
	import ActionButton from "../../components/action-button.svelte";
	import Callout from "../../components/callout.svelte";
	import HelpBubble from "../../components/help-bubble.svelte";
	import PageBanner from "../../components/page-banner.svelte";
	import ProgressCircle from "../../components/progress-circle.svelte";
	import Skeleton from "../../components/skeleton.svelte";
	import Snackbar from "../../components/snackbar.svelte";
	import Switch from "../../components/switch.svelte";
	import Text from "../../components/text.svelte";
	import Demo from "../demo.svelte";
	import Doc from "../doc.svelte";

	const AUTE = "Aute nulla proident tempor minim eiusmod. In nostrud officia irure laborum.";
	const DESC = "기능에 대한 안내 또는 유익한 내용을 전달해요. 콜아웃은 꼭 필요한 경우에만 절제하여 사용해요.";
	const UT = "Ut veniam in ea ea anim laborum magna dolore ea laborum duis ut aute mollit amet.";
	const TONES = ["neutral", "informative", "positive", "warning", "critical", "magic"] as const;
	type Tone = (typeof TONES)[number];
	const COMPOSITION = [
		["text-only", "Text only", {}, true],
		["with-icon", "With icon", { prefixIcon: Calendar }, true],
		["with-title", "With title", { title: "타이틀" }, true],
		["with-link", "With link label", { link: "시도해 보기" }, false],
		["with-all", "With everything", { title: "타이틀", prefixIcon: Calendar, link: "시도해 보기" }, false],
		["link-as-child", "Link label as child", { link: "시도해 보기" }, false],
	] as const;

	let helpOpen = $state(true);
	let closeOpen = $state(true);
	let loading = $state(true);
	let snack = $state<"default" | "positive" | "critical" | null>(null);
</script>

<Doc
	page="feedback"
	title="Feedback"
	lead="상태와 안내를 전하는 컴포넌트: Callout, Page Banner, Progress Circle, Skeleton, Help Bubble, Snackbar."
	toc={[
		{ id: "callout", label: "Callout" },
		{ id: "page-banner", label: "Page Banner" },
		{ id: "progress-circle", label: "Progress Circle" },
		{ id: "skeleton", label: "Skeleton" },
		{ id: "help-bubble", label: "Help Bubble" },
		{ id: "snackbar", label: "Snackbar" },
	]}
>
	<!-- ───────────── Callout ───────────── -->
	<h2 id="callout" style="margin: 72px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Callout</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">기능에 대한 안내나 유익한 내용을 전달하는 박스입니다.</p>
	<Demo id="callout-preview" live="callout:0" wide>
		<div class="flex w-full flex-col" style="gap: var(--dimension-x4)">
			<Callout description={AUTE} />
			<Callout kind="actionable" description={AUTE} />
			<Callout kind="dismissible" description={AUTE} />
		</div>
	</Demo>
	{#each COMPOSITION as [id, title, extra, actionable], i (id)}
		<Demo id="callout-{id}" title="콘텐츠 구성 — {title}" level={3} live="callout:{i + 1}" wide>
			<div class="flex w-full flex-col" style="gap: var(--dimension-x4)">
				<Callout description={DESC} {...extra} />
				{#if actionable}<Callout kind="actionable" description={DESC} {...extra} />{/if}
				<Callout kind="dismissible" description={DESC} {...extra} />
			</div>
		</Demo>
	{/each}
	{#each TONES as tone, i (tone)}
		<Demo id="callout-{tone}" title="톤 — {tone}" level={3} live="callout:{i + 7}" wide>
			<div class="flex w-full flex-col" style="gap: var(--dimension-x4)">
				{#each ["static", "actionable", "dismissible"] as const as kind (kind)}<Callout {tone} {kind} description={DESC} prefixIcon={tone === "magic" ? Sparkles : Calendar} />{/each}
			</div>
		</Demo>
	{/each}

	<!-- ───────────── Page Banner ───────────── -->
	<h2 id="page-banner" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Page Banner</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">화면 상단에서 페이지 전체에 관한 안내를 보여줍니다.</p>
	<Demo id="page-banner-preview" live="page-banner:0" wide>
		<div class="flex w-full flex-col" style="gap: var(--dimension-x4)">
			<PageBanner description={UT} />
			<PageBanner kind="actionable" description={UT} />
			<PageBanner kind="dismissible" description={UT} />
		</div>
	</Demo>
	<Demo id="page-banner-with-button" title="With Button" level={3} live="page-banner:1" wide><PageBanner description="사업자 정보를 등록해주세요." button="자세히 보기" /></Demo>
	<Demo id="page-banner-button-as-child" title="Rendering PageBannerButton as a Child" level={3} live="page-banner:2" wide><PageBanner description="사업자 정보를 등록해주세요." button="새 탭에서 열기" /></Demo>
	{#each TONES.slice(0, 5) as tone, i (tone)}
		<Demo id="page-banner-{tone}" title="Tones and Variants — {tone}" level={3} live="page-banner:{i + 3}" wide>
			<div class="grid w-full items-start" style="grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px">
				{#each [["static", "weak"], ["static", "solid"], ["actionable", "weak"], ["actionable", "solid"], ["dismissible", "weak"], ["dismissible", "solid"]] as const as [kind, variant] (kind + variant)}
					<PageBanner {tone} {variant} {kind} prefixIcon={CircleAlert} title="미노출" description="사업자 정보를 등록해주세요." button={kind === "static" ? "등록하기" : undefined} />
				{/each}
			</div>
		</Demo>
	{/each}
	<Demo id="page-banner-magic" title="Tones and Variants — magic" level={3} live="page-banner:8" wide>
		<div class="flex w-full flex-col" style="gap: var(--dimension-x4)">
			<PageBanner tone="magic" prefixIcon={Sparkles} title="새로운 기능" description="마법 같은 소식이 도착했어요!" button="둘러보기" />
			<PageBanner tone="magic" kind="actionable" prefixIcon={Sparkles} title="새로운 기능" description="마법 같은 소식이 도착했어요!" />
			<PageBanner tone="magic" kind="dismissible" prefixIcon={Sparkles} title="새로운 기능" description="마법 같은 소식이 도착했어요!" />
		</div>
	</Demo>

	<!-- ───────────── Progress Circle ───────────── -->
	<h2 id="progress-circle" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Progress Circle</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">작업 진행 상태를 원형으로 보여줍니다.</p>
	<Demo id="progress-circle-preview" live="progress-circle:0"><ProgressCircle tone="neutral" size="40" /></Demo>
	<Demo id="progress-circle-neutral" title="Neutral" level={3} live="progress-circle:1"><ProgressCircle tone="neutral" /></Demo>
	<Demo id="progress-circle-brand" title="Brand" level={3} live="progress-circle:2"><ProgressCircle tone="brand" /></Demo>
	<Demo id="progress-circle-static-white" title="Static White" level={3} live="progress-circle:3" wide>
		<div class="flex w-full items-center justify-center" style="min-height: 200px; background: var(--palette-static-black)"><ProgressCircle tone="staticWhite" /></div>
	</Demo>
	<Demo id="progress-circle-40" title="Size=40" level={3} live="progress-circle:4"><ProgressCircle size="40" /></Demo>
	<Demo id="progress-circle-24" title="Size=24" level={3} live="progress-circle:5"><ProgressCircle size="24" /></Demo>
	<Demo id="progress-circle-determinate" title="Determinate" level={3} live="progress-circle:6"><ProgressCircle value={40} /></Demo>
	<Demo id="progress-circle-indeterminate" title="Indeterminate" level={3} live="progress-circle:7"><ProgressCircle /></Demo>

	<!-- ───────────── Skeleton ───────────── -->
	<h2 id="skeleton" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Skeleton</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">콘텐츠가 로딩되는 동안 자리를 채웁니다.</p>
	<Demo id="skeleton-preview" live="skeleton:0">
		<div class="flex flex-col items-center" style="gap: var(--dimension-x4)">
			<Skeleton radius="full" width="var(--dimension-x12)" height="var(--dimension-x12)" />
			<div class="flex flex-col" style="gap: var(--dimension-x2)"><Skeleton height="var(--dimension-x4)" width="250px" /><Skeleton height="var(--dimension-x4)" width="250px" /></div>
		</div>
	</Demo>
	<Demo id="skeleton-line-height" title="Line Height" level={3} live="skeleton:1">
		<div class="flex flex-col items-center" style="gap: var(--dimension-x4)">
			<div class="flex flex-col items-start" style="gap: var(--dimension-x2)">
				{#if loading}<Skeleton height="var(--text-t7--line-height)" width="200px" />{:else}<Text textStyle="t7Bold">콘텐츠 제목</Text>{/if}
				{#if loading}<Skeleton height="var(--text-t4--line-height)" width="250px" />{:else}<Text textStyle="t4Regular">불러온 콘텐츠입니다.</Text>{/if}
			</div>
			<Switch label="로딩 중" bind:checked={loading} />
		</div>
	</Demo>
	<Demo id="skeleton-radius" title="Radius" level={3} live="skeleton:2">
		<div class="flex items-center" style="gap: var(--dimension-x4)">{#each ["0", "8", "16", "full"] as const as radius (radius)}<Skeleton {radius} width="var(--dimension-x12)" height="var(--dimension-x12)" />{/each}</div>
	</Demo>
	<Demo id="skeleton-tone" title="Tone" level={3} live="skeleton:3" wide>
		<div class="flex w-full flex-col items-start" style="gap: var(--dimension-x4)"><Skeleton tone="neutral" radius="16" height="var(--dimension-x12)" /><Skeleton tone="magic" radius="16" height="var(--dimension-x12)" /></div>
	</Demo>

	<!-- ───────────── Help Bubble ───────────── -->
	<h2 id="help-bubble" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Help Bubble</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">요소 옆에 말풍선으로 짧은 도움말을 띄웁니다.</p>
	<Demo id="help-bubble-preview" live="help-bubble:0">
		<HelpBubble bind:open={helpOpen} title="아래 버튼이나 바깥 영역을 클릭해서 닫아보세요."><ActionButton variant="ghost" size="small" icon={Info} aria-label="도움말" /></HelpBubble>
	</Demo>
	<Demo id="help-bubble-close-button" title="Close Button" level={3} live="help-bubble:6">
		<HelpBubble bind:open={closeOpen} closeButton title="Close Button" description="showCloseButton으로 닫기 버튼을 추가할 수 있어요."><ActionButton variant="neutralSolid">토글</ActionButton></HelpBubble>
	</Demo>
	<Demo id="help-bubble-description" title="Description" level={3} live="help-bubble:7">
		<HelpBubble open title="제목" description="제목 아래에 부연 설명을 덧붙일 수 있어요."><Sparkles class="seed-icon" aria-hidden="true" /></HelpBubble>
	</Demo>
	<Demo id="help-bubble-title-only" title="Title Only" level={3} live="help-bubble:8">
		<HelpBubble open title="Title Only"><Sparkles class="seed-icon" aria-hidden="true" /></HelpBubble>
	</Demo>
	<Demo id="help-bubble-tooltip" title="Tooltip (hover / focus)" level={3} spec="HelpBubbleTooltip: same bubble, opens on hover or keyboard focus">
		<HelpBubble tooltip title="포인터를 올리거나 키보드로 포커스하면 열립니다."><ActionButton variant="ghost" size="small" icon={Info} aria-label="도움말" /></HelpBubble>
	</Demo>

	<!-- ───────────── Snackbar ───────────── -->
	<h2 id="snackbar" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Snackbar</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">작업 결과를 화면 하단에 잠시 알려줍니다.</p>
	<Demo id="snackbar-variants" spec="inline render of each variant (the docs open them from a button)">
		<div class="flex flex-col items-center" style="gap: var(--dimension-x3)">
			<Snackbar inline message="스낵바 메시지" action="실행" />
			<Snackbar inline variant="positive" message="성공했어요" action="실행" />
			<Snackbar inline variant="critical" message="실패했어요" action="실행" />
		</div>
	</Demo>
	<Demo id="snackbar-trigger" title="Trigger" level={3}>
		<div class="flex" style="gap: var(--dimension-x2)">
			{#each ["default", "positive", "critical"] as const as v (v)}<ActionButton variant="neutralWeak" onclick={() => (snack = v)}>{v}</ActionButton>{/each}
		</div>
		{#if snack}<Snackbar variant={snack} message={snack === "default" ? "스낵바 메시지" : snack === "positive" ? "성공했어요" : "실패했어요"} action="실행" duration={3000} open={true} />{/if}
	</Demo>
</Doc>
