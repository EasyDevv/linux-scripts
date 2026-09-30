<!-- draft-meta: {"route":"selection","title":"Selection","style":"daangn"} -->
<!-- Reconstruction of seed-design.io/react/components/{checkbox, radio-group, switch, segmented-control,
     select-box, chip, tag-group}: every docs preview in order (data-live = census index); every
     preview renders ../../components/*.svelte. Form-library examples show their initial state. -->
<script lang="ts">
	import Bell from "@lucide/svelte/icons/bell";
	import BellOff from "@lucide/svelte/icons/bell-off";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Diamond from "@lucide/svelte/icons/diamond";
	import Heart from "@lucide/svelte/icons/heart";
	import IceCream from "@lucide/svelte/icons/ice-cream-cone";
	import MapPin from "@lucide/svelte/icons/map-pin";
	import Megaphone from "@lucide/svelte/icons/megaphone";
	import MessageSquare from "@lucide/svelte/icons/message-square";
	import RefreshCw from "@lucide/svelte/icons/refresh-cw";
	import Star from "@lucide/svelte/icons/star";
	import CircleCheck from "@lucide/svelte/icons/circle-check";
	import Timer from "@lucide/svelte/icons/timer";
	import TimerReset from "@lucide/svelte/icons/timer-reset";
	import UserRound from "@lucide/svelte/icons/circle-user-round";
	import ActionButton from "../../components/action-button.svelte";
	import Checkbox from "../../components/checkbox.svelte";
	import CheckboxGroup from "../../components/checkbox-group.svelte";
	import Chip from "../../components/chip.svelte";
	import RadioGroup from "../../components/radio-group.svelte";
	import SegmentedControl from "../../components/segmented-control.svelte";
	import SelectBox from "../../components/select-box.svelte";
	import Switch from "../../components/switch.svelte";
	import TagGroup from "../../components/tag-group.svelte";
	import Text from "../../components/text.svelte";
	import Demo from "../demo.svelte";
	import Doc from "../doc.svelte";

	const LONG =
		"Consequat ut veniam aliqua deserunt occaecat enim occaecat veniam et et cillum nulla officia incididunt incididunt. Sint laboris labore occaecat fugiat culpa voluptate ullamco in elit dolore exercitation nulla.";
	const AVATAR = "https://avatars.githubusercontent.com/u/54893898?v=4";

	let cbCount = $state(0);
	let radioCount = $state(0);
	let radioLast = $state<string | null>(null);
	let radioValue = $state("apple");
	let swCount = $state(0);
	let swLast = $state<boolean | null>(null);
	let swOn = $state(false);
	let swDisabled = $state(true);
	let segSort = $state("monthly");
	let seenAnnual = $state(false);
	let segCount = $state(0);
	let segLast = $state<string | null>(null);
	let segValue = $state("hot");
	let chipToggleCount = $state(0);
	let chipRadio = $state("option1");
	let chipRadioCount = $state(0);
	let bellOn = $state(false);

	const CHIP_DEMOS = [
		["small", "Small", "small", "solid"],
		["medium", "Medium", "medium", "solid"],
		["large", "Large", "large", "solid"],
		["solid", "Solid", "medium", "solid"],
		["outline-strong", "Outline Strong", "medium", "outlineStrong"],
		["outline-weak", "Outline Weak", "medium", "outlineWeak"],
	] as const;
	const chipGroups: Record<string, string> = $state({ small: "option1", medium: "option1", large: "option1", solid: "option1", "outline-strong": "option1", "outline-weak": "option1", preview: "option1", icon: "option1", suffix: "option1", avatar: "option1", timer: "3" });
</script>

<Doc
	page="selection"
	title="Selection"
	lead="선택 상태를 다루는 컨트롤: Checkbox, Radio Group, Switch, Segmented Control, Select Box, Chip, Tag Group."
	toc={[
		{ id: "checkbox", label: "Checkbox" },
		{ id: "radio-group", label: "Radio Group" },
		{ id: "switch", label: "Switch" },
		{ id: "segmented-control", label: "Segmented Control" },
		{ id: "select-box", label: "Select Box" },
		{ id: "chip", label: "Chip" },
		{ id: "tag-group", label: "Tag Group" },
	]}
>
	<!-- ───────────── Checkbox ───────────── -->
	<h2 id="checkbox" style="margin: 72px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Checkbox</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">사용자가 하나 이상의 옵션을 선택할 수 있게 해주는 컴포넌트입니다.</p>
	<Demo id="checkbox-preview" live="checkbox:0">
		<div style="padding: var(--dimension-x6)">
			<CheckboxGroup label="관심 분야" description="관심 있는 분야를 모두 선택해 주세요." indicator="선택">
				<Checkbox label="디자인" tone="neutral" size="large" />
				<Checkbox label="개발" tone="neutral" size="large" checked />
				<Checkbox label="마케팅" tone="neutral" size="large" />
			</CheckboxGroup>
		</div>
	</Demo>
	<Demo id="checkbox-size" title="Sizes" level={3} live="checkbox:1">
		<div class="flex" style="gap: var(--dimension-x8); padding: var(--dimension-x6)">
			<CheckboxGroup ariaLabel="Square size examples">
				<Checkbox label="Medium (default)" size="medium" checked tone="neutral" />
				<Checkbox label="Large" size="large" checked tone="neutral" />
			</CheckboxGroup>
			<CheckboxGroup ariaLabel="Ghost size examples">
				<Checkbox label="Medium (default)" size="medium" variant="ghost" checked tone="neutral" />
				<Checkbox label="Large" size="large" variant="ghost" checked tone="neutral" />
			</CheckboxGroup>
		</div>
	</Demo>
	{#each [["brand", "checkbox:2"], ["neutral", "checkbox:3"]] as [tone, live] (tone)}
		<Demo id="checkbox-{tone}" title="Tones and Variants — {tone}" level={3} {live}>
			<div style="padding: var(--dimension-x6)">
				<CheckboxGroup ariaLabel="{tone === 'brand' ? 'Brand' : 'Neutral'} tone examples">
					<Checkbox label="Square (default)" variant="square" tone={tone as "brand" | "neutral"} size="large" checked />
					<Checkbox label="Ghost" variant="ghost" tone={tone as "brand" | "neutral"} size="large" checked />
				</CheckboxGroup>
			</div>
		</Demo>
	{/each}
	<Demo id="checkbox-indeterminate" title="Indeterminate" level={3} live="checkbox:4">
		<div style="padding: var(--dimension-x6)"><Checkbox checked label="indeterminate" indeterminate tone="neutral" size="large" /></div>
	</Demo>
	<Demo id="checkbox-weights" title="Weights" level={3} live="checkbox:5">
		<div style="padding: var(--dimension-x6)">
			<CheckboxGroup ariaLabel="Weight examples">
				<Checkbox label="Regular Label Text" weight="regular" tone="neutral" size="large" />
				<Checkbox label="Bold Label Text" weight="bold" tone="neutral" size="large" />
			</CheckboxGroup>
		</div>
	</Demo>
	<Demo id="checkbox-long-label" title="Long Label" level={3} live="checkbox:6">
		<div style="padding: var(--dimension-x6)">
			<CheckboxGroup ariaLabel="Long label examples">
				<Checkbox size="medium" tone="neutral" label={LONG} />
				<Checkbox size="large" tone="neutral" label={LONG} />
			</CheckboxGroup>
		</div>
	</Demo>
	<Demo id="checkbox-disabled" title="Disabled" level={3} live="checkbox:7">
		<div style="padding: var(--dimension-x6)">
			<CheckboxGroup ariaLabel="Disabled examples">
				<Checkbox checked label="Disabled Checked, Square" disabled tone="neutral" size="large" />
				<Checkbox label="Disabled without Checked, Square" disabled tone="neutral" size="large" />
				<Checkbox variant="ghost" checked label="Disabled Checked, Ghost" disabled tone="neutral" size="large" />
				<Checkbox variant="ghost" label="Disabled without Checked, Ghost" disabled tone="neutral" size="large" />
			</CheckboxGroup>
		</div>
	</Demo>
	<Demo id="checkbox-value-changes" title="Listening to Value Changes" level={3} live="checkbox:8">
		<div class="flex flex-col items-center" style="gap: var(--dimension-x4); padding: var(--dimension-x6)">
			<span onchange={() => cbCount++}><Checkbox label="Click me" tone="neutral" size="large" /></span>
			<Text>onCheckedChange called: {cbCount} times, last value: -</Text>
		</div>
	</Demo>
	<Demo id="checkbox-use-cases" title="Use Cases — form" level={3} live="checkbox:9">
		<form class="flex flex-col" style="gap: var(--dimension-x3); padding: var(--dimension-x6)" onsubmit={(e) => e.preventDefault()}>
			<CheckboxGroup ariaLabel="Fruit selection">
				<Checkbox name="apple" label="apple" tone="neutral" size="large" />
				<Checkbox name="melon" label="melon" tone="neutral" size="large" checked />
				<Checkbox name="mango" label="mango" tone="neutral" size="large" />
			</CheckboxGroup>
			<div class="flex" style="gap: var(--dimension-x2)">
				<ActionButton type="reset" variant="neutralWeak">초기화</ActionButton>
				<ActionButton variant="neutralWeak" style="flex-grow: 1">mango 선택</ActionButton>
				<ActionButton type="submit" variant="neutralSolid" style="flex-grow: 1">제출</ActionButton>
			</div>
		</form>
	</Demo>
	<Demo id="checkbox-checkmark" title="Use Cases — checkmark" level={3} live="checkbox:10">
		<div class="flex" style="gap: var(--dimension-x6); padding: var(--dimension-x6)">
			<Checkbox tone="neutral"><Text textStyle="t7Regular">regular</Text></Checkbox>
			<Checkbox tone="neutral" checked><Text textStyle="t7Medium">medium</Text></Checkbox>
			<Checkbox tone="neutral"><Text textStyle="t7Bold">bold</Text></Checkbox>
		</div>
	</Demo>
	<Demo id="checkbox-fieldset" title="Fieldset Integration" level={3} live="checkbox:11" wide>
		<div class="flex w-full items-start" style="gap: var(--dimension-x8); padding: var(--dimension-x6)">
			<form class="flex flex-col" style="flex: 1; gap: var(--spacing-component-default)" onsubmit={(e) => e.preventDefault()}>
				<CheckboxGroup label="좋아하는 과일" indicator="선택" description="Apple을 선택하고 제출해보세요.">
					<Checkbox name="fruit" value="apple" label="Apple" tone="neutral" size="large" checked />
					<Checkbox name="fruit" value="banana" label="Banana" tone="neutral" size="large" />
					<Checkbox name="fruit" value="orange" label="Orange" tone="neutral" size="large" />
				</CheckboxGroup>
				<ActionButton type="submit" variant="neutralSolid">제출</ActionButton>
			</form>
			<form class="flex flex-col" style="flex: 1; gap: var(--spacing-component-default)" onsubmit={(e) => e.preventDefault()}>
				<CheckboxGroup label="약관 동의" labelWeight="bold" required description="이용약관을 선택하지 않고 제출해보세요.">
					<Checkbox name="agreement" value="terms" label="이용약관 동의 (필수)" tone="neutral" size="large" />
					<Checkbox name="agreement" value="privacy" label="개인정보 처리방침 동의 (필수)" tone="neutral" size="large" checked />
					<Checkbox name="agreement" value="marketing" label="마케팅 수신 동의 (선택)" tone="neutral" size="large" />
				</CheckboxGroup>
				<ActionButton type="submit" variant="neutralSolid">제출</ActionButton>
			</form>
		</div>
	</Demo>

	<!-- ───────────── Radio Group ───────────── -->
	<h2 id="radio-group" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Radio Group</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">여러 옵션 중 하나만 선택할 수 있게 해주는 컴포넌트입니다.</p>
	<Demo id="radio-group-preview" live="radio-group:0">
		<div style="padding: var(--dimension-x6)">
			<RadioGroup value="apple" label="좋아하는 과일" description="좋아하는 과일을 선택해 주세요." indicator="선택" tone="neutral" size="large" items={[{ value: "apple", label: "Apple" }, { value: "banana", label: "Banana" }, { value: "orange", label: "Orange" }]} />
		</div>
	</Demo>
	<Demo id="radio-group-size" title="Sizes" level={3} live="radio-group:1">
		<div class="flex flex-col" style="gap: var(--dimension-x5); padding: var(--dimension-x6)">
			<RadioGroup value="apple" ariaLabel="과일 선택" size="medium" tone="neutral" items={[{ value: "apple", label: "사과" }, { value: "banana", label: "바나나" }, { value: "orange", label: "오렌지" }]} />
			<RadioGroup value="red" ariaLabel="색상 선택" size="large" tone="neutral" items={[{ value: "red", label: "빨간색" }, { value: "blue", label: "파란색" }, { value: "green", label: "초록색" }]} />
		</div>
	</Demo>
	{#each [["brand", "radio-group:2"], ["neutral", "radio-group:3"]] as [tone, live] (tone)}
		<Demo id="radio-group-{tone}" title="Tones — {tone}" level={3} {live}>
			<div style="padding: var(--dimension-x6)">
				<RadioGroup value="apple" ariaLabel="과일 선택" tone={tone as "brand" | "neutral"} size="large" items={[{ value: "apple", label: "사과" }, { value: "banana", label: "바나나" }, { value: "orange", label: "오렌지" }]} />
			</div>
		</Demo>
	{/each}
	<Demo id="radio-group-weights" title="Weights" level={3} live="radio-group:4">
		<div style="padding: var(--dimension-x6)">
			<RadioGroup value="regular" ariaLabel="글꼴 굵기 선택" tone="neutral" size="large" items={[{ value: "regular", label: "Regular", weight: "regular" }, { value: "bold", label: "Bold", weight: "bold" }]} />
		</div>
	</Demo>
	<Demo id="radio-group-long-label" title="Long Label" level={3} live="radio-group:5">
		<div style="padding: var(--dimension-x6)">
			<RadioGroup value="medium" ariaLabel="Long label options" tone="neutral" items={[{ value: "medium", label: LONG, size: "medium" }, { value: "large", label: LONG, size: "large" }]} />
		</div>
	</Demo>
	<Demo id="radio-group-disabled" title="Disabled" level={3} live="radio-group:6">
		<div style="padding: var(--dimension-x6)">
			<RadioGroup value="option1" ariaLabel="Options with disabled" tone="neutral" size="large" items={[{ value: "option1", label: "Active option" }, { value: "option2", label: "Disabled option", disabled: true }, { value: "option3", label: "Another active option" }]} />
		</div>
	</Demo>
	<Demo id="radio-group-value-changes" title="Listening to Value Changes" level={3} live="radio-group:7" wide>
		<div class="flex w-full flex-col items-center" style="gap: var(--dimension-x4); padding: var(--dimension-x6)">
			<span class="w-full" onchange={() => { radioCount++; radioLast = radioValue; }}>
				<RadioGroup bind:value={radioValue} ariaLabel="Fruit selection" tone="neutral" size="large" items={[{ value: "apple", label: "Apple" }, { value: "banana", label: "Banana" }, { value: "orange", label: "Orange" }]} />
			</span>
			<Text>onValueChange called: {radioCount} times, last value: {radioLast ?? "-"}</Text>
		</div>
	</Demo>
	<Demo id="radio-group-form" title="Use Cases — form" level={3} live="radio-group:8">
		<form class="flex flex-col" style="padding: var(--dimension-x6)" onsubmit={(e) => e.preventDefault()}>
			<div class="flex flex-col" style="gap: var(--dimension-x3)">
				<RadioGroup value="blue" ariaLabel="Color selection" tone="neutral" size="large" items={[{ value: "red", label: "Red" }, { value: "blue", label: "Blue" }, { value: "green", label: "Green" }]} />
				<div class="flex" style="gap: var(--dimension-x3)">
					<ActionButton type="submit" variant="neutralSolid">Submit</ActionButton>
					<ActionButton type="button" variant="neutralWeak">Reset</ActionButton>
				</div>
			</div>
		</form>
	</Demo>
	<Demo id="radio-group-radiomark" title="Use Cases — radiomark" level={3} live="radio-group:9">
		<div style="padding: var(--dimension-x6)">
			{#snippet weightLabel(item: { value: string; label: string })}
				<Text textStyle={item.value === "regular" ? "t7Regular" : item.value === "medium" ? "t7Medium" : "t7Bold"}>{item.label}</Text>
			{/snippet}
			<RadioGroup value="medium" ariaLabel="Weight selection" tone="neutral" custom={weightLabel} items={[{ value: "regular", label: "regular" }, { value: "medium", label: "medium" }, { value: "bold", label: "bold" }]} />
		</div>
	</Demo>
	<Demo id="radio-group-field" title="RadioGroupField Integration" level={3} live="radio-group:10" wide>
		<div class="flex w-full items-start" style="gap: var(--dimension-x8); padding: var(--dimension-x6)">
			<form class="flex flex-col" style="flex: 1; gap: var(--spacing-component-default)" onsubmit={(e) => e.preventDefault()}>
				<RadioGroup name="contact" value="email" label="선호하는 연락 방법" indicator="필수" description="이메일을 선택하고 제출해보세요." tone="neutral" size="large" items={[{ value: "email", label: "이메일" }, { value: "phone", label: "전화" }, { value: "sms", label: "문자" }]} />
				<ActionButton type="submit" variant="neutralSolid">제출</ActionButton>
			</form>
			<form class="flex flex-col" style="flex: 1; gap: var(--spacing-component-default)" onsubmit={(e) => e.preventDefault()}>
				<RadioGroup name="option" value="option1" label="필수 선택" labelWeight="bold" required description="옵션 1을 선택하고 제출해보세요." tone="neutral" size="large" items={[{ value: "option1", label: "옵션 1" }, { value: "option2", label: "옵션 2", disabled: true }, { value: "option3", label: "옵션 3" }]} />
				<ActionButton type="submit" variant="neutralSolid">제출</ActionButton>
			</form>
		</div>
	</Demo>

	<!-- ───────────── Switch ───────────── -->
	<h2 id="switch" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Switch</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">두 가지 상태 사이를 전환하는 토글 컨트롤입니다.</p>
	<Demo id="switch-preview" live="switch:0"><Switch checked /></Demo>
	<Demo id="switch-sizes" title="Sizes" level={3} live="switch:1">
		<div class="flex flex-col items-center" style="gap: var(--spacing-component-default)">
			<Switch size="32" label="32 (default)" checked />
			<Switch size="24" label="24" checked />
			<Switch size="16" label="16" checked />
		</div>
	</Demo>
	<Demo id="switch-brand" title="Tones — Brand" level={3} live="switch:2"><Switch tone="brand" label="Brand" checked /></Demo>
	<Demo id="switch-neutral" title="Tones — Neutral" level={3} live="switch:3"><Switch tone="neutral" label="Neutral" checked /></Demo>
	<Demo id="switch-long-label" title="Long Label" level={3} live="switch:4">
		<div class="flex flex-col" style="gap: var(--spacing-component-default)">
			<Switch size="32" label={LONG} />
			<Switch size="24" label={LONG} />
			<Switch size="16" label={LONG} />
		</div>
	</Demo>
	<Demo id="switch-disabled" title="Disabled" level={3} live="switch:5">
		<div class="flex flex-col items-center" style="gap: var(--dimension-x8)">
			<div class="flex flex-col items-start" style="gap: var(--spacing-component-default)">
				<Switch disabled={swDisabled} label="Not Checked (Brand)" />
				<Switch disabled={swDisabled} checked label="Checked (Brand)" />
				<Switch disabled={swDisabled} label="Not Checked (Neutral)" tone="neutral" />
				<Switch disabled={swDisabled} checked label="Checked (Neutral)" tone="neutral" />
			</div>
			<Switch size="16" bind:checked={swDisabled} label="Disable switches" tone="neutral" />
		</div>
	</Demo>
	<Demo id="switch-value-changes" title="Listening to Value Changes" level={3} live="switch:6">
		<div class="flex flex-col items-center" style="gap: var(--dimension-x4)">
			<span onchange={() => { swCount++; swLast = swOn; }}><Switch label="Click me" bind:checked={swOn} /></span>
			<Text>onCheckedChange called: {swCount} times, last value: {`${swLast ?? "-"}`}</Text>
		</div>
	</Demo>
	<Demo id="switch-switchmark" title="Use Cases — switchmark" level={3} live="switch:7">
		<div class="flex" style="gap: var(--dimension-x6)">
			<Switch><Text textStyle="t7Regular">regular</Text></Switch>
			<Switch checked><Text textStyle="t7Medium">medium</Text></Switch>
			<Switch><Text textStyle="t7Bold">bold</Text></Switch>
		</div>
	</Demo>

	<!-- ───────────── Segmented Control ───────────── -->
	<h2 id="segmented-control" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Segmented Control</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">여러 옵션 중 하나를 선택할 수 있는 세그먼트 형태의 컨트롤입니다.</p>
	<Demo id="segmented-control-preview" live="segmented-control:0">
		<SegmentedControl value="Hot" ariaLabel="Sort by" items={[{ value: "Hot", label: "Hot" }, { value: "New", label: "New" }]} />
	</Demo>
	<Demo id="segmented-control-disabled" title="Disabled" level={3} live="segmented-control:1">
		<div class="flex flex-col items-center" style="gap: var(--spacing-component-default)">
			<SegmentedControl value="Hot" disabled ariaLabel="Sort by" items={[{ value: "Hot", label: "Hot" }, { value: "New", label: "New" }]} />
			<SegmentedControl value="Marinara" ariaLabel="Pasta" items={[{ value: "Marinara", label: "Marinara" }, { value: "Alfredo", label: "Alfredo", disabled: true }, { value: "Pesto", label: "Pesto", disabled: true }, { value: "Carbonara", label: "Carbonara" }, { value: "Bolognese", label: "Bolognese" }]} />
		</div>
	</Demo>
	<Demo id="segmented-control-notification" title="Notification" level={3} live="segmented-control:2">
		<div class="flex flex-col items-center" style="gap: var(--spacing-component-default)">
			<span onchange={() => { if (segSort === "annual") seenAnnual = true; }}>
				<SegmentedControl bind:value={segSort} ariaLabel="Billing Method" items={[{ value: "monthly", label: "Monthly" }, { value: "annual", label: "Annual", notification: !seenAnnual }, { value: "enterprise", label: "Enterprise Custom" }]} />
			</span>
			<ActionButton size="xsmall" variant="neutralSolid" disabled={!seenAnnual} onclick={() => (seenAnnual = false)}>Reset Notification</ActionButton>
		</div>
	</Demo>
	<Demo id="segmented-control-long-label" title="Long Label" level={3} live="segmented-control:3">
		<SegmentedControl value="price" ariaLabel="정렬 기준" items={[{ value: "price", label: "가격 높은 순" }, { value: "discount", label: "할인율 높은 순" }, { value: "popularity", label: "인기 많은 순" }]} />
	</Demo>
	<Demo id="segmented-control-fixed-width" title="Fixed Width" level={3} live="segmented-control:4">
		<div class="flex flex-col items-center" style="gap: var(--spacing-component-default)">
			<SegmentedControl value="new" style="width: 500px" ariaLabel="Sort by" items={[{ value: "new", label: "New" }, { value: "hot", label: "Hot" }]} />
			<SegmentedControl value="oneway" style="width: 400px" ariaLabel="Trip Type" items={[{ value: "oneway", label: "One Way Trip" }, { value: "round", label: "Round Trip", notification: true }, { value: "multi", label: "Multi-City Journey", notification: true }]} />
		</div>
	</Demo>
	<Demo id="segmented-control-value-changes" title="Listening to Value Changes" level={3} live="segmented-control:5">
		<div class="flex flex-col items-center" style="gap: var(--dimension-x4)">
			<span onchange={() => { segCount++; segLast = segValue; }}>
				<SegmentedControl bind:value={segValue} ariaLabel="Sort by" items={[{ value: "hot", label: "Hot" }, { value: "new", label: "New" }]} />
			</span>
			<Text>onValueChange called: {segCount} times, last value: {segLast ?? "-"}</Text>
		</div>
	</Demo>

	<!-- ───────────── Select Box ───────────── -->
	<h2 id="select-box" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Select Box</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">설명이 딸린 큰 선택 영역으로 하나 또는 여러 옵션을 고르게 합니다.</p>
	<Demo id="select-box-preview" live="select-box:0">
		<div class="flex items-start" style="gap: var(--dimension-x6)">
			<SelectBox ariaLabel="Fruit" value={["apple"]} items={[{ value: "apple", label: "Apple" }, { value: "melon", label: "Melon", description: "Elit cupidatat dolore fugiat enim veniam culpa." }, { value: "mango", label: "Mango" }]} />
			<SelectBox type="radio" ariaLabel="Fruit" value="apple" items={[{ value: "apple", label: "Apple" }, { value: "melon", label: "Melon", description: "Elit cupidatat dolore fugiat enim veniam culpa." }, { value: "mango", label: "Mango" }]} />
		</div>
	</Demo>
	<Demo id="select-box-form" title="Use Cases — form" level={3} live="select-box:1" wide>
		<div class="flex w-full items-start" style="gap: var(--dimension-x8); padding: var(--dimension-x4)">
			{#each ["check", "radio"] as const as type (type)}
				<form class="flex grow flex-col" style="gap: var(--dimension-x3)" onsubmit={(e) => e.preventDefault()}>
					<SelectBox {type} ariaLabel="Fruit" value={type === "check" ? ["melon"] : "melon"} items={[{ value: "apple", label: "apple" }, { value: "melon", label: "melon" }, { value: "mango", label: "mango" }]} />
					<div class="flex" style="gap: var(--dimension-x2)">
						<ActionButton type="reset" variant="neutralWeak">초기화</ActionButton>
						<ActionButton type="submit" variant="neutralSolid" style="flex-grow: 1">제출</ActionButton>
					</div>
				</form>
			{/each}
		</div>
	</Demo>
	<Demo id="select-box-customizing-label" title="Customizing Label" level={3} live="select-box:2">
		<div class="flex items-start" style="gap: var(--dimension-x8); padding: var(--dimension-x4)">
			<SelectBox ariaLabel="Fruit" value={["apple"]} items={[{ value: "apple", label: "Apple" }, { value: "melon", label: "Melon", badge: "New", description: "Elit cupidatat dolore fugiat enim veniam culpa." }, { value: "mango", label: "Mango", description: "Aliqua ad aute eiusmod eiusmod nulla adipisicing proident ullamco in." }]} />
			<SelectBox type="radio" ariaLabel="Fruit" value="apple" items={[{ value: "apple", label: "Apple" }, { value: "melon", label: "Melon", badge: "New", description: "Elit cupidatat dolore fugiat enim veniam culpa." }, { value: "mango", label: "Mango", description: "Aliqua ad aute eiusmod eiusmod nulla adipisicing proident ullamco in." }]} />
		</div>
	</Demo>
	<Demo id="select-box-value-changes" title="Listening to Value Changes" level={3} live="select-box:3" wide>
		<div class="flex w-full items-center" style="gap: var(--dimension-x8); padding: var(--dimension-x4)">
			<div class="flex flex-col items-center" style="flex: 1; gap: var(--dimension-x4)">
				<SelectBox ariaLabel="Fruit" items={[{ value: "apple", label: "Apple" }]} />
				<Text align="center">onCheckedChange called: 0 times, last value: -</Text>
			</div>
			<div class="flex flex-col items-center" style="flex: 1; gap: var(--dimension-x4)">
				<SelectBox type="radio" ariaLabel="Fruit" value="apple" items={[{ value: "apple", label: "Apple" }, { value: "banana", label: "Banana" }]} />
				<Text align="center">onValueChange called: 0 times, last value: -</Text>
			</div>
		</div>
	</Demo>
	<Demo id="select-box-columns" title="Columns" level={3} live="select-box:4" wide>
		<div class="flex flex-col" style="gap: var(--dimension-x8); padding: var(--dimension-x4)">
			<SelectBox ariaLabel="Grid 레이아웃 예제" columns={2} value={["o3"]} items={[{ value: "o1", prefixIcon: IceCream, label: "옵션 1", description: "layout=vertical" }, { value: "o2", prefixIcon: IceCream, label: "옵션 2", description: "layout=vertical" }, { value: "o3", prefixIcon: IceCream, layout: "horizontal", label: "layout=horizontal", description: "layout을 horizontal로 오버라이드" }, { value: "o4", prefixIcon: IceCream, label: "옵션 4", description: "layout=vertical" }]} />
			<SelectBox type="radio" ariaLabel="Grid 레이아웃 예제" columns={3} value="option3" items={[{ value: "option1", prefixIcon: Diamond, label: "옵션 1" }, { value: "option2", prefixIcon: Diamond, label: "옵션 2" }, { value: "option3", prefixIcon: Diamond, label: "layout=horizontal", description: "layout을 horizontal로 오버라이드", layout: "horizontal" }, { value: "option4", prefixIcon: Diamond, label: "옵션 4" }, { value: "option5", prefixIcon: Diamond, label: "옵션 5" }, { value: "option6", prefixIcon: Diamond, label: "옵션 6" }]} />
		</div>
	</Demo>
	<Demo id="select-box-with-suffix" title="With Suffix" level={3} live="select-box:5">
		<div class="flex" style="gap: var(--dimension-x8)">
			<SelectBox ariaLabel="Suffix 예제" items={[{ value: "mark", label: "체크마크" }, { value: "text", label: "텍스트 suffix", suffix: "+1,000원" }, { value: "none", label: "suffix 없음", description: "Commodo aliquip fugiat aute irure.", prefixIcon: UserRound, suffix: "none" }]} />
			<SelectBox type="radio" ariaLabel="Radiomark 예제" value="radiomark" items={[{ value: "radiomark", label: "라디오 마크" }, { value: "text", label: "텍스트 suffix", description: "Commodo aliquip fugiat aute irure.", suffix: "+1,000원" }, { value: "none", label: "suffix 없음", prefixIcon: UserRound, suffix: "none" }]} />
		</div>
	</Demo>
	<Demo id="select-box-collapsible-footer" title="Collapsible Footer" level={3} live="select-box:6" stage={440}>
		<div class="flex items-start" style="gap: var(--dimension-x8); padding: var(--dimension-x4); height: 400px">
			<SelectBox ariaLabel="Footer 예제" items={[{ value: "a", label: "선택 시에만 표시 (기본값)", description: "footerVisibility='when-selected'", footer: "선택되었을 때만 보입니다." }, { value: "b", label: "항상 표시", description: "footerVisibility='always'", footer: "항상 보입니다.", footerVisibility: "always" }, { value: "c", label: "미선택 시에만 표시", description: "footerVisibility='when-not-selected'", footer: "선택되지 않았을 때만 보입니다.", footerVisibility: "when-not-selected" }]} />
			<SelectBox type="radio" ariaLabel="Footer 예제" value="when-selected" items={[{ value: "when-selected", label: "선택 시에만 표시 (기본값)", description: "footerVisibility='when-selected'", footer: "선택되었을 때만 보입니다." }, { value: "always", label: "항상 표시", description: "footerVisibility='always'", footer: "항상 보입니다.", footerVisibility: "always" }, { value: "not", label: "미선택 시에만 표시", description: "footerVisibility='when-not-selected'", footer: "선택되지 않았을 때만 보입니다.", footerVisibility: "when-not-selected" }]} />
		</div>
	</Demo>
	<Demo id="select-box-fieldset" title="Fieldset Integration" level={3} live="select-box:7" wide stage={440}>
		<div class="flex w-full items-start" style="gap: var(--dimension-x8); padding: var(--dimension-x4); height: 400px">
			<form class="flex flex-col" style="flex: 1; gap: var(--spacing-component-default)" onsubmit={(e) => e.preventDefault()}>
				<SelectBox label="선호하는 과일을 선택하세요" indicator="선택" description="Apple을 선택하고 제출해보세요." value={["apple"]} items={[{ value: "apple", label: "Apple", footer: "Apple을 선택하고 제출하면 에러 메시지가 표시됩니다.", footerStyle: "t4Medium", footerPad: "var(--dimension-x4)" }, { value: "melon", label: "Melon" }, { value: "mango", label: "Mango" }]} />
				<ActionButton type="submit" variant="neutralSolid">제출</ActionButton>
			</form>
			<form class="flex flex-col" style="flex: 1; gap: var(--spacing-component-default)" onsubmit={(e) => e.preventDefault()}>
				<SelectBox type="radio" label="선호하는 색상을 선택하세요" labelWeight="bold" required description="Red를 선택하고 제출해보세요." value="red" items={[{ value: "red", label: "Red", footer: "Red를 선택하고 제출하면 에러 메시지가 표시됩니다.", footerStyle: "t4Medium", footerPad: "var(--dimension-x4)" }, { value: "blue", label: "Blue", disabled: true }, { value: "green", label: "Green" }]} />
				<ActionButton type="submit" variant="neutralSolid">제출</ActionButton>
			</form>
		</div>
	</Demo>

	<!-- ───────────── Chip ───────────── -->
	<h2 id="chip" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Chip</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">선택, 필터, 액션을 작고 둥근 형태로 보여주는 컴포넌트입니다.</p>
	<Demo id="chip-preview" live="chip:0">
		<div class="flex flex-col items-center" style="gap: var(--dimension-x3)">
			<div class="flex" style="gap: var(--dimension-x2)"><Chip>Button Chip</Chip><Chip type="toggle">Toggle Chip</Chip></div>
			<div role="radiogroup" aria-label="Options"><div class="flex" style="gap: var(--dimension-x2)"><Chip type="radio" name="chip-preview" value="option1" bind:group={chipGroups.preview}>Radio Chip 1</Chip><Chip type="radio" name="chip-preview" value="option2" bind:group={chipGroups.preview}>Radio Chip 2</Chip></div></div>
		</div>
	</Demo>
	{#each CHIP_DEMOS as [id, title, size, variant], i (id)}
		<Demo id="chip-{id}" {title} level={3} live="chip:{i + 1}">
			{@const word = variant === "solid" && id !== "solid" ? title : title}
			<div class="flex flex-col items-center" style="gap: var(--dimension-x3)">
				<div class="flex" style="gap: var(--dimension-x2)"><Chip {size} {variant}>{word} Button</Chip><Chip type="toggle" {size} {variant}>{word} Toggle</Chip></div>
				<div role="radiogroup" aria-label="Options"><div class="flex" style="gap: var(--dimension-x2)"><Chip type="radio" name="chip-{id}" value="option1" {size} {variant} bind:group={chipGroups[id]}>{word} Radio 1</Chip><Chip type="radio" name="chip-{id}" value="option2" {size} {variant} bind:group={chipGroups[id]}>{word} Radio 2</Chip></div></div>
			</div>
		</Demo>
	{/each}
	<Demo id="chip-prefix-icon" title="Prefix Icon" level={3} live="chip:7">
		<div class="flex flex-col items-center" style="gap: var(--dimension-x3)">
			<div class="flex" style="gap: var(--dimension-x2)"><Chip prefixIcon={Heart}>With Icon Button</Chip><Chip type="toggle" prefixIcon={Heart}>With Icon Toggle</Chip></div>
			<div role="radiogroup" aria-label="Options"><div class="flex" style="gap: var(--dimension-x2)"><Chip type="radio" name="chip-icon" value="option1" prefixIcon={Heart} bind:group={chipGroups.icon}>With Icon Radio 1</Chip><Chip type="radio" name="chip-icon" value="option2" prefixIcon={Heart} bind:group={chipGroups.icon}>With Icon Radio 2</Chip></div></div>
		</div>
	</Demo>
	<Demo id="chip-suffix-icon" title="Suffix Icon" level={3} live="chip:8">
		<div class="flex flex-col items-center" style="gap: var(--dimension-x3)">
			<div class="flex" style="gap: var(--dimension-x2)"><Chip suffixIcon={ChevronDown}>Button with Suffix</Chip><Chip type="toggle" suffixIcon={ChevronDown}>Toggle with Suffix</Chip></div>
			<div role="radiogroup" aria-label="Options"><div class="flex" style="gap: var(--dimension-x2)"><Chip type="radio" name="chip-suffix" value="option1" suffixIcon={ChevronDown} bind:group={chipGroups.suffix}>Radio with Suffix 1</Chip><Chip type="radio" name="chip-suffix" value="option2" suffixIcon={ChevronDown} bind:group={chipGroups.suffix}>Radio with Suffix 2</Chip></div></div>
		</div>
	</Demo>
	<Demo id="chip-icon-only" title="Icon Only" level={3} live="chip:9">
		<div class="flex flex-col items-center" style="gap: var(--dimension-x3)">
			<div class="flex" style="gap: var(--dimension-x2)"><Chip icon={RefreshCw} ariaLabel="Refresh" /><Chip type="toggle" icon={bellOn ? Bell : BellOff} bind:checked={bellOn} ariaLabel="Receive notifications" /></div>
			<div role="radiogroup" aria-label="Timer"><div class="flex" style="gap: var(--dimension-x2)"><Chip type="radio" name="chip-timer" value="3" icon={Timer} bind:group={chipGroups.timer} ariaLabel="3 seconds" /><Chip type="radio" name="chip-timer" value="10" icon={TimerReset} bind:group={chipGroups.timer} ariaLabel="10 seconds" /></div></div>
		</div>
	</Demo>
	<Demo id="chip-prefix-avatar" title="Prefix Avatar" level={3} live="chip:10">
		<div class="flex flex-col items-center" style="gap: var(--dimension-x3)">
			<div class="flex" style="gap: var(--dimension-x2)"><Chip avatar={AVATAR}>With Avatar Button</Chip><Chip type="toggle" avatar={AVATAR}>With Avatar Toggle</Chip></div>
			<div role="radiogroup" aria-label="Options"><div class="flex" style="gap: var(--dimension-x2)"><Chip type="radio" name="chip-avatar" value="option1" avatar={AVATAR} bind:group={chipGroups.avatar}>With Avatar Radio 1</Chip><Chip type="radio" name="chip-avatar" value="option2" avatar={AVATAR} bind:group={chipGroups.avatar}>With Avatar Radio 2</Chip></div></div>
		</div>
	</Demo>
	<Demo id="chip-value-changes" title="Listening to Value Changes" level={3} live="chip:11">
		<div class="flex flex-col items-center" style="gap: var(--dimension-x4)">
			<div class="flex flex-col items-center" style="gap: var(--dimension-x2)">
				<span onchange={() => chipToggleCount++}><Chip type="toggle">Toggle Chip</Chip></span>
				<Text>onCheckedChange called: {chipToggleCount} times, last value: -</Text>
			</div>
			<div class="flex flex-col items-center" style="gap: var(--dimension-x2)">
				<div role="radiogroup" aria-label="Options" onchange={() => chipRadioCount++}><div class="flex" style="gap: var(--dimension-x2)"><Chip type="radio" name="chip-vc" value="option1" bind:group={chipRadio}>Radio 1</Chip><Chip type="radio" name="chip-vc" value="option2" bind:group={chipRadio}>Radio 2</Chip></div></div>
				<Text>onValueChange called: {chipRadioCount} times, last value: -</Text>
			</div>
		</div>
	</Demo>

	<!-- ───────────── Tag Group ───────────── -->
	<h2 id="tag-group" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Tag Group</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">거리, 동네, 시간 같은 부가 정보를 구분자로 이어 보여줍니다.</p>
	<Demo id="tag-group-preview" live="tag-group:0">
		<TagGroup items={[{ prefixIcon: MapPin, label: "500m" }, { label: "서초4동" }, { label: "3분 전" }]} />
	</Demo>
	<Demo id="tag-group-sizes" title="Sizes" level={3} live="tag-group:1">
		<div class="flex flex-col items-center" style="gap: var(--spacing-component-default)">
			{#each ["t2", "t3", "t4"] as const as size (size)}<TagGroup {size} items={[{ label: size }, { label: size }, { label: size }]} />{/each}
		</div>
	</Demo>
	<Demo id="tag-group-weights" title="Weights" level={3} live="tag-group:2">
		<div class="flex flex-col items-center" style="gap: var(--spacing-component-default)">
			{#each ["regular", "bold"] as const as weight (weight)}<TagGroup {weight} items={[{ label: weight }, { label: weight }, { label: weight }]} />{/each}
		</div>
	</Demo>
	<Demo id="tag-group-tones" title="Tones" level={3} live="tag-group:3">
		<div class="flex flex-col items-center" style="gap: var(--spacing-component-default)">
			{#each ["neutralSubtle", "neutral", "brand"] as const as tone (tone)}<TagGroup {tone} items={[{ label: tone }, { label: tone }, { label: tone }]} />{/each}
		</div>
	</Demo>
	<Demo id="tag-group-with-icons" title="With Icons" level={3} live="tag-group:4">
		<div class="flex flex-col items-center" style="gap: var(--spacing-component-default)">
			<TagGroup items={[{ label: "광고", suffixIcon: Megaphone }, { label: "끌올 3시간 전" }, { label: "서초4동" }]} />
			<TagGroup items={[{ prefixIcon: MapPin, label: "서초4동" }, { label: "인증 5회" }, { label: "3분 전" }]} />
		</div>
	</Demo>
	<Demo id="tag-group-customizing-item" title="Customizing Item" level={3} live="tag-group:5">
		<div class="flex flex-col items-center" style="gap: var(--spacing-component-default)">
			<TagGroup items={[{ icon: Star, iconColor: "--fg-brand", label: "4.5", weight: "bold", tone: "neutral", ariaLabel: "평점 4.5" }, { label: "후기 37" }, { label: "단골 12" }]} />
			<TagGroup tone="neutral" items={[{ tone: "brand", suffixIcon: CircleCheck, label: "인증됨" }, { ariaLabel: "관심 10개", prefixIcon: Heart, label: "10" }, { ariaLabel: "댓글 3개", prefixIcon: MessageSquare, label: "3" }]} />
		</div>
	</Demo>
	<Demo id="tag-group-customizing-separators" title="Customizing Separators" level={3} live="tag-group:6">
		<div class="flex flex-col items-center" style="gap: var(--spacing-component-default)">
			<TagGroup separator=" | " size="t4" items={[{ label: "가" }, { label: "나" }, { label: "다" }, { label: "라" }]} />
			<TagGroup separator=" " size="t4" items={[{ label: "가" }, { label: "나" }, { label: "다" }, { label: "라" }]} />
		</div>
	</Demo>
	<Demo id="tag-group-wrapping" title="Wrapping Behavior" level={3} live="tag-group:7" wide>
		<div class="flex w-full grow items-center justify-center" style="background: var(--bg-layer-basement); border-radius: var(--radius-r2); padding: var(--dimension-x4)">
			<div class="flex flex-col" style="gap: var(--dimension-x2); width: 350px; max-width: max-content; overflow-x: auto; resize: horizontal">
				{#each [["default (wrap)", false, false], ["truncate", true, false], ["truncate, keep one fixed", true, true]] as [title, truncate, fixed] (title)}
					<div class="flex flex-col items-start justify-center" style="gap: var(--dimension-x1); padding: var(--dimension-x3); background: var(--bg-layer-default); border-radius: var(--radius-r2); border: 1px solid var(--stroke-neutral-weak); overflow-x: hidden">
						<Text textStyle="t2Medium">{title}</Text>
						<TagGroup truncate={truncate as boolean} items={[{ prefixIcon: MapPin, label: "부산광역시 해운대구" }, { prefixIcon: Bell, label: "123 456 789 012 345", fixed: fixed as boolean }, { label: "Ut minim laboris enim" }]} />
					</div>
				{/each}
				<div class="flex flex-col items-start justify-center" style="gap: var(--dimension-x1); padding: var(--dimension-x3); background: var(--bg-layer-default); border-radius: var(--radius-r2); border: 1px solid var(--stroke-neutral-weak); overflow-x: hidden">
					<Text textStyle="t2Medium">truncate, mixed shrink ratios</Text>
					<TagGroup truncate items={[{ prefixIcon: MapPin, label: "부산광역시 해운대구", shrink: 1 }, { prefixIcon: Bell, label: "123 456 789 012 345", shrink: 100 }, { label: "Ut minim laboris enim", shrink: 100 }]} />
				</div>
			</div>
		</div>
	</Demo>
</Doc>
