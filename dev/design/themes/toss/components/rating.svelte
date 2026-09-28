<!-- TDS Rating (components/rating). Star colour yellow400 (#ffd158); empty stars grey200.
     size       tiny 20 · small 24 · medium 32 · large 40 (star box); gap 8 / 6 between stars when editable,
                0 when readOnly. `big` = 40 with 20/29 value text.
     variant    full = stars + value text · compact = one star + value · iconOnly = stars only
     value text (readOnly) sits 4px after the stars: tiny 17/25.5/600 · small 20/29/600 · medium 22/31/700 · large 24/33/700
     Editable: a hidden range input carries aria-valuetext "5점 만점 중 N점". -->
<script lang="ts">
	let {
		value = $bindable(5),
		max = 5,
		size = "medium",
		variant = "full",
		readOnly = false,
		disabled = false,
	}: {
		value?: number;
		max?: number;
		size?: "tiny" | "small" | "medium" | "large";
		variant?: "full" | "compact" | "iconOnly";
		readOnly?: boolean;
		disabled?: boolean;
	} = $props();

	const stars = $derived(variant === "compact" ? 1 : max);
</script>

<div class="tds-rating" data-tds-mobile-component="Rating" data-size={size} data-readonly={readOnly} aria-disabled={disabled}>
	<div class="stars">
		{#each { length: stars } as _, i (i)}
			<svg class="star" class:on={variant === "compact" || i < Math.round(value)} viewBox="0 0 24 24" aria-hidden="true">
				<path d="M12 2.6l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" />
			</svg>
		{/each}
		{#if !readOnly}
			<input
				type="range"
				min="0"
				{max}
				step="1"
				bind:value
				{disabled}
				aria-label="별점 평가"
				aria-valuetext={`${max}점 만점 중 ${value}점`}
			/>
		{/if}
	</div>
	{#if variant !== "iconOnly" && (readOnly || variant === "compact")}
		<span class="num" role="text">{value}</span>
	{/if}
</div>

<style>
	.tds-rating {
		--star: 32px;
		--gap: 6px;
		--fs: var(--text-t3);
		--lh: var(--text-t3--line-height);
		--fw: 700;
		display: inline-flex;
		align-items: center;
	}
	.tds-rating[data-size="tiny"] {
		--star: 20px;
		--gap: 8px;
		--fs: var(--text-t5);
		--lh: var(--text-t5--line-height);
		--fw: 600;
	}
	.tds-rating[data-size="small"] {
		--star: 24px;
		--gap: 8px;
		--fs: var(--text-t4);
		--lh: var(--text-t4--line-height);
		--fw: 600;
	}
	.tds-rating[data-size="large"] {
		--star: 40px;
		--fs: var(--text-st5);
		--lh: var(--text-st5--line-height);
	}
	.tds-rating[data-readonly="true"] {
		--gap: 0px;
	}
	.tds-rating[aria-disabled="true"] {
		opacity: var(--control-disabled-opacity);
	}
	.stars {
		position: relative;
		display: flex;
		gap: var(--gap);
	}
	.star {
		width: var(--star);
		height: var(--star);
		fill: var(--grey-200);
	}
	.star.on {
		fill: var(--status-rating);
	}
	input {
		position: absolute;
		inset: 0;
		width: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.num {
		margin-left: 4px;
		color: var(--ink-strong);
		font-size: var(--fs);
		line-height: var(--lh);
		font-weight: var(--fw);
	}
</style>
