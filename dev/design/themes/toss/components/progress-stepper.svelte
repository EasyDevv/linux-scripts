<!-- TDS ProgressStepper (components/progress-stepper).
     compact  34h row, padding 0 24, margin 16 0 8 (paddingTop wide = 24): 8px track (r40, #edeff2 = grey100)
              with a blue-tinted progress fill (blue500 24-29% gradient + 0 0 50px blue500/50% glow);
              8px dots — done/idle show a 5px greyOpacity800-white core, the active dot is blue500 with a
              16px blue500 halo; labels 13/19.5: active 700 grey800, others 600 grey600; first/last
              labels align start/end; gap 6 between dot and label
     icon     56h row: 28px track, 28px discs (22px white inner, 16px icon), active disc blue500
              with a white icon; gap 8
     Each step: role=text, aria-label "총 N 단계 중 k 번째인 {title}이에요", aria-current=step on the active one. -->
<script lang="ts">
	type Step = { title: string };

	let {
		steps,
		activeStepIndex = 0,
		variant = "compact",
		paddingTop = "default",
	}: {
		steps: Step[];
		activeStepIndex?: number;
		variant?: "compact" | "icon";
		paddingTop?: "default" | "wide";
	} = $props();

	const ord = ["첫", "두", "세", "네", "다섯", "여섯"];
	const ratio = $derived(steps.length > 1 ? activeStepIndex / (steps.length - 1) : 1);
</script>

<ol class="tds-pstepper" data-tds-mobile-component="ProgressStepper" data-variant={variant} data-pad={paddingTop} style:--ratio={ratio}>
	<span class="track" aria-hidden="true"><span class="fill"></span></span>
	{#each steps as step, i (i)}
		<li
			class="step"
			data-state={i < activeStepIndex ? "done" : i === activeStepIndex ? "active" : "todo"}
			data-edge={i === 0 ? "start" : i === steps.length - 1 ? "end" : "mid"}
			role="text"
			tabindex="0"
			aria-current={i === activeStepIndex ? "step" : undefined}
			aria-label={`총 ${steps.length} 단계 중 ${i === steps.length - 1 ? "마지막" : `${ord[i] ?? i + 1} 번째`}인 ${step.title}이에요`}
		>
			<span class="dot" aria-hidden="true">
				{#if variant === "icon"}
					<span class="inner">
						<svg viewBox="0 0 16 16"><path d="M4 8.3l2.6 2.5L12 5.4" /></svg>
					</span>
				{/if}
			</span>
			<span class="label" aria-hidden="true">{step.title}</span>
		</li>
	{/each}
</ol>

<style>
	.tds-pstepper {
		--dot: 8px;
		--track: 8px;
		position: relative;
		display: flex;
		justify-content: space-between;
		margin: 16px 0 8px;
		padding: 0 var(--row-inset);
		list-style: none;
	}
	.tds-pstepper[data-pad="wide"] {
		margin-top: 24px;
	}
	.tds-pstepper[data-variant="icon"] {
		--dot: 28px;
		--track: 28px;
		margin-top: 24px;
	}
	.track {
		position: absolute;
		top: 0;
		left: var(--row-inset);
		right: var(--row-inset);
		height: var(--track);
		border-radius: 40px;
		background: var(--grey-100);
	}
	.fill {
		position: absolute;
		inset: 0 auto 0 0;
		width: calc(var(--dot) + (100% - var(--dot)) * var(--ratio));
		border-radius: 40px;
		background:
			linear-gradient(90deg, color-mix(in srgb, var(--blue-500) 24%, transparent), color-mix(in srgb, var(--blue-500) 29%, transparent)),
			var(--surface-float);
		box-shadow: 0 0 50px 0 color-mix(in srgb, var(--blue-500) 50%, transparent);
	}
	.step {
		position: relative;
		flex: 1 1 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		min-width: 0;
		outline: none;
	}
	[data-variant="icon"] .step {
		gap: 8px;
	}
	.step[data-edge="start"] {
		align-items: flex-start;
	}
	.step[data-edge="end"] {
		align-items: flex-end;
	}
	.dot {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--dot);
		height: var(--dot);
		border-radius: 100%;
	}
	[data-variant="compact"] .dot::after {
		content: "";
		width: 5px;
		height: 5px;
		border-radius: 100%;
		background: color-mix(in srgb, var(--surface-float) 89%, transparent);
	}
	[data-variant="compact"] [data-state="active"] .dot {
		background: var(--blue-500);
	}
	[data-variant="compact"] [data-state="active"] .dot::after {
		display: none;
	}
	[data-variant="compact"] [data-state="active"] .dot::before {
		content: "";
		position: absolute;
		inset: -4px;
		border-radius: 100%;
		background: color-mix(in srgb, var(--blue-500) 30%, transparent);
	}
	.inner {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--surface-float);
		color: var(--ink-subtle);
	}
	[data-state="active"] .inner {
		background: var(--blue-500);
		color: var(--static-white);
	}
	[data-variant="icon"] [data-state="active"] .dot {
		background: var(--blue-500);
	}
	.inner svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.label {
		color: var(--ink-subtle);
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		font-weight: 600;
		white-space: nowrap;
	}
	[data-state="active"] .label {
		color: var(--ink);
		font-weight: 700;
	}
</style>
