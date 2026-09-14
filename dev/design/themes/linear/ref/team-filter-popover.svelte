<script lang="ts">
	import { filterIcons } from "./filter-icons.ts";
	import { filterSubmenus } from "./filter-submenus.ts";
	import { menuItemStyle, menuMark, menuSurface } from "./chrome.ts";
	import {
		popoverEnterDuration,
		popoverEnterEasing,
		popoverOpacity,
		popoverScale,
		popoverOut,
	} from "./popover-motion.ts";

	/* Measured on linear.app (CDP 9201, 2026-09-14): the "Add filter" trigger opens a
	   role="dialog" menu 261.6x707 whose right edge sits on the panel's right edge — i.e. 77px
	   right of the Add filter disc's right edge (1430 vs 1353) — starting at the toolbar's
	   bottom + 4px (y 92). Rows: 37px input row, then a 6px-inset list of 32px items and 12px
	   separators. Item rows reuse the store's measured menu chrome (menuSurface/menuItemStyle).
	   The menu itself runs the same enter/exit spring as the Display options popover, but on the
	   container: enter frames read 0.1971/0.983943 · 0.2919/0.985839 · 0.4418/0.988835 (opacity/scale,
	   transform-origin 129.2px -3.9px = centre-x, trigger bottom) — see popover-motion.ts.
	   Hovering a row with a ▸ expands its submenu instantly (no animation measured on the live
	   submenus); the submenu's right edge sits 2.2px inside the menu's left edge. */
	const ITEM_INSET = 6; /* the item's hover pill is inset 6px inside the 260px column */
	/** measured during the live enter: 129.2px (centre-x) / -3.9px (the trigger's bottom edge) */
	const popoverOrigin = "129.2px -3.9px";
	const SUBMENU_RIGHT = "calc(100% - 2.2px)";

	let hovered = $state<string | null>(null);
	/** Leaving a row for the submenu crosses a ~4px gap; keep the submenu alive briefly. */
	let closeTimer: ReturnType<typeof setTimeout> | undefined;

	function keep(label: string) {
		clearTimeout(closeTimer);
		hovered = label;
	}
	function release() {
		clearTimeout(closeTimer);
		closeTimer = setTimeout(() => (hovered = null), 140);
	}
</script>

<div
	class="absolute z-40 popover-surface"
	data-role="filter-popover"
	out:popoverOut
	style:--popover-origin={`${popoverOrigin}`}
	style:--popover-rest-opacity={`${popoverOpacity}`}
	style:--popover-from-scale={`${popoverScale}`}
	style:--popover-enter-ms={`${popoverEnterDuration}ms`}
	style:--popover-enter-ease={`${popoverEnterEasing}`}
	style="{menuSurface}; top: 100%; right: -77px; margin-top: 4px; width: 261.6px"
>
	<div class="flex items-center" style="height: 37px; padding: 0 12px 0 14px; gap: 14px">
		<input
			class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[color:var(--muted-foreground)]"
			style="font-size: 13px; line-height: 19.5px; padding: 10px 0 9px; color: {menuMark.text}"
			placeholder="Add Filter…"
			aria-label="Add filter"
		/>
		<span
			class="shrink-0 text-center"
			style="width: 18px; height: 18.8px; padding: 2px; border-radius: 4px; border: 0.8px solid {menuMark
				.sep}; font-size: 12px; line-height: 14.8px; color: {menuMark.kbd}">F</span
		>
	</div>

	<!-- measured: the list insets 6px at the top and bottom of the 656px item stack -->
	<div style="padding: 6px 0" onmouseleave={release}>
		{#each filterIcons as icon, index (icon.label)}
			<div style="padding: 0 {ITEM_INSET}px">
				<div
					class="menu-item flex items-center"
					data-submenu-trigger={icon.submenu ? icon.label : undefined}
					style="{menuItemStyle}; padding: 0 12px 0 8px"
					onmouseenter={() => keep(icon.label)}
				>
					<span class="shrink-0 grid place-items-center" style="width: 16px; height: 16px">
						<svg
							width="16"
							height="16"
							viewBox={icon.viewBox}
							fill={menuMark.kbd}
							aria-hidden="true"
							role="img"
						>
							{@html icon.body}
						</svg>
					</span>
					<span class="min-w-0 flex-1 truncate">{icon.label}</span>
					{#if icon.submenu}
						<span
							class="shrink-0 grid place-items-center"
							style="width: 16px; height: 16px; font-size: 6px; color: {menuMark.arrow}">▶</span
						>
					{/if}
				</div>
			</div>
			{#if index === 0 || index === 1 || icon.label === "Dates" || icon.label === "Project properties"}
				<!-- measured: 12px block with a 0.8px hairline on its bottom edge -->
				<div style="height: 12px; padding: 6px 0">
					<div style="height: 0.8px; border-bottom: 0.8px solid {menuMark.sep}"></div>
				</div>
			{/if}
		{/each}
	</div>

	{#if hovered && filterSubmenus[hovered]}
		{@const sub = filterSubmenus[hovered]}
		<!-- Measured submenu: opens to the left, its box is 32px rows behind a 6px-inset hover pill.
		     Option rows carry a 16x14 select box 14px in and put their label at 60px; navigation rows
		     (Dates, Relations, Project properties) skip the box and put the label at 38px. -->
		<div
			class="absolute z-10 overflow-hidden"
			data-role="filter-submenu"
			data-submenu={hovered}
			style="{menuSurface}; top: {sub.top}px; right: {SUBMENU_RIGHT}; width: {sub.width}px; height: {sub
				.height}px"
			onmouseenter={() => keep(hovered!)}
			onmouseleave={release}
		>
			{#if sub.input}
				<!-- measured: the tall submenus carry the same 37px search row as the menu -->
				<div class="flex items-center" style="height: 37px; padding: 0 12px 0 14px">
					<input
						class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[color:var(--muted-foreground)]"
						style="font-size: 13px; line-height: 19.5px; padding: 10px 0 9px; color: {menuMark.text}"
						placeholder={sub.inputPlaceholder}
						aria-label={sub.inputPlaceholder}
					/>
				</div>
			{/if}
			<div style="padding: 6px 0">
				{#each sub.items as item, i (item.text + i)}
					<div style="padding: 0 {ITEM_INSET}px">
						<div
							class="menu-item flex items-center"
							style="height: 32px; padding: 0 12px 0 8px; font-size: 13px; line-height: 19.5px; font-weight: 450; color: {menuMark
								.text}; gap: 8px; position: relative"
						>
							{#if item.checkbox}
								<span
									class="grid shrink-0 place-items-center"
									style="width: 16px; height: 14px; margin-right: -2px"
								>
									<span
										style="width: 14px; height: 14px; border: 0.8px solid {menuMark.checkbox}; border-radius: 3px"
									></span>
								</span>
							{/if}
							{#if item.avatar}
								<span
									class="grid shrink-0 place-items-center rounded-full text-[9px] text-white"
									style="width: 16px; height: 16px; background: var(--board-avatar-user)"
									>{item.avatar}</span
								>
							{:else if item.icon}
								<span class="shrink-0 grid place-items-center" style="width: 16px; height: 16px">
									<svg width="16" height="16" viewBox="0 0 16 16" fill={menuMark.kbd} aria-hidden="true"
										>{@html item.icon}</svg
									>
								</span>
							{/if}
							<span
								class="min-w-0 flex-1 truncate"
								style="{item.color ? `color: ${item.color}` : ''}; {item.placeholder || item.empty
									? `color: ${menuMark.arrow}`
									: ''}"
								>{item.text}</span
							>
							{#if item.count}
								<span class="shrink-0" style="font-size: 12px; color: {menuMark.arrow}"
									>{item.count}</span
								>
							{/if}
							{#if item.arrow}
								<span
									class="shrink-0 grid place-items-center"
									style="width: 16px; height: 16px; font-size: 6px; color: {menuMark.arrow}">▶</span
								>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	/* Item rows are 32px (menuItemStyle); hovering paints the measured 248x32 pill at radius 8px
	   that the live menu insets 6px inside its 260px column. */
	.menu-item {
		--menu-item-hover: rgb(49, 50, 52);
		border-radius: var(--radius-sm);
	}

	.menu-item:hover {
		background: var(--menu-item-hover);
	}

	/* The menu runs the measured popover spring (see popover-motion.ts): the enter is a CSS
	   keyframe animation so it also plays on mount; the exit is the JS transition above. */
	.popover-surface {
		transform-origin: var(--popover-origin);
		opacity: var(--popover-rest-opacity);
		animation: pop-enter var(--popover-enter-ms) var(--popover-enter-ease) 0s 1 normal none running;
	}

	@keyframes pop-enter {
		from {
			opacity: 0;
			transform: scale(var(--popover-from-scale));
		}
		to {
			opacity: var(--popover-rest-opacity);
			transform: scale(1);
		}
	}
</style>
