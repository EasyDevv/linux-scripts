<!-- TDS Stepper + StepperRow (components/stepper).
     row      74h, padding 3px 24px, flex
     left     44 wide column (30px icon + 14px gap), connector 2px grey200 r1, 6px under the icon,
              stretches to the next row (min 16); hideLine on the last row
     number   30px grey100 disc, 14/1 700 grey700 digit (StepperRow.NumberIcon)
     center   padding-bottom 16; texts type A: title 17/25.5/700 grey800 + desc 15/22.5 grey600 (2px gap)
                               type B: title 20/29/700 + desc 13/19.5/500
     right    padding 4px 0 0 12px: RightArrow (24 grey400) or Button small -->
<script lang="ts">
	import type { Snippet } from "svelte";

	type Step = { title: string; description?: string; right?: Snippet; icon?: Snippet };

	let { steps, type = "A" }: { steps: Step[]; type?: "A" | "B" } = $props();
</script>

<ol class="tds-stepper" data-tds-mobile-component="Stepper" data-type={type}>
	{#each steps as step, i (i)}
		<li class="row">
			<div class="left">
				{#if step.icon}{@render step.icon()}{:else}<span class="number" role="img" aria-label={`${i + 1} 단계`}>{i + 1}</span>{/if}
				{#if i < steps.length - 1}<span class="line" aria-hidden="true"></span>{/if}
			</div>
			<div class="center">
				<div class="texts">
					<span class="title" role="heading" aria-level={2}>{step.title}</span>
					{#if step.description}<span class="desc">{step.description}</span>{/if}
				</div>
				{#if step.right}<div class="right">{@render step.right()}</div>{/if}
			</div>
		</li>
	{/each}
</ol>

<style>
	.tds-stepper {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.row {
		display: flex;
		padding: var(--stepper-inset);
	}
	.left {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex-shrink: 0;
		padding-right: var(--stepper-icon-gap);
	}
	.number {
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--stepper-icon);
		height: var(--stepper-icon);
		border-radius: 50%;
		background: var(--grey-100);
		color: var(--ink-soft);
		font-size: var(--text-st11);
		line-height: 1;
		font-weight: 700;
	}
	.line {
		flex: 1;
		width: var(--stepper-connector-width);
		min-height: 16px;
		margin-top: 6px;
		border-radius: 1px;
		background: var(--grey-200);
	}
	.center {
		flex: 1;
		display: flex;
		min-width: 0;
		padding-bottom: 16px;
	}
	.texts {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding-top: 2px;
	}
	.title {
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		font-weight: 700;
		color: var(--ink);
	}
	.desc {
		padding-top: 2px;
		font-size: var(--text-t6);
		line-height: var(--text-t6--line-height);
		color: var(--ink-subtle);
	}
	[data-type="B"] .title {
		font-size: var(--text-t4);
		line-height: var(--text-t4--line-height);
	}
	[data-type="B"] .desc {
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		font-weight: 500;
	}
	.right {
		padding: 4px 0 0 12px;
	}
</style>
