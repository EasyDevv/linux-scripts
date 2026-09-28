<!-- TDS Menu.Dropdown (components/menu). Measured:
     glass     182 wide, r20: a blur(30px) layer in white 80% (surface-glass) behind a 0.8px
               white-75% rule (surface-float at 75%) and shadow 0 16px 60px greyOpacity200
     list      padding 10px 0, max-width 257.664
     header    36h, padding 8px 20px, margin-bottom 4: 13/19.5/700 grey500 (role=heading)
     item      42h, padding 8px 20px (8 16 8 20 with a right icon), 17/25.5/500 grey700, role=menuitem;
               right icon 20px, margin-left 16. Checked items show a blue500 check. -->
<script lang="ts">
	type Item = { label: string; checked?: boolean; onclick?: () => void };

	let { header, items, inline = true }: { header?: string; items: Item[]; inline?: boolean } = $props();
</script>

<div class="tds-menu" data-tds-mobile-component="Menu.Dropdown" data-inline={inline} role="menu">
	<span class="glass" aria-hidden="true"></span>
	<div class="list">
		{#if header}<div class="header"><span role="heading" aria-level={2}>{header}</span></div>{/if}
		{#each items as item (item.label)}
			<div
				class="item"
				role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
				aria-checked={item.checked}
				tabindex="0"
				data-icon={item.checked !== undefined}
				onclick={item.onclick}
				onkeydown={(e) => e.key === "Enter" && item.onclick?.()}
			>
				<span class="label">{item.label}</span>
				{#if item.checked !== undefined}
					<svg class="check" class:on={item.checked} viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.tds-menu {
		position: relative;
		display: inline-block;
		width: var(--menu-width);
		border-radius: var(--menu-radius);
		border: var(--hairline-width) solid color-mix(in srgb, var(--surface-float) 75%, transparent);
		box-shadow: var(--shadow-float);
	}
	.glass {
		position: absolute;
		inset: 0;
		border-radius: calc(var(--menu-radius) - 1px);
		background: var(--surface-glass);
		backdrop-filter: blur(var(--glass-blur));
		-webkit-backdrop-filter: blur(var(--glass-blur));
	}
	.list {
		position: relative;
		padding: 10px 0;
	}
	.header {
		display: flex;
		flex-direction: column;
		justify-content: center;
		min-height: 36px;
		margin-bottom: 4px;
		padding: 8px 20px;
		color: var(--ink-faint);
		font-size: var(--text-t7);
		line-height: var(--text-t7--line-height);
		font-weight: 700;
	}
	.item {
		display: flex;
		align-items: center;
		min-height: 42px;
		padding: 8px 20px;
		color: var(--ink-soft);
		font-size: var(--text-t5);
		line-height: var(--text-t5--line-height);
		font-weight: 500;
		cursor: pointer;
		outline: none;
	}
	.item:active,
	.item:focus-visible {
		background: var(--grey-opacity-50);
	}
	.item[data-icon="true"] {
		padding-right: 16px;
	}
	.label {
		flex: 1;
	}
	.check {
		width: 20px;
		height: 20px;
		margin-left: 16px;
		fill: none;
		stroke: transparent;
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.check.on {
		stroke: var(--status-info);
	}
</style>
