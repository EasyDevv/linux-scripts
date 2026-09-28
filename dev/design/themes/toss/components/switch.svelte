<!-- TDS Switch (components/switch).
     Track 50x30 r15, grey200 off / blue500 on. White thumb 16 off / 24 on:
     off sits 7px in (7..23), on is translated 16px (23..47, 3px from the right edge).
     disabled = opacity .3. role=switch + aria-checked + aria-disabled on the label. -->
<script lang="ts">
	let {
		checked = $bindable(false),
		disabled = false,
		label,
	}: { checked?: boolean; disabled?: boolean; label?: string } = $props();
</script>

<label
	class="tds-switch"
	data-tds-mobile-component="Switch"
	role="switch"
	aria-checked={checked}
	aria-disabled={disabled}
	aria-label={label}
	tabindex={disabled ? -1 : 0}
	onkeydown={(e) => {
		if (!disabled && (e.key === " " || e.key === "Enter")) {
			e.preventDefault();
			checked = !checked;
		}
	}}
>
	<input type="checkbox" bind:checked {disabled} hidden />
	<span class="thumb"></span>
</label>

<style>
	.tds-switch {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
		width: var(--switch-width);
		height: var(--switch-height);
		border-radius: calc(var(--switch-height) / 2);
		background: var(--grey-200);
		cursor: pointer;
		transition: background-color 0.2s var(--panel-fold-ease);
		-webkit-tap-highlight-color: transparent;
	}
	.tds-switch[aria-checked="true"] {
		background: var(--status-info);
	}
	.tds-switch[aria-disabled="true"] {
		opacity: var(--control-disabled-opacity);
		cursor: default;
	}
	.thumb {
		position: absolute;
		top: 50%;
		left: var(--switch-thumb-inset);
		width: var(--switch-thumb-off);
		height: var(--switch-thumb-off);
		border-radius: 100%;
		background: var(--static-white);
		translate: 0 -50%;
		transition:
			width 0.2s var(--panel-fold-ease),
			height 0.2s var(--panel-fold-ease),
			translate 0.2s var(--panel-fold-ease);
	}
	[aria-checked="true"] .thumb {
		width: var(--switch-thumb-on);
		height: var(--switch-thumb-on);
		translate: 16px -50%;
	}
</style>
