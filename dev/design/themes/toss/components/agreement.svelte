<!-- TDS AgreementV4 (components/Agreement/v4). One consent row; stack rows for a terms list.
     row        flex, margin 4px 20px 0 (+ indent), min-height 28
     checkbox   28x28 hit (role=checkbox), 24px check mark: grey200 idle / blue500 checked;
                dot = 4px grey300 bullet (child rows), hidden = no graphic
     text       padding 2px 4px; medium 15/22.5/600 grey700 · xLarge 19/28/600 grey800 (전체 동의)
                · medium-title 17/25.5/700 grey800 (header) · small 13/19.5/500 grey500
     necessity  "필수" blue500 / "선택" grey500, same type, 4px before the text
     right      badge (13/19.5/600, padding 2px 4px, r4; clear = ink only, fill = 10% wash)
                or a 16px grey400 chevron that rotates when open (aria-expanded) -->
<script lang="ts">
	let {
		label,
		variant = "medium",
		control = "checkbox",
		checked = $bindable(false),
		necessity,
		badge,
		badgeTone = "blue",
		badgeVariant = "clear",
		open = $bindable<boolean | undefined>(undefined),
		indent = 0,
		onPress,
	}: {
		label: string;
		variant?: "xLarge" | "medium" | "medium-title" | "small";
		control?: "checkbox" | "dot" | "hidden";
		checked?: boolean;
		necessity?: "mandatory" | "optional";
		badge?: string;
		badgeTone?: "blue" | "yellow";
		badgeVariant?: "clear" | "fill";
		open?: boolean;
		indent?: number;
		onPress?: () => void;
	} = $props();
</script>

<div class="tds-agreement" data-tds-mobile-component="AgreementV4" data-variant={variant} style:margin-left={`${20 + indent}px`}>
	{#if variant !== "medium-title" && control !== "hidden"}
		<span
			class="control"
			role={control === "checkbox" ? "checkbox" : undefined}
			aria-checked={control === "checkbox" ? checked : undefined}
			aria-label={control === "checkbox" ? label : undefined}
			tabindex={control === "checkbox" ? 0 : undefined}
			data-checked={checked}
			onclick={() => control === "checkbox" && (checked = !checked)}
			onkeydown={(e) => control === "checkbox" && (e.key === " " || e.key === "Enter") && (checked = !checked)}
		>
			{#if control === "checkbox"}
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.6l5 4.9 10-10.4" /></svg>
			{:else}
				<i class="dot"></i>
			{/if}
		</span>
	{/if}
	<div class="text" role={onPress ? "button" : "text"} tabindex={onPress ? 0 : undefined} onclick={onPress} onkeydown={(e) => onPress && e.key === "Enter" && onPress()}>
		{#if necessity}<span class="necessity" data-kind={necessity}>{necessity === "mandatory" ? "필수" : "선택"}</span>{/if}
		<span>{label}</span>
	</div>
	{#if badge}
		<span class="badge" data-tone={badgeTone} data-variant={badgeVariant}>{badge}</span>
	{:else if open !== undefined}
		<button type="button" class="arrow" aria-expanded={open} aria-label={open ? "접기" : "펼치기"} onclick={() => (open = !open)}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14.5l5-5 5 5" /></svg>
		</button>
	{/if}
</div>

<style>
	.tds-agreement {
		--fs: var(--text-t6);
		--lh: var(--text-t6--line-height);
		--fw: 600;
		--ink: var(--ink-soft);
		display: flex;
		align-items: flex-start;
		min-height: 28px;
		margin: 4px 20px 0;
	}
	[data-variant="xLarge"] {
		--fs: var(--text-st8);
		--lh: var(--text-st8--line-height);
		--ink: var(--ink);
	}
	[data-variant="medium-title"] {
		--fs: var(--text-t5);
		--lh: var(--text-t5--line-height);
		--fw: 700;
		--ink: var(--ink);
		margin-top: 8px;
	}
	[data-variant="small"] {
		--fs: var(--text-t7);
		--lh: var(--text-t7--line-height);
		--fw: 500;
		--ink: var(--ink-faint);
	}
	.control {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		cursor: pointer;
	}
	.control svg {
		width: 24px;
		height: 24px;
		fill: none;
		stroke: var(--grey-200);
		stroke-width: 2.4;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: stroke 0.15s;
	}
	.control[data-checked="true"] svg {
		stroke: var(--status-info);
	}
	.dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--grey-300);
	}
	.text {
		flex: 1;
		min-width: 0;
		min-height: 26px;
		margin-top: 1px;
		padding: 2px 4px;
		color: var(--ink);
		font-size: var(--fs);
		line-height: var(--lh);
		font-weight: var(--fw);
		word-break: keep-all;
	}
	[role="button"].text {
		cursor: pointer;
	}
	.necessity {
		margin-right: 4px;
		color: var(--ink-faint);
	}
	.necessity[data-kind="mandatory"] {
		color: var(--status-info);
	}
	.badge {
		flex-shrink: 0;
		margin-top: 1px;
		padding: 2px 4px;
		border-radius: 4px;
		color: var(--status-info);
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		font-weight: 600;
	}
	.badge[data-tone="yellow"] {
		color: var(--yellow-700);
	}
	.badge[data-variant="fill"] {
		background: color-mix(in srgb, currentColor 10%, transparent);
	}
	.arrow {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		padding: 2px;
		border: 0;
		border-radius: 6px;
		background: none;
		cursor: pointer;
	}
	.arrow svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: var(--grey-400);
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: rotate 0.2s;
	}
	.arrow[aria-expanded="false"] svg {
		rotate: 180deg;
	}
</style>
