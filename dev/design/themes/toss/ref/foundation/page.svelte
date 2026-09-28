<!-- draft-meta: {"route":"foundation","title":"Foundation","style":"toss"} -->
<!-- /foundation/colors + /foundation/typography + the geometry tokens every snippet reads.
     Every swatch and sample is painted from a layout.css token, so scheme=dark shows the adaptive values. -->
<script lang="ts">
	import Demo from "../demo.svelte";
	import Doc from "../doc.svelte";

	const HUES = ["grey", "blue", "red", "orange", "yellow", "green", "teal", "purple"];
	const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

	const SURFACES = [
		["--surface-base", "adaptiveBackground · 화면"],
		["--surface-grey", "greyBackground · 캔버스 / 그룹"],
		["--surface-layered", "layeredBackground · 겹친 카드"],
		["--surface-float", "floatBackground · 다이얼로그, 시트"],
		["--surface-well", "greyOpacity50 · 입력 웰"],
		["--surface-hover", "greyOpacity100 · 눌림, weak"],
		["--surface-selected", "blue50 · 선택"],
		["--hairline", "hairlineBorder · 0.8px 구분선"],
	];
	const INKS = [
		["--ink-strong", "grey900 · 본문 기본"],
		["--ink", "grey800 · 제목, 라벨"],
		["--ink-soft", "grey700 · 리스트, 본문 보조"],
		["--ink-subtle", "grey600 · 설명, help"],
		["--ink-faint", "grey500 · 메뉴 헤더"],
		["--ink-disabled", "grey400 · placeholder"],
		["--ink-link", "blue500 · 링크, 확인"],
	];
	const STATUS = ["--status-info", "--status-success", "--status-warning", "--status-danger", "--status-neutral", "--status-rating"];

	const SCALE = [
		["t1", "30 / 40", "매우 큰 제목"],
		["st1", "29 / 38", ""],
		["st2", "28 / 37", ""],
		["st3", "27 / 36", ""],
		["t2", "26 / 35", "큰 제목"],
		["st4", "25 / 34", ""],
		["st5", "24 / 33", "조금 큰 제목"],
		["st6", "23 / 32", ""],
		["t3", "22 / 31", "일반 제목"],
		["st7", "21 / 30", ""],
		["t4", "20 / 29", "작은 제목"],
		["st8", "19 / 28", "조금 큰 본문"],
		["st9", "18 / 27", ""],
		["t5", "17 / 25.5", "일반 본문"],
		["st10", "16 / 24", ""],
		["t6", "15 / 22.5", "작은 본문"],
		["st11", "14 / 21", ""],
		["t7", "13 / 19.5", "안 읽어도 됨"],
		["st12", "12 / 18", ""],
		["st13", "11 / 16.5", "아예 안읽어도 됨"],
	];
	const CONTROL = [
		["control-sm", "13 / 16.276", "Button small"],
		["control-md", "15 / 18.78", "Button medium"],
		["control", "17 / 21.284", "Button large · xlarge · Tab"],
		["control-lg", "20 / 25.04", "TextButton large"],
		["control-xl", "22 / 27.544", "TextButton xlarge"],
		["control-2xl", "28 / 35.056", "TextButton xxlarge"],
		["row", "17 / 22.95", "ListRow title (x1.35)"],
		["row-sm", "15 / 20.25", "ListRow sub"],
		["row-xs", "13 / 17.55", "ListRow caption"],
	];
	const HEIGHTS = [
		["--control-height-sm", "32"],
		["--control-height", "38"],
		["--control-height-lg", "48"],
		["--control-height-xl", "56"],
		["--field-box-height", "55"],
		["--field-well-height", "44"],
		["--tab-height", "47"],
		["--segment-height", "48"],
	];
	const RADII = [
		["--control-radius-sm", "8"],
		["--control-radius", "10"],
		["--icon-button-radius", "12"],
		["--control-radius-lg", "14"],
		["--control-radius-xl", "16"],
		["--menu-radius", "20"],
		["--dialog-radius", "24"],
		["--sheet-radius", "28"],
	];
	const SHADOWS = [
		["--shadow-thumb", "segment thumb"],
		["--shadow-toast", "toast"],
		["--shadow-float", "menu"],
		["--shadow-float-strong", "tooltip"],
	];
</script>

<Doc
	page="foundation"
	crumb="파운데이션"
	title="Foundation"
	lead="TDS의 색은 전부 adaptive 토큰입니다. 라이트/다크 값이 layout.css의 :root와 .dark에 쌍으로 들어 있어 컴포넌트는 스킴을 분기하지 않습니다. 타이포는 t1…t7 / st1…st13 스케일이고, 버튼 라벨과 리스트 텍스트만 별도 행간(1.252, 1.35)을 씁니다."
	toc={[
		{ id: "colors", label: "Colors" },
		{ id: "roles", label: "Surface · Ink · Status" },
		{ id: "typography", label: "Typography" },
		{ id: "control-type", label: "Control / List type" },
		{ id: "tokens", label: "Geometry tokens" },
		{ id: "elevation", label: "Elevation" },
	]}
>
	<Demo id="colors" title="Colors" frame="wide" spec="--grey-50 … --purple-900 (bg-grey-100, text-blue-500) · greyOpacity = --grey-opacity-50 … 900">
		<div class="grid gap-2">
			{#each HUES as hue (hue)}
				<div class="grid grid-cols-[64px_repeat(10,minmax(0,1fr))] items-center gap-1">
					<code class="text-st12 text-ink-subtle">{hue}</code>
					{#each STEPS as step (step)}
						<div class="h-9 rounded-md" style:background={`var(--${hue}-${step})`} title={`--${hue}-${step}`}></div>
					{/each}
				</div>
			{/each}
			<div class="grid grid-cols-[64px_repeat(10,minmax(0,1fr))] items-center gap-1">
				<code class="text-st12 text-ink-subtle">opacity</code>
				{#each STEPS as step (step)}
					<div class="h-9 rounded-md border border-hairline" style:background={`var(--grey-opacity-${step})`} title={`--grey-opacity-${step}`}></div>
				{/each}
			</div>
			<div class="grid grid-cols-[64px_repeat(10,minmax(0,1fr))] gap-1 text-center">
				<span></span>
				{#each STEPS as step (step)}<code class="text-st13 text-ink-faint">{step}</code>{/each}
			</div>
		</div>
	</Demo>

	<Demo id="roles" title="Surface · Ink · Status" frame="wide" canvas="grey">
		<div class="grid gap-6 md:grid-cols-2">
			<div class="grid gap-2">
				{#each SURFACES as [token, note] (token)}
					<div class="flex items-center gap-3">
						<div class="h-10 w-16 shrink-0 rounded-lg border border-hairline" style:background={`var(${token})`}></div>
						<div class="min-w-0">
							<code class="block text-st12 text-ink">{token}</code>
							<span class="text-st12 text-ink-subtle">{note}</span>
						</div>
					</div>
				{/each}
			</div>
			<div class="grid content-start gap-2 rounded-2xl bg-surface-base p-4">
				{#each INKS as [token, note] (token)}
					<div class="flex items-baseline gap-3">
						<span class="w-28 shrink-0 text-t5 font-semibold" style:color={`var(${token})`}>토스 가나다</span>
						<code class="text-st12 text-ink-subtle">{token} · {note}</code>
					</div>
				{/each}
				<div class="mt-2 flex flex-wrap gap-2">
					{#each STATUS as token (token)}
						<span class="inline-flex items-center gap-1.5 text-st12 text-ink-subtle">
							<i class="size-3 rounded-full" style:background={`var(${token})`}></i>{token.replace("--status-", "")}
						</span>
					{/each}
				</div>
			</div>
		</div>
	</Demo>

	<Demo id="typography" title="Typography" frame="wide" spec="text-t1 … text-t7 · text-st1 … text-st13 · line height = size × 1.5 (× 4/3 from 30px)">
		<div class="grid gap-1">
			{#each SCALE as [step, size, usage] (step)}
				<div class="grid grid-cols-[56px_84px_minmax(0,1fr)] items-baseline gap-3" class:opacity-60={!usage}>
					<code class="text-st12 text-ink-faint">{step}</code>
					<code class="text-st12 text-ink-faint">{size}</code>
					<span class="truncate text-ink-strong" style:font-size={`var(--text-${step})`} style:line-height={`var(--text-${step}--line-height)`} style:font-weight={usage ? 700 : 400}>
						{usage || "동해물과 백두산이"}
					</span>
				</div>
			{/each}
		</div>
	</Demo>

	<Demo id="control-type" title="Control / List type" frame="wide" spec="button label leading = fontSize × 1.252 · list text leading = × 1.35">
		<div class="grid gap-2">
			{#each CONTROL as [name, size, usage] (name)}
				<div class="grid grid-cols-[110px_96px_minmax(0,1fr)] items-baseline gap-3">
					<code class="text-st12 text-ink-faint">text-{name}</code>
					<code class="text-st12 text-ink-faint">{size}</code>
					<span
						class="text-ink"
						style:font-size={`var(--text-${name})`}
						style:line-height={`var(--text-${name}--line-height)`}
						style:font-weight={`var(--text-${name}--font-weight)`}>{usage}</span
					>
				</div>
			{/each}
		</div>
	</Demo>

	<Demo id="tokens" title="Geometry tokens" frame="wide">
		<div class="grid gap-8 md:grid-cols-2">
			<div class="flex flex-wrap items-end gap-3">
				{#each HEIGHTS as [token, px] (token)}
					<div class="grid justify-items-center gap-1">
						<div class="w-10 rounded-md bg-blue-100" style:height={`var(${token})`}></div>
						<code class="text-st13 text-ink-faint">{px}</code>
					</div>
				{/each}
				<p class="basis-full text-st12 text-ink-subtle">control / field / tab / segment heights</p>
			</div>
			<div class="flex flex-wrap items-end gap-3">
				{#each RADII as [token, px] (token)}
					<div class="grid justify-items-center gap-1">
						<div class="size-14 border-2 border-blue-400 bg-blue-50" style:border-radius={`var(${token})`}></div>
						<code class="text-st13 text-ink-faint">{px}</code>
					</div>
				{/each}
				<p class="basis-full text-st12 text-ink-subtle">radius: control sm/md/lg/xl, icon button, menu, dialog, sheet</p>
			</div>
		</div>
	</Demo>

	<Demo id="elevation" title="Elevation" frame="wide" canvas="grey">
		<div class="grid grid-cols-2 gap-6 p-4 md:grid-cols-4">
			{#each SHADOWS as [token, note] (token)}
				<div class="grid h-24 place-items-center rounded-2xl bg-surface-float" style:box-shadow={`var(${token})`}>
					<div class="text-center">
						<code class="block text-st12 text-ink">{token}</code>
						<span class="text-st12 text-ink-subtle">{note}</span>
					</div>
				</div>
			{/each}
		</div>
	</Demo>
</Doc>
