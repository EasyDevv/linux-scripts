<!-- TDS AlertDialog / ConfirmDialog (components/Dialog). Measured open at 390x844:
     dim        black at 20% (56% in dark) over the viewport, z 10000; tapping it closes (closeOnDimmerClick)
     panel      320 wide, r24, floatBackground, centred, column
     body       padding 22px 22px 0, gap 8: title t4 20/27/700 grey800, description t6 15/22.5/500 grey600
     alert      footer margin 14px 16px 16px, end-aligned TextButton "확인" 17 at 1.252/700 blue500,
                padding 6px 12px, press layer inset -4/-9 r9
     confirm    footer margin 20px 16px 16px, two Button large (48h r14) with gap 8:
                cancel = weak dark (greyOpacity100 / grey700), confirm = fill primary
     role=dialog + aria-labelledby / aria-describedby. inline renders the panel in flow (catalogue). -->
<script lang="ts">
	let {
		open = $bindable(false),
		variant = "alert",
		title,
		description,
		confirmText = variant === "alert" ? "확인" : "예",
		cancelText = "아니오",
		closeOnDimmerClick = true,
		inline = false,
		onConfirm,
		onCancel,
	}: {
		open?: boolean;
		variant?: "alert" | "confirm";
		title: string;
		description?: string;
		confirmText?: string;
		cancelText?: string;
		closeOnDimmerClick?: boolean;
		inline?: boolean;
		onConfirm?: () => void;
		onCancel?: () => void;
	} = $props();

	const id = `dlg-${Math.random().toString(36).slice(2, 8)}`;
	const close = () => (open = false);
</script>

{#if open || inline}
	<div class="tds-dialog" data-tds-mobile-component={variant === "alert" ? "AlertDialog" : "ConfirmDialog"} data-inline={inline}>
		{#if !inline}
			<button type="button" class="dim" aria-label="닫기" onclick={() => closeOnDimmerClick && close()}></button>
		{/if}
		<div class="panel" role="dialog" aria-modal={!inline} aria-labelledby={`${id}-t`} aria-describedby={description ? `${id}-d` : undefined} tabindex="-1">
			<div class="body">
				<h3 class="title" id={`${id}-t`}>{title}</h3>
				{#if description}<p class="desc" id={`${id}-d`}>{description}</p>{/if}
			</div>
			{#if variant === "alert"}
				<div class="footer alert">
					<button type="button" class="text-action" onclick={() => (onConfirm?.(), close())}>
						<span class="press" aria-hidden="true"></span>{confirmText}
					</button>
				</div>
			{:else}
				<div class="footer confirm">
					<button type="button" class="action weak" onclick={() => (onCancel?.(), close())}>{cancelText}</button>
					<button type="button" class="action fill" onclick={() => (onConfirm?.(), close())}>{confirmText}</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.tds-dialog {
		position: fixed;
		inset: 0;
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	/* inline keeps the fixed layout's centring, just in flow */
	.tds-dialog[data-inline="true"] {
		position: static;
		display: flex;
		justify-content: center;
	}
	.dim {
		position: absolute;
		inset: 0;
		padding: 0;
		border: 0;
		background: var(--overlay-dimmed);
		cursor: default;
	}
	.panel {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: var(--dialog-width);
		border-radius: var(--dialog-radius);
		background: var(--surface-float);
		outline: none;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 22px 22px 0;
	}
	.title {
		margin: 0;
		font-size: var(--text-t4);
		line-height: 1.35;
		font-weight: 700;
		color: var(--ink);
		white-space: pre-line;
		word-break: keep-all;
	}
	.desc {
		margin: 0;
		font-size: var(--text-t6);
		line-height: var(--text-t6--line-height);
		font-weight: 500;
		color: var(--ink-subtle);
		white-space: pre-line;
		word-break: keep-all;
	}
	.footer.alert {
		display: flex;
		justify-content: flex-end;
		margin: 14px 16px 16px;
	}
	.text-action {
		position: relative;
		isolation: isolate;
		padding: 6px 12px;
		border: 0;
		border-radius: var(--control-radius-sm);
		background: none;
		color: var(--status-info);
		font: inherit;
		font-size: var(--text-control);
		line-height: var(--control-label-leading);
		font-weight: 700;
		cursor: pointer;
	}
	.press {
		position: absolute;
		inset: -4px -9px;
		z-index: -1;
		border-radius: 9px;
	}
	.text-action:active .press {
		background: var(--grey-opacity-100);
	}
	.footer.confirm {
		display: flex;
		gap: 8px;
		margin: 20px 16px 16px;
	}
	.action {
		flex: 1;
		height: var(--control-height-lg);
		padding: 0 var(--control-padding-inline);
		border: 0;
		border-radius: var(--control-radius-lg);
		font: inherit;
		font-size: var(--text-control);
		line-height: var(--control-label-leading);
		font-weight: 600;
		cursor: pointer;
	}
	.action.weak {
		background: var(--grey-opacity-100);
		color: var(--grey-700);
	}
	.action.fill {
		background: var(--blue-500);
		color: var(--ink-on-fill);
	}
</style>
