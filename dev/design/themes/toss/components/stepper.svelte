<!-- TDS Stepper. Row padding 3px 24px; icon column 30px (36 large) with a 14px offset;
     connector 2px x 32px radius 1px at +6px; body padding 0 0 16px; right slot 4px 0 0 12px. -->
<script lang="ts">
	let {
		steps = [{ title: "휴대폰 번호 입력", support: "약관에 동의해 주세요" }],
		done = 0,
		iconSize = 30,
	}: {
		steps?: { title: string; support?: string }[];
		done?: number;
		iconSize?: 30 | 36;
	} = $props();
</script>

<ol style:list-style="none"
	data-tds-mobile-component="Stepper" style:margin="0" style:padding="0">
	{#each steps as step, i (step.title)}
		<li style:padding="var(--stepper-inset)">
			<div style:display="flex">
				<div style:width="calc({iconSize}px + var(--stepper-icon-offset))" style:padding-right="var(--stepper-icon-offset)">
					<div
						style:width="{iconSize}px"
						style:height="{iconSize}px"
						style:border-radius="9999px"
						style:background={i < done ? "var(--blue-500)" : "var(--grey-200)"}
						style:display="flex"
						style:align-items="center"
						style:justify-content="center"
						style:color="var(--surface-float)"
					>
						{#if i < done}✓{:else}{i + 1}{/if}
					</div>
					{#if i < steps.length - 1}
						<div
							style:width="var(--stepper-connector-width)"
							style:height="32px"
							style:margin-top="var(--stepper-connector-offset)"
							style:border-radius="1px"
							style:background={i < done ? "var(--blue-500)" : "var(--grey-200)"}
						></div>
					{/if}
				</div>
				<div style:flex="1" style:padding-bottom="16px">
					<p
						style:margin="0"
						style:padding-top="2px"
						style:font-size="var(--text-body)"
						style:line-height="var(--text-body--line-height)"
						style:font-weight="600"
						style:color="var(--grey-900)"
					>
						{step.title}
					</p>
					{#if step.support}
						<p
							style:margin="0"
							style:padding-top="4px"
							style:padding-left="12px"
							style:font-size="var(--text-body-sm)"
							style:line-height="var(--text-body-sm--line-height)"
							style:color="var(--grey-600)"
						>
							{step.support}
						</p>
					{/if}
				</div>
			</div>
		</li>
	{/each}
</ol>
