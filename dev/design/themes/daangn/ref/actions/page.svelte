<!-- draft-meta: {"route":"actions","title":"Actions","style":"daangn"} -->
<!-- Reconstruction of seed-design.io/react/components/{action-button, toggle-button, reaction-button,
     floating-action-button, contextual-floating-button}: same preview sections in the same order;
     every preview renders ../../components/*.svelte. -->
<script lang="ts">
	import Plus from "@lucide/svelte/icons/plus";
	import Tag from "@lucide/svelte/icons/tag";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import Bell from "@lucide/svelte/icons/bell";
	import Check from "@lucide/svelte/icons/check";
	import Smile from "@lucide/svelte/icons/smile";
	import ActionButton from "../../components/action-button.svelte";
	import ContextualFloatingButton from "../../components/contextual-floating-button.svelte";
	import FloatingActionButton from "../../components/floating-action-button.svelte";
	import ReactionButton from "../../components/reaction-button.svelte";
	import Switch from "../../components/switch.svelte";
	import ToggleButton from "../../components/toggle-button.svelte";
	import Demo from "../demo.svelte";
	import Doc from "../doc.svelte";

	const SOLID = [
		["brand-solid", "Brand Solid", "brandSolid"],
		["neutral-solid", "Neutral Solid", "neutralSolid"],
		["neutral-weak", "Neutral Weak", "neutralWeak"],
		["critical-solid", "Critical Solid", "criticalSolid"],
		["brand-outline", "Brand Outline", "brandOutline"],
		["neutral-outline", "Neutral Outline", "neutralOutline"],
	] as const;
	const SIZES = [
		["xsmall", "32 · pill · px14 · t3"],
		["small", "36 · r8 · px14 · t4"],
		["medium", "40 · r8 · px16 · t4"],
		["large", "52 · r12 · px20 · t6"],
	] as const;

	let loading = $state(false);
	function run() {
		loading = true;
		setTimeout(() => (loading = false), 2000);
	}
	const toggles = $state({ preview: false, brand: false, weak: false, small: false, xsmall: false, icon: false, slow: false, slowLoading: false });
	const reactions = $state({ slow: false, slowLoading: false });
	let extended = $state(true);
	function slowToggle(key: "slow", into: { slow: boolean; slowLoading: boolean }) {
		into.slowLoading = true;
		setTimeout(() => {
			into.slowLoading = false;
			into[key] = !into[key];
		}, 2000);
	}
</script>

<Doc
	page="actions"
	title="Action Button"
	lead="명확한 액션을 쉽게 수행할 수 있도록 돕는 기본 인터랙션 컴포넌트입니다."
	toc={[
		{ id: "action-button", label: "Action Button" },
		{ id: "action-button-variants", label: "Variants" },
		{ id: "action-button-ghost", label: "Ghost" },
		{ id: "action-button-icon-only", label: "Icon Only" },
		{ id: "action-button-prefix-icon", label: "Prefix Icon" },
		{ id: "action-button-suffix-icon", label: "Suffix Icon" },
		{ id: "action-button-disabled", label: "Disabled" },
		{ id: "action-button-loading", label: "Loading" },
		{ id: "action-button-size", label: "Size" },
		{ id: "toggle-button", label: "Toggle Button" },
		{ id: "reaction-button", label: "Reaction Button" },
		{ id: "floating-action-button", label: "Floating Action Button" },
		{ id: "contextual-floating-button", label: "Contextual Floating Button" },
	]}
>
	<Demo id="action-button" live="action-button:0">
		<ActionButton>라벨</ActionButton>
	</Demo>

	<h2 id="action-button-variants" style="margin: 48px 0 24px; font-size: 24px; line-height: 32px; font-weight: 500">Examples</h2>
	{#each SOLID as [id, title, variant], i (id)}
		<Demo id="action-button-{id}" {title} level={3} live="action-button:{i + 1}">
			<ActionButton {variant}>라벨</ActionButton>
		</Demo>
	{/each}

	<Demo id="action-button-ghost" live="action-button:7" title="Ghost" level={3} spec="color: --seed-box-color (fg.neutral default) · fontWeight bold / medium / regular">
		<div class="flex flex-col items-center" style="gap: var(--spacing-component-default)">
			<div class="flex" style="gap: var(--dimension-x2)">
				<ActionButton variant="ghost" prefixIcon={Tag}>Default (fg.neutral)</ActionButton>
				<ActionButton variant="ghost" prefixIcon={Tag} color="--fg-neutral-subtle">Neutral Subtle</ActionButton>
				<ActionButton variant="ghost" prefixIcon={Tag} color="--fg-brand">Brand</ActionButton>
			</div>
			<div class="flex" style="gap: var(--dimension-x2)">
				<ActionButton variant="ghost">Default (Bold)</ActionButton>
				<ActionButton variant="ghost" fontWeight="medium">Medium</ActionButton>
				<ActionButton variant="ghost" fontWeight="regular">Regular</ActionButton>
			</div>
		</div>
	</Demo>

	<Demo id="action-button-icon-only" live="action-button:8" title="Icon Only" level={3}>
		<ActionButton icon={Plus} aria-label="추가" />
	</Demo>

	<Demo id="action-button-prefix-icon" live="action-button:9" title="Prefix Icon" level={3}>
		<ActionButton prefixIcon={Plus}>라벨</ActionButton>
	</Demo>

	<Demo id="action-button-suffix-icon" live="action-button:10" title="Suffix Icon" level={3}>
		<ActionButton suffixIcon={ChevronRight}>라벨</ActionButton>
	</Demo>

	<Demo id="action-button-disabled" live="action-button:11" title="Disabled" level={3}>
		<ActionButton disabled>라벨</ActionButton>
	</Demo>

	<Demo id="action-button-loading" live="action-button:12" title="Loading" level={3} spec="click: loading 2s — width kept, ProgressCircle inherits --size / colour">
		<ActionButton {loading} onclick={run}>시간이 걸리는 액션</ActionButton>
	</Demo>

	<Demo id="action-button-size" title="Size" level={3} spec="not a docs section: every size × withText / iconOnly">
		<div class="grid" style="gap: 12px">
			{#each SIZES as [size, note] (size)}
				<div class="flex items-center" style="gap: 12px">
					<ActionButton {size}>라벨</ActionButton>
					<ActionButton {size} variant="neutralWeak" prefixIcon={Plus}>라벨</ActionButton>
					<ActionButton {size} variant="neutralOutline" icon={Plus} aria-label="추가" />
					<code style="font-size: 12px; color: var(--fg-neutral-subtle)">{size} {note}</code>
				</div>
			{/each}
		</div>
	</Demo>

	<h2 id="toggle-button" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Toggle Button</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">선택 상태를 켜고 끌 수 있는 버튼입니다.</p>
	<Demo id="toggle-button-preview" live="toggle-button:0">
		<ToggleButton bind:pressed={toggles.preview}>{toggles.preview ? "선택됨" : "미선택"}</ToggleButton>
	</Demo>
	<Demo id="toggle-button-brand-solid" title="Brand Solid" level={3} live="toggle-button:1">
		<ToggleButton variant="brandSolid" bind:pressed={toggles.brand}>{toggles.brand ? "선택됨" : "미선택"}</ToggleButton>
	</Demo>
	<Demo id="toggle-button-neutral-weak" title="Neutral Weak" level={3} live="toggle-button:2">
		<ToggleButton variant="neutralWeak" bind:pressed={toggles.weak}>{toggles.weak ? "선택됨" : "미선택"}</ToggleButton>
	</Demo>
	<Demo id="toggle-button-small" title="Small" level={3} live="toggle-button:3">
		<ToggleButton size="small" bind:pressed={toggles.small}>{toggles.small ? "선택됨" : "미선택"}</ToggleButton>
	</Demo>
	<Demo id="toggle-button-xsmall" title="Xsmall" level={3} live="toggle-button:4">
		<ToggleButton size="xsmall" bind:pressed={toggles.xsmall}>{toggles.xsmall ? "선택됨" : "미선택"}</ToggleButton>
	</Demo>
	<Demo id="toggle-button-prefix-icon" title="Prefix Icon" level={3} live="toggle-button:5">
		<ToggleButton bind:pressed={toggles.icon} prefixIcon={toggles.icon ? Plus : Check}>{toggles.icon ? "선택됨" : "미선택"}</ToggleButton>
	</Demo>
	<Demo id="toggle-button-disabled" title="Disabled" level={3} live="toggle-button:6">
		<ToggleButton disabled>비활성</ToggleButton>
	</Demo>
	<Demo id="toggle-button-loading" title="Loading" level={3} live="toggle-button:7">
		<ToggleButton pressed={toggles.slow} loading={toggles.slowLoading} onPressedChange={() => { toggles.slowLoading = true; setTimeout(() => { toggles.slowLoading = false; toggles.slow = !toggles.slow; }, 2000); }}>시간이 걸리는 토글</ToggleButton>
	</Demo>

	<h2 id="reaction-button" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Reaction Button</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">사용자가 콘텐츠에 대한 반응을 표현할 수 있게 해주는 컴포넌트입니다. 좋아요, 관심있어요 등의 감정적 피드백을 간편하게 제공할 때 사용됩니다.</p>
	<Demo id="reaction-button-preview" live="reaction-button:0">
		<ReactionButton prefixIcon={Smile} count={1}>도움돼요</ReactionButton>
	</Demo>
	<Demo id="reaction-button-small" title="Small" level={3} live="reaction-button:1">
		<ReactionButton size="small" prefixIcon={Smile} count={1}>도움돼요</ReactionButton>
	</Demo>
	<Demo id="reaction-button-xsmall" title="Xsmall" level={3} live="reaction-button:2">
		<ReactionButton size="xsmall" prefixIcon={Smile} count={1}>도움돼요</ReactionButton>
	</Demo>
	<Demo id="reaction-button-disabled" title="Disabled" level={3} live="reaction-button:3">
		<ReactionButton disabled prefixIcon={Smile}>비활성</ReactionButton>
	</Demo>
	<Demo id="reaction-button-loading" title="Loading" level={3} live="reaction-button:4">
		<ReactionButton prefixIcon={Smile} pressed={reactions.slow} loading={reactions.slowLoading} onPressedChange={() => slowToggle("slow", reactions)}>시간이 걸리는 토글</ReactionButton>
	</Demo>

	<h2 id="floating-action-button" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Floating Action Button</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">화면 위에 떠 있는 주요 액션 버튼입니다.</p>
	<Demo id="floating-action-button-preview" live="floating-action-button:0">
		<FloatingActionButton icon={Plus} label="Example FAB" />
	</Demo>
	<Demo id="floating-action-button-extended" title="Extended" level={3} live="floating-action-button:1">
		<div class="flex flex-col items-center justify-between">
			<div class="flex items-center justify-center" style="height: 100px"><FloatingActionButton icon={Plus} label="Extended" {extended} /></div>
			<Switch size="16" tone="neutral" label="Extended" bind:checked={extended} />
		</div>
	</Demo>
	<Demo id="floating-action-button-float" title="Float Composition" level={3} live="floating-action-button:2" stage={540}>
		<div class="relative" style="width: 300px; height: 500px; border: 1px solid var(--stroke-neutral-muted)">
			<div class="absolute" style="right: var(--dimension-x4); bottom: var(--dimension-x4)"><FloatingActionButton icon={Bell} label="알림 설정" /></div>
		</div>
	</Demo>

	<h2 id="contextual-floating-button" style="margin: 96px 0 8px; font-size: 40px; line-height: 48px; font-weight: 500">Contextual Floating Button</h2>
	<p style="font-size: 16px; line-height: 24px; font-weight: 300; color: var(--fg-neutral-muted)">화면의 맥락에 맞는 보조 액션을 띄워 보여주는 버튼입니다.</p>
	<Demo id="contextual-floating-button-preview" live="contextual-floating-button:0">
		<ContextualFloatingButton prefixIcon={Bell}>알림 설정</ContextualFloatingButton>
	</Demo>
	<Demo id="contextual-floating-button-float" title="Float Composition" level={3} live="contextual-floating-button:1" stage={540}>
		<div class="relative" style="width: 300px; height: 500px; border: 1px solid var(--stroke-neutral-muted)">
			<div class="absolute" style="left: 50%; bottom: var(--dimension-x4); translate: -50% 0"><ContextualFloatingButton prefixIcon={Bell}>알림 설정</ContextualFloatingButton></div>
		</div>
	</Demo>
	<Demo id="contextual-floating-button-solid" title="Solid Variant" level={3} live="contextual-floating-button:2">
		<ContextualFloatingButton variant="solid" prefixIcon={Plus}>Solid Variant</ContextualFloatingButton>
	</Demo>
	<Demo id="contextual-floating-button-layer" title="Layer Variant" level={3} live="contextual-floating-button:3">
		<ContextualFloatingButton variant="layer" prefixIcon={Plus}>Layer Variant</ContextualFloatingButton>
	</Demo>
	<Demo id="contextual-floating-button-icon-only" title="Icon Only" level={3} live="contextual-floating-button:4">
		<ContextualFloatingButton icon={Plus} aria-label="추가" />
	</Demo>
	<Demo id="contextual-floating-button-loading" title="Loading" level={3} live="contextual-floating-button:5">
		<ContextualFloatingButton prefixIcon={Plus} {loading} onclick={run}>시간이 걸리는 액션</ContextualFloatingButton>
	</Demo>
</Doc>
