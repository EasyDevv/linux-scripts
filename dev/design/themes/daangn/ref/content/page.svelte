<!-- draft-meta: {"route":"content","title":"Content","style":"daangn"} -->
<!-- Reconstruction of seed-design.io/react/components/{list, accordion, avatar, identity-placeholder,
     badge, divider, article, aspect-ratio, content-placeholder, image-frame, manner-temp,
     manner-temp-badge, result-section}: the visual docs previews in order (data-live = census index).
     Behaviour-only previews (controlled / value-change counters / bottom-sheet launchers) are omitted. -->
<script lang="ts">
	import Bell from "@lucide/svelte/icons/bell";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import CircleUser from "@lucide/svelte/icons/circle-user-round";
	import CreditCard from "@lucide/svelte/icons/credit-card";
	import Info from "@lucide/svelte/icons/info";
	import Lock from "@lucide/svelte/icons/lock";
	import Plus from "@lucide/svelte/icons/plus";
	import Sparkles from "@lucide/svelte/icons/sparkles";
	import Carrot from "@lucide/svelte/icons/carrot";
	import Trash from "@lucide/svelte/icons/trash-2";
	import Truck from "@lucide/svelte/icons/truck";
	import Headset from "@lucide/svelte/icons/headset";
	import Diamond from "@lucide/svelte/icons/diamond";
	import CircleHelp from "@lucide/svelte/icons/circle-help";
	import Accordion from "../../components/accordion.svelte";
	import ActionButton from "../../components/action-button.svelte";
	import Article from "../../components/article.svelte";
	import AspectRatio from "../../components/aspect-ratio.svelte";
	import Avatar from "../../components/avatar.svelte";
	import AvatarStack from "../../components/avatar-stack.svelte";
	import Badge from "../../components/badge.svelte";
	import Checkmark from "../../components/checkmark.svelte";
	import ContentPlaceholder from "../../components/content-placeholder.svelte";
	import { CONTENT_PLACEHOLDER_ASSETS, type ContentPlaceholderType } from "../../components/content-placeholder-assets.ts";
	import Divider from "../../components/divider.svelte";
	import IdentityPlaceholder from "../../components/identity-placeholder.svelte";
	import ImageFrame from "../../components/image-frame.svelte";
	import ImageFrameFloater from "../../components/image-frame-floater.svelte";
	import ImageFrameIndicator from "../../components/image-frame-indicator.svelte";
	import ImageFrameReactionButton from "../../components/image-frame-reaction-button.svelte";
	import ListHeader from "../../components/list-header.svelte";
	import ListItem from "../../components/list-item.svelte";
	import MannerTemp from "../../components/manner-temp.svelte";
	import MannerTempBadge from "../../components/manner-temp-badge.svelte";
	import Radiomark from "../../components/radiomark.svelte";
	import ResultSection from "../../components/result-section.svelte";
	import Switch from "../../components/switch.svelte";
	import Switchmark from "../../components/switchmark.svelte";
	import Text from "../../components/text.svelte";
	import ToggleButton from "../../components/toggle-button.svelte";
	import Demo from "../demo.svelte";
	import Doc from "../doc.svelte";

	const AVATAR = "https://avatars.githubusercontent.com/u/54893898?v=4";
	const PHOTO = "https://images.unsplash.com/photo-1535025183041-0991a977e25b?w=300&dpr=2&q=80";
	const PHOTO_SM = "https://images.unsplash.com/photo-1535025183041-0991a977e25b?w=120&dpr=2&q=80";
	const TEMPS = [12.5, 30, 36, 36.5, 37, 40, 45, 55, 65, 80];
	const TONES = ["neutral", "brand", "informative", "positive", "warning", "critical"] as const;
	const ENIM = "Enim aute duis magna mollit aute sit aliquip duis ut tempor sunt.";

	let sw1 = $state(false);
	let sw2 = $state(true);
	let chk = $state([true, true, false]);
	let radio = $state("option1");
	let highlight = $state(true);
	let toggled = $state(false);
	let liked = $state(false);
	let liked2 = $state(false);

	const three = (a: string, b: string, c: string) => [
		{ value: "item-1", title: "아코디언 항목 1", content: a },
		{ value: "item-2", title: "아코디언 항목 2", content: b },
		{ value: "item-3", title: "아코디언 항목 3", content: c },
	];
	const ITEMS = three("첫 번째 항목의 내용입니다.", "두 번째 항목의 내용입니다.", "세 번째 항목의 내용입니다.");
	const RADII = [
		[20, "r1", "--radius-r1", "20 / r1 (4px)", "buySell"],
		[24, "r1", "--radius-r1", "24 / r1 (4px)", "car"],
		[36, "r1_5", "--radius-r1-5", "36 / r1_5 (6px)", "realty"],
		[42, "r1_5", "--radius-r1-5", "42 / r1_5 (6px)", "food"],
		[48, "r1_5", "--radius-r1-5", "48 / r1_5 (6px)", "image"],
		[64, "r2", "--radius-r2", "64+ / r2 (8px)", "group"],
	] as const;
	const PLACEHOLDER_SIZES = [
		{ label: "24", w: 24, h: 24 },
		{ label: "48", w: 48, h: 48 },
		{ label: "80", w: 80, h: 80 },
		{ label: "120", w: 120, h: 120 },
		{ label: "160 × 120", w: 160, h: 120 },
		{ label: "240 × 160", w: 240, h: 160 },
	];
</script>

{#snippet accordionBody(item: { content?: string })}
	<div style="padding: var(--dimension-x4)"><p>{item.content}</p></div>
{/snippet}

<Doc
	page="content"
	title="Content"
	lead="콘텐츠를 담고 보여주는 컴포넌트: List, Accordion, Avatar, Badge, Divider, Image Frame, Manner Temp 등."
	toc={[
		{ id: "list", label: "List" },
		{ id: "accordion", label: "Accordion" },
		{ id: "avatar", label: "Avatar" },
		{ id: "badge", label: "Badge" },
		{ id: "divider", label: "Divider" },
		{ id: "article", label: "Article" },
		{ id: "aspect-ratio", label: "Aspect Ratio" },
		{ id: "content-placeholder", label: "Content Placeholder" },
		{ id: "image-frame", label: "Image Frame" },
		{ id: "manner-temp", label: "Manner Temp" },
		{ id: "result-section", label: "Result Section" },
	]}
>
	<!-- ───────────── List ───────────── -->
	<h2 id="list" style="margin: 72px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">List</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">정보를 세로로 나열하는 목록 컴포넌트입니다.</p>
	<Demo id="list-preview" live="list:0">
		<div class="flex flex-col" style="width: 360px">
			<ListHeader>리스트 헤더</ListHeader>
			<ul class="w-full">
				<ListItem title="기본 리스트 아이템" />
				<Divider as="li" />
				<ListItem title="아이콘이 있는 리스트 아이템" detail="부가 정보가 포함된 설명">
					{#snippet prefix()}<CircleUser class="seed-icon" aria-hidden="true" />{/snippet}
					{#snippet suffix()}<Info class="seed-icon" aria-hidden="true" />{/snippet}
				</ListItem>
			</ul>
		</div>
	</Demo>
	<Demo id="list-header" title="Using ListHeader" level={3} live="list:1" stage={688}>
		<div class="flex flex-col" style="gap: var(--dimension-x6); padding-block: var(--dimension-x6); width: 360px">
			{#each [["mediumWeak", 'variant="mediumWeak"'], ["boldSolid", 'variant="boldSolid"']] as [variant, label], i (variant)}
				{#if i > 0}<Divider />{/if}
				<div class="flex flex-col">
					<ListHeader variant={variant as "mediumWeak" | "boldSolid"}>{label}</ListHeader>
					<ul>
						<ListItem as="button" title="내 계정" detail="이메일과 연락처, 본인 인증 관리">
							{#snippet prefix()}<CircleUser class="seed-icon" aria-hidden="true" />{/snippet}
							{#snippet suffix()}<ChevronRight class="seed-icon" aria-hidden="true" style="--seed-icon-size: 18px" />{/snippet}
						</ListItem>
						<ListItem as="button" title="보안 · 인증 관리" detail="비밀번호, 생체 인증 사용을 관리해요">
							{#snippet prefix()}<Lock class="seed-icon" aria-hidden="true" />{/snippet}
							{#snippet suffix()}<ChevronRight class="seed-icon" aria-hidden="true" style="--seed-icon-size: var(--dimension-x4-5)" />{/snippet}
						</ListItem>
					</ul>
				</div>
			{/each}
			<Divider />
			<div class="flex flex-col">
				<ListHeader as="div"><h2>List Header with Action Button</h2><ActionButton variant="ghost" size="small" color="--fg-neutral-subtle" fontWeight="medium" prefixIcon={CircleHelp} style="margin: calc(var(--dimension-x2) * -1) calc(var(--dimension-x3-5) * -1)">도움말</ActionButton></ListHeader>
			<ul>
				<ListItem as="button" title="내 계정" detail="이메일과 연락처, 본인 인증 관리">
					{#snippet prefix()}<CircleUser class="seed-icon" aria-hidden="true" />{/snippet}
					{#snippet suffix()}<ChevronRight class="seed-icon" aria-hidden="true" style="--seed-icon-size: 18px" />{/snippet}
				</ListItem>
				<ListItem as="button" title="보안 · 인증 관리" detail="비밀번호, 생체 인증 사용을 관리해요">
					{#snippet prefix()}<Lock class="seed-icon" aria-hidden="true" />{/snippet}
					{#snippet suffix()}<ChevronRight class="seed-icon" aria-hidden="true" style="--seed-icon-size: var(--dimension-x4-5)" />{/snippet}
				</ListItem>
			</ul>
			</div>
		</div>
	</Demo>
	<Demo id="list-affixes" title="Affixes (Prefix/Suffix)" level={3} live="list:2" stage={379}>
		<ul style="width: 360px">
			<ListItem title="Prefix에 Avatar 넣기" detail="Amet elit ullamco magna.">
				{#snippet prefix()}<Avatar size="48" src={AVATAR} />{/snippet}
			</ListItem>
			<Divider as="li" />
			<ListItem title="Prefix에 아이콘 넣기" detail="Deserunt nulla elit est.">
				{#snippet prefix()}<Info class="seed-icon" aria-hidden="true" />{/snippet}
			</ListItem>
			<Divider as="li" />
			<ListItem title="Suffix에 Action Button 넣기" detail="Veniam non est non ut consequat.">
				{#snippet suffix()}<ActionButton size="xsmall" variant="neutralWeak">액션 버튼</ActionButton>{/snippet}
			</ListItem>
			<Divider as="li" />
			<ListItem title="Suffix에 Action Button (Ghost) 넣기" detail="Deserunt nulla elit est.">
				{#snippet suffix()}<ActionButton size="small" variant="ghost" icon={Plus} aria-label="추가" />{/snippet}
			</ListItem>
			<Divider as="li" />
			<ListItem title="Suffix에 Toggle Button 넣기" detail="Sit eu incididunt aute ea elit ex.">
				{#snippet suffix()}<ToggleButton size="xsmall" bind:pressed={toggled}>토글 버튼</ToggleButton>{/snippet}
			</ListItem>
		</ul>
	</Demo>
	<Demo id="list-switch" title="Switch Items" level={3} live="list:4">
		<ul style="width: 360px">
			<ListItem as="label" title="삭제하기 전에 확인" checked={sw1}>
				{#snippet prefix()}<Trash class="seed-icon" aria-hidden="true" />{/snippet}
				{#snippet suffix()}<Switchmark tone="neutral" checked={sw1} />{/snippet}
				{#snippet input()}<input type="checkbox" role="switch" bind:checked={sw1} style="position: absolute; width: 1px; height: 1px; opacity: 0" />{/snippet}
			</ListItem>
			<Divider as="li" />
			<ListItem as="label" title="메시지 요약" detail="핵심 내용만 빠르게 확인해보세요." checked={sw2}>
				{#snippet prefix()}<Sparkles class="seed-icon" aria-hidden="true" />{/snippet}
				{#snippet suffix()}<Switchmark tone="neutral" checked={sw2} />{/snippet}
				{#snippet input()}<input type="checkbox" role="switch" bind:checked={sw2} style="position: absolute; width: 1px; height: 1px; opacity: 0" />{/snippet}
			</ListItem>
		</ul>
	</Demo>
	<Demo id="list-check" title="Check Items" level={3} live="list:5">
		<fieldset style="width: 360px; border: 0; margin: 0; padding: 0">
			<ListItem as="label" detail="푸시 알림을 받으시겠습니까?" checked={chk[0]}>
				{#snippet titleContent()}<div class="flex" style="gap: var(--dimension-x1-5)"><span>알림 수신 동의</span><Badge variant="weak">권장</Badge></div>{/snippet}
				{#snippet suffix()}<Checkmark tone="neutral" size="large" checked={chk[0]} />{/snippet}
				{#snippet input()}<input type="checkbox" bind:checked={chk[0]} style="position: absolute; width: 1px; height: 1px; opacity: 0" />{/snippet}
			</ListItem>
			<Divider as="div" />
			<ListItem as="label" title="마케팅 정보 수신 동의" detail="마케팅 정보를 받으시겠습니까?" checked={chk[1]}>
				{#snippet prefix()}<Checkmark tone="neutral" size="large" checked={chk[1]} />{/snippet}
				{#snippet input()}<input type="checkbox" bind:checked={chk[1]} style="position: absolute; width: 1px; height: 1px; opacity: 0" />{/snippet}
			</ListItem>
			<Divider as="div" />
			<ListItem as="label" title="Ghost Variant" checked={chk[2]}>
				{#snippet prefix()}<Checkmark tone="neutral" size="large" variant="ghost" checked={chk[2]} />{/snippet}
				{#snippet input()}<input type="checkbox" bind:checked={chk[2]} style="position: absolute; width: 1px; height: 1px; opacity: 0" />{/snippet}
			</ListItem>
		</fieldset>
	</Demo>
	<Demo id="list-radio" title="Radio Items" level={3} live="list:6">
		<div role="radiogroup" aria-label="옵션 선택" style="width: 360px">
			<ListItem as="label" title="옵션 1" detail="첫 번째 선택지" checked={radio === "option1"}>
				{#snippet suffix()}<Radiomark tone="neutral" size="large" checked={radio === "option1"} />{/snippet}
				{#snippet input()}<input type="radio" name="list-radio" value="option1" bind:group={radio} style="position: absolute; width: 1px; height: 1px; opacity: 0" />{/snippet}
			</ListItem>
			{#each [["option2", "옵션 2", "두 번째 선택지"], ["option3", "옵션 3", "세 번째 선택지"]] as [value, title, detail] (value)}
				<Divider as="div" />
				<ListItem as="label" {title} {detail} checked={radio === value}>
					{#snippet prefix()}<Radiomark tone="neutral" size="large" checked={radio === value} />{/snippet}
					{#snippet input()}<input type="radio" name="list-radio" {value} bind:group={radio} style="position: absolute; width: 1px; height: 1px; opacity: 0" />{/snippet}
				</ListItem>
			{/each}
		</div>
	</Demo>
	<Demo id="list-highlighted" title="Variants" level={3} live="list:8" stage={396}>
		<div class="flex flex-col" style="width: 360px; gap: var(--dimension-x4)">
			<ul>
				<ListItem as="button" title="버튼" detail={ENIM}>{#snippet prefix()}<CircleUser class="seed-icon" aria-hidden="true" />{/snippet}</ListItem>
				<Divider as="li" />
				<ListItem as="button" highlighted title="하이라이트된 버튼" detail={ENIM}>{#snippet prefix()}<CircleUser class="seed-icon" aria-hidden="true" />{/snippet}</ListItem>
				<Divider as="li" />
				<ListItem as="button" highlighted disabled title="하이라이트 및 비활성화된 버튼" detail={ENIM}>{#snippet prefix()}<CircleUser class="seed-icon" aria-hidden="true" />{/snippet}</ListItem>
				<Divider as="li" />
				<ListItem as="button" highlighted={highlight} title="하이라이트">{#snippet prefix()}<CircleUser class="seed-icon" aria-hidden="true" />{/snippet}</ListItem>
			</ul>
			<div style="align-self: center"><Switch size="24" tone="neutral" label="highlight" bind:checked={highlight} /></div>
		</div>
	</Demo>
	<Demo id="list-alignment" title="Alignment" level={3} live="list:10" wide>
		<div class="flex w-full items-start" style="gap: var(--dimension-x4)">
			<ul>
				<ListItem title="Prefix에 Avatar 넣기. Veniam elit velit esse ea incididunt sunt sit aute." detail="Et proident sit ullamco ut voluptate. Voluptate eiusmod occaecat adipisicing quis qui esse.">
					{#snippet prefix()}<Avatar size="48" />{/snippet}
				</ListItem>
			</ul>
			<ul>
				<ListItem alignItems="flex-start" title="Prefix에 Avatar 넣고 상단으로 정렬하기. Veniam elit velit esse ea incididunt sunt sit aute." detail="일반적으로 `title`이 길어질 때 `alignItems`를 `flex-start`로 설정합니다.">
					{#snippet prefix()}<Avatar size="48" />{/snippet}
				</ListItem>
			</ul>
		</div>
	</Demo>

	<!-- ───────────── Accordion ───────────── -->
	<h2 id="accordion" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Accordion</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">제목을 눌러 내용을 펼치고 접는 컴포넌트입니다.</p>
	<Demo id="accordion-preview" live="accordion:0" wide><Accordion items={ITEMS} content={accordionBody} /></Demo>
	<Demo id="accordion-inline" title="Inline Variant" level={3} live="accordion:1" wide><Accordion variant="inline" items={ITEMS} content={accordionBody} /></Demo>
	<Demo id="accordion-separated" title="Separated" level={3} live="accordion:2" wide><Accordion variant="separated" items={ITEMS} content={accordionBody} /></Demo>
	<Demo id="accordion-size" title="Size" level={3} live="accordion:5" wide>
		<div class="flex w-full flex-col" style="gap: var(--spacing-component-default)">
			{#each ["medium", "large", "responsive"] as const as size (size)}
				<Accordion {size} items={[{ value: "item-1", title: "아코디언 항목", description: `size=${size}${size === "medium" ? " (default)" : ""}`, content: "항목의 내용입니다." }]} content={accordionBody} />
			{/each}
		</div>
	</Demo>
	<Demo id="accordion-prefix" title="Prefix" level={3} live="accordion:6" wide>
		<Accordion items={[{ value: "shipping", prefixIcon: Truck, title: "배송 방법", content: "일반 배송, 빠른 배송, 방문 수령 중 주문 상황에 맞는 방법을 선택할 수 있습니다." }, { value: "payment", prefixIcon: CreditCard, title: "결제 및 쿠폰", content: "카드, 간편결제, 보유 쿠폰을 한 번에 확인하고 결제에 적용할 수 있습니다." }, { value: "support", prefixIcon: Headset, title: "문의와 환불", content: "주문 문의와 환불 요청은 고객센터에서 처리됩니다." }]} content={accordionBody} />
	</Demo>
	<Demo id="accordion-description" title="Description" level={3} live="accordion:7" wide>
		<Accordion items={ITEMS.map((i) => ({ ...i, description: "항목에 대한 간략한 설명입니다." }))} content={accordionBody} />
	</Demo>
	<Demo id="accordion-disabled" title="Disabled" level={3} live="accordion:8" wide>
		<Accordion items={[{ value: "item-1", title: "활성화된 항목", content: "이 항목은 활성화 상태입니다." }, { value: "item-2", title: "비활성화된 항목", disabled: true, content: "이 항목은 비활성화 상태입니다." }, { value: "item-3", title: "활성화된 항목", content: "이 항목은 활성화 상태입니다." }]} content={accordionBody} />
	</Demo>
	<Demo id="accordion-default-expanded" title="Default Expanded" level={3} live="accordion:11" wide>
		<Accordion multiple value={["item-1"]} items={three("첫 번째 항목은 기본으로 펼쳐진 상태입니다.", "두 번째 항목의 내용입니다.", "세 번째 항목의 내용입니다.")} content={accordionBody} />
	</Demo>

	<!-- ───────────── Avatar ───────────── -->
	<h2 id="avatar" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Avatar</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">사용자나 가게를 나타내는 원형 이미지입니다.</p>
	<Demo id="avatar-preview" live="avatar:0">
		<div class="flex" style="gap: var(--dimension-x4)">
			<Avatar size="80" badgeMask="circle" src={AVATAR}>
				{#snippet badge()}<div style="border-radius: var(--radius-full); background: var(--palette-green-600); width: var(--dimension-x6); height: var(--dimension-x6)"></div>{/snippet}
			</Avatar>
			<Avatar size="80" />
		</div>
	</Demo>
	<Demo id="avatar-size" title="Size" level={3} live="avatar:1">
		<div class="flex" style="gap: var(--dimension-x4)">
			{#each ["20", "24", "36", "48", "64", "80", "96", "108"] as const as size (size)}<Avatar {size} src={AVATAR} fallback="L" />{/each}
		</div>
	</Demo>
	<Demo id="avatar-badge" title="Badge & Badge Mask" level={3} live="avatar:2">
		<div class="flex" style="gap: var(--dimension-x4)">
			{#each ["circle", "flower", "shield"] as const as mask (mask)}
				<Avatar size="64" badgeMask={mask} src={AVATAR}>
					{#snippet badge()}<div style="width: 100%; height: 100%; border-radius: var(--radius-full); background: var(--palette-green-600)"></div>{/snippet}
				</Avatar>
			{/each}
		</div>
	</Demo>
	<Demo id="avatar-stack" title="Stack" level={3} live="avatar:3"><AvatarStack size="64" srcs={[AVATAR, AVATAR, AVATAR, AVATAR]} /></Demo>
	<Demo id="avatar-fallback" title="Fallback Image" level={3} live="avatar:4">
		<div class="flex items-center" style="gap: var(--dimension-x4)"><Avatar size="80" identity="person" /><Avatar size="80" identity="business" /></div>
	</Demo>
	<Demo id="identity-placeholder" title="Identity Placeholder" level={3} live="identity-placeholder:1" stage={340}>
		<div class="grid" style="grid-template-columns: repeat(2, 1fr); gap: var(--dimension-x4); width: 616px"><IdentityPlaceholder identity="person" /><IdentityPlaceholder identity="business" /></div>
	</Demo>

	<!-- ───────────── Badge ───────────── -->
	<h2 id="badge" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Badge</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">상태나 속성을 짧은 텍스트로 강조합니다.</p>
	<Demo id="badge-preview" live="badge:0"><Badge>라벨</Badge></Demo>
	<Demo id="badge-truncating" title="Truncating Behavior" level={3} live="badge:1">
		<div class="flex flex-col" style="gap: var(--dimension-x4)">
			<Badge size="medium">In velit velit deserunt amet veniam incididunt consectetur incididunt Lorem.</Badge>
			<Badge size="large">In velit velit deserunt amet veniam incididunt consectetur incididunt Lorem.</Badge>
		</div>
	</Demo>
	{#each TONES as tone, i (tone)}
		<Demo id="badge-{tone}" title="Tones and Variants — {tone}" level={3} live="badge:{i + 2}">
			<div class="flex" style="gap: var(--dimension-x4)">
				{#each ["medium", "large"] as const as size (size)}
					<div class="flex flex-col" style="gap: var(--dimension-x4)">
						{#each ["solid", "weak", "outline"] as const as variant (variant)}<Badge {tone} {variant} {size}>라벨</Badge>{/each}
					</div>
				{/each}
			</div>
		</Demo>
	{/each}

	<!-- ───────────── Divider ───────────── -->
	<h2 id="divider" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Divider</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">콘텐츠 사이를 1px 선으로 구분합니다.</p>
	<Demo id="divider-preview" live="divider:0" wide>
		<div class="flex w-full flex-col" style="background: var(--bg-layer-default); padding: var(--dimension-x4)">
			<div style="padding: var(--dimension-x4)">Nisi elit pariatur incididunt quis fugiat mollit ipsum fugiat duis culpa esse incididunt cupidatat.</div>
			<Divider />
			<div style="padding: var(--dimension-x4)">Consectetur voluptate quis do culpa et culpa.</div>
		</div>
	</Demo>
	{#each [["orientation", "Orientation", false, 1], ["inset", "Inset", true, 2]] as [id, title, inset, idx] (id)}
		<Demo id="divider-{id}" title={title as string} level={3} live="divider:{idx}" wide>
			<div class="flex w-full flex-col" style="gap: var(--dimension-x4)">
				<div class="flex grow flex-col" style="background: var(--bg-layer-default); gap: var(--dimension-x4)">
					<div style="background: var(--palette-blue-400); height: var(--dimension-x8)"></div>
					<Divider inset={inset as boolean} />
					<div style="background: var(--palette-blue-400); height: var(--dimension-x8)"></div>
				</div>
				<div class="flex grow" style="background: var(--bg-layer-default); gap: var(--dimension-x4); height: var(--dimension-x16)">
					<div class="grow" style="background: var(--palette-blue-400)"></div>
					<Divider orientation="vertical" inset={inset as boolean} />
					<div class="grow" style="background: var(--palette-blue-400)"></div>
				</div>
			</div>
		</Demo>
	{/each}

	<!-- ───────────── Article / AspectRatio / ContentPlaceholder ───────────── -->
	<h2 id="article" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Article</h2>
	<Demo id="article-preview" live="article:0">
		<Article style="display: flex; flex-direction: column; gap: var(--dimension-x2); width: 400px"><Text as="p" textStyle="articleBody">Article은 일관된 selection 및 줄바꿈 정책을 사용할 수 있게 돕는 유틸리티 컴포넌트입니다.</Text><Text as="p" textStyle="articleBody">여기를 드래그해서 선택해보세요.</Text></Article>
	</Demo>
	<h2 id="aspect-ratio" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Aspect Ratio</h2>
	<Demo id="aspect-ratio-preview" live="aspect-ratio:0" stage={442}>
		<div class="flex flex-col" style="gap: var(--dimension-x4)">
			{#each [[4 / 3, "4 / 3"], [1, "1:1"], [16 / 9, "16 / 9"]] as [ratio, label] (label)}
				<AspectRatio ratio={ratio as number} style="width: 160px; background: var(--palette-gray-100)"><Text color="--palette-gray-700">{label}</Text></AspectRatio>
			{/each}
		</div>
	</Demo>
	<Demo id="aspect-ratio-ratio" title="Ratio" level={3} live="aspect-ratio:1">
		<div class="flex" style="gap: var(--dimension-x4)">
			{#each [[1, "square/400/400"], [4 / 3, "4-3/400/300"], [16 / 9, "16-9/400/225"]] as [ratio, path] (path)}
				<div style="width: 150px"><AspectRatio ratio={ratio as number}><img src="https://picsum.photos/seed/{path}" alt="" /></AspectRatio></div>
			{/each}
		</div>
	</Demo>
	<h2 id="content-placeholder" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Content Placeholder</h2>
	<Demo id="content-placeholder-type" title="Type Preset" level={3} live="content-placeholder:1" wide>
		<div class="flex flex-wrap" style="gap: var(--dimension-x3)">
			{#each Object.keys(CONTENT_PLACEHOLDER_ASSETS) as type (type)}<div style="width: 120px; height: 120px"><ContentPlaceholder type={type as ContentPlaceholderType} /></div>{/each}
		</div>
	</Demo>

	<!-- ───────────── Image Frame ───────────── -->
	<h2 id="image-frame" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Image Frame</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">비율, 모서리, 선, 대체 이미지를 갖춘 이미지 틀입니다.</p>
	<Demo id="image-frame-preview" live="image-frame:0"><ImageFrame ratio={4 / 3} radius="--radius-r2" stroke src={PHOTO} alt="Landscape photograph by Tobias Tullius" width="300px" fallback="commerce" /></Demo>
	<Demo id="image-frame-ratio" title="Ratio" level={3} live="image-frame:1">
		<div class="flex flex-wrap items-end" style="gap: var(--dimension-x2)">
			{#each [[1, 120, "1:1", "buySell"], [4 / 3, 160, "4:3", "food"], [16 / 9, 200, "16:9", "car"]] as [ratio, w, label, fb] (label)}
				<div class="flex flex-col items-center" style="gap: var(--dimension-x2)"><ImageFrame ratio={ratio as number} stroke src={PHOTO} alt={label as string} width="{w}px" fallback={fb as ContentPlaceholderType} /><Text color="--palette-gray-700" textStyle="t1Regular">{label}</Text></div>
			{/each}
		</div>
	</Demo>
	<Demo id="image-frame-radius" title="Border Radius" level={3} live="image-frame:2">
		<div class="flex flex-wrap items-end" style="gap: var(--dimension-x4)">
			{#each RADII as [w, , radius, label, fb] (label)}
				<div class="flex flex-col items-center" style="gap: var(--dimension-x2)"><ImageFrame ratio={4 / 3} {radius} src={PHOTO_SM} alt={label} width="{w}px" fallback={fb} /><Text color="--palette-gray-700" textStyle="t1Regular">{label}</Text></div>
			{/each}
		</div>
	</Demo>
	<Demo id="image-frame-stroke" title="Stroke" level={3} live="image-frame:3">
		<div class="flex flex-wrap items-end" style="gap: var(--dimension-x4)">
			{#each [[false, "post"], [true, "group"]] as [stroke, fb] (fb)}
				<div class="flex flex-col items-center" style="gap: var(--dimension-x2)"><ImageFrame ratio={4 / 3} stroke={stroke as boolean} src={PHOTO} alt="stroke={stroke}" width="150px" fallback={fb as ContentPlaceholderType} /><Text color="--palette-gray-700" textStyle="t1Regular">stroke={String(stroke)}</Text></div>
			{/each}
		</div>
	</Demo>
	<Demo id="image-frame-fallback" title="Fallback Image" level={3} live="image-frame:4">
		<div class="flex flex-wrap items-end" style="gap: var(--dimension-x3)">
			{#each ["buySell", "food", "jobs"] as const as fb (fb)}<ImageFrame ratio={1} stroke src="https://invalid-url" alt="Fallback with {fb} type" width="120px" fallback={fb} />{/each}
		</div>
	</Demo>
	<Demo id="image-frame-overlay" title="Overlay" level={3} live="image-frame:5">
		<div class="flex flex-wrap items-end" style="gap: var(--dimension-x3)">
			<div class="flex flex-col items-center" style="gap: var(--dimension-x2)">
				<ImageFrame ratio={1} stroke src={PHOTO} width="120px" fallback="buySell">{#snippet overlay()}<ImageFrameFloater placement="bottom-end"><Badge tone="brand" variant="solid">NEW</Badge></ImageFrameFloater>{/snippet}</ImageFrame>
				<Text color="--palette-gray-700" textStyle="t1Regular">ImageFrameBadge</Text>
			</div>
			<div class="flex flex-col items-center" style="gap: var(--dimension-x2)">
				<ImageFrame ratio={1} stroke src={PHOTO} width="120px" fallback="commerce">{#snippet overlay()}<ImageFrameFloater placement="bottom-end"><ImageFrameIndicator icon={Carrot} /></ImageFrameFloater>{/snippet}</ImageFrame>
				<Text color="--palette-gray-700" textStyle="t1Regular">ImageFrameIcon</Text>
			</div>
			<div class="flex flex-col items-center" style="gap: var(--dimension-x2)">
				<ImageFrame ratio={1} stroke src={PHOTO} width="120px" fallback="image">{#snippet overlay()}<ImageFrameFloater placement="bottom-end"><ImageFrameIndicator>+9</ImageFrameIndicator></ImageFrameFloater>{/snippet}</ImageFrame>
				<Text color="--palette-gray-700" textStyle="t1Regular">ImageFrameIndicator</Text>
			</div>
			<div class="flex flex-col items-center" style="gap: var(--dimension-x2)">
				<ImageFrame ratio={1} stroke src={PHOTO} width="120px" fallback="post">{#snippet overlay()}<ImageFrameFloater placement="bottom-end"><ImageFrameReactionButton bind:pressed={liked} /></ImageFrameFloater>{/snippet}</ImageFrame>
				<Text color="--palette-gray-700" textStyle="t1Regular">ImageFrameReactionButton</Text>
			</div>
		</div>
	</Demo>
	<Demo id="image-frame-overlay-multiple" title="Overlay — multiple" level={3} live="image-frame:6">
		<ImageFrame ratio={1} stroke src={PHOTO} width="200px" fallback="coupon">
			{#snippet overlay()}
				<ImageFrameFloater placement="top-start"><Badge tone="brand" variant="solid">NEW</Badge></ImageFrameFloater>
				<ImageFrameFloater placement="bottom-end"><ImageFrameReactionButton bind:pressed={liked2} /></ImageFrameFloater>
			{/snippet}
		</ImageFrame>
	</Demo>

	<!-- ───────────── Manner Temp ───────────── -->
	<h2 id="manner-temp" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Manner Temp</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">당근 사용자의 매너온도를 레벨 색과 표정으로 보여줍니다.</p>
	<Demo id="manner-temp-preview" live="manner-temp:0">
		<div class="flex flex-col items-end" style="gap: var(--dimension-x1)">{#each TEMPS as t (t)}<MannerTemp temperature={t} />{/each}</div>
	</Demo>
	<Demo id="manner-temp-badge-preview" title="Manner Temp Badge" level={3} live="manner-temp-badge:0">
		<div class="flex flex-col items-end" style="gap: var(--dimension-x1)">{#each TEMPS as t (t)}<MannerTempBadge temperature={t} />{/each}</div>
	</Demo>

	<!-- ───────────── Result Section ───────────── -->
	<h2 id="result-section" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Result Section</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">작업 결과나 빈 상태를 설명하는 섹션입니다.</p>
	<Demo id="result-section-preview" live="result-section:0" stage={520}>
		<div class="flex flex-col" style="min-height: 480px; width: 320px; border: 1px solid var(--stroke-neutral-muted)"><ResultSection title="결과 타이틀" description="부가 설명을 적어주세요" primary="Primary Action" secondary="Secondary Action">{#snippet asset()}<div style="padding-bottom: var(--dimension-x4)"><Diamond class="seed-icon" aria-hidden="true" style="--seed-icon-size: var(--dimension-x10)" /></div>{/snippet}</ResultSection></div>
	</Demo>
	{#each [["large", 1], ["medium", 2]] as [size, idx] (size)}
		<Demo id="result-section-{size}" title="Sizes — {size}" level={3} live="result-section:{idx}" stage={520}>
			<div class="flex flex-col" style="min-height: 480px; width: 320px; border: 1px solid var(--stroke-neutral-muted)"><ResultSection size={size as "large" | "medium"} title="cupidatat ad consequat" description="Lorem ipsum dolor sit amet consectetur adipisicing elit." primary="Primary Action" secondary="Secondary Action" /></div>
		</Demo>
	{/each}
</Doc>
