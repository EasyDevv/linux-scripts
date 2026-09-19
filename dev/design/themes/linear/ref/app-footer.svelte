<script lang="ts">
	import ArrowUp from "@lucide/svelte/icons/arrow-up";
	import Box from "@lucide/svelte/icons/box";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import CircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
	import Copy from "@lucide/svelte/icons/copy";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import Maximize2 from "@lucide/svelte/icons/maximize-2";
	import Minus from "@lucide/svelte/icons/minus";
	import Paperclip from "@lucide/svelte/icons/paperclip";
	import Pencil from "@lucide/svelte/icons/pencil";
	import Search from "@lucide/svelte/icons/search";
	import ThumbsDown from "@lucide/svelte/icons/thumbs-down";
	import ThumbsUp from "@lucide/svelte/icons/thumbs-up";
	import Users from "@lucide/svelte/icons/users";
	import X from "@lucide/svelte/icons/x";
	import { agentGlyphPath, historyGlyphPaths } from "./agent-glyphs.ts";
	import { agentMark, menuMark } from "./chrome.ts";
	import { helpMenu } from "./menus.ts";
	import RefMenu from "./ref-menu.svelte";
	import {
		popoverEnterDuration,
		popoverEnterEasing,
		popoverOpacity,
		popoverOut,
		popoverScale,
	} from "./popover-motion.ts";

	type GreetingView = "closed" | "min" | "open";

	/** Two live surfaces: the chip opens the named chat; the Agent launcher opens a separate New chat. */
	let greeting = $state<GreetingView>("min");
	let agentOpen = $state(false);
	let draft = $state("");
	let hover = $state<"none" | "chip" | "agent" | "history" | "help">("none");

	function toggleGreeting() {
		if (greeting === "open") {
			greeting = "min";
			return;
		}
		agentOpen = false;
		greeting = "open";
	}

	function toggleAgent() {
		if (agentOpen) {
			agentOpen = false;
			return;
		}
		if (greeting === "open") greeting = "min";
		agentOpen = true;
	}

	const title = "Greeting from Lemon Blue";
	const stamp = "Today 오후 2:22";
	const thread = [
		{ kind: "user" as const, text: "hi" },
		{
			kind: "agent" as const,
			text: "Hi Lemon Blue — I can help with issues, projects, cycles, and workspace questions.",
		},
	];

	const chipStyle = $derived(
		`display: flex; align-items: center; box-sizing: border-box; max-width: ${agentMark.chip.maxWidth}; height: ${agentMark.chip.outerHeight}px; padding: 0 0 1px; border: 0; border-radius: ${agentMark.chip.radius}; font-size: ${agentMark.chip.font}; font-weight: ${agentMark.chip.weight}; line-height: normal; background: ${
			greeting === "open"
				? agentMark.chip.activeFill
				: hover === "chip"
					? agentMark.chip.hoverFill
					: agentMark.chip.idleFill
		}; color: ${
			greeting === "open"
				? agentMark.chip.activeInk
				: hover === "chip"
					? agentMark.chip.hoverInk
					: agentMark.chip.idleInk
		}; transition: ${agentMark.controlTransition}`,
	);

	const launcherStyle = $derived(
		`display: flex; align-items: center; justify-content: center; gap: ${agentMark.launcher.gap}px; box-sizing: border-box; height: ${agentMark.launcher.height}px; padding: ${agentMark.launcher.pad}; border: var(--hairline-width) solid transparent; border-radius: ${agentMark.launcher.radius}; white-space: nowrap; line-height: normal; background: ${
			agentOpen
				? agentMark.launcher.activeFill
				: hover === "agent"
					? agentMark.launcher.hoverFill
					: "transparent"
		}; color: ${
			agentOpen || hover === "agent"
				? agentMark.launcher.activeInk
				: agentMark.launcher.ink
		}; font-size: ${agentMark.launcher.font}; font-weight: ${agentMark.launcher.weight}; transition: ${agentMark.controlTransition}`,
	);

	const historyStyle = $derived(
		`display: flex; align-items: center; justify-content: center; box-sizing: border-box; width: ${agentMark.history.size}px; height: ${agentMark.history.size}px; padding: ${agentMark.history.pad}; border: var(--hairline-width) solid transparent; border-radius: ${agentMark.history.radius}; background: ${
			hover === "history" ? agentMark.history.hoverFill : "transparent"
		}; color: ${hover === "history" ? agentMark.history.hoverInk : agentMark.history.ink}; transition: ${agentMark.controlTransition}`,
	);

	const helpStyle = $derived(
		`display: grid; place-items: center; box-sizing: border-box; width: ${agentMark.footer.help.size}px; height: ${agentMark.footer.help.size}px; padding: ${agentMark.footer.help.pad}; border: var(--hairline-width) solid transparent; border-radius: ${agentMark.footer.help.radius}; background: ${
			hover === "help" ? agentMark.footer.help.hoverFill : "transparent"
		}; color: ${hover === "help" ? agentMark.footer.help.hoverInk : agentMark.footer.help.ink}; transition: ${agentMark.controlTransition}`,
	);
</script>

<div
	data-role="app-footer"
	class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-between"
	style="height: var(--shell-footer-height); padding: 0 {agentMark.footer.padRight}px"
>
	<RefMenu items={helpMenu} width={menuMark.widthHelp}>
		{#snippet trigger({ props })}
			<button
				{...props}
				type="button"
				aria-label="Open Help menu"
				class="pointer-events-auto"
				style={helpStyle}
				onmouseenter={() => (hover = "help")}
				onmouseleave={() => (hover = "none")}
			>
				<CircleQuestionMark size={agentMark.footer.help.glyph} />
			</button>
		{/snippet}
	</RefMenu>

	<div
		class="pointer-events-auto flex items-center"
		style="gap: {agentMark.footer.gap}px"
		data-role="agent-footer-cluster"
	>
		{#if greeting !== "closed"}
			<div
				class="agent-chip"
				style={chipStyle}
				role="button"
				tabindex="0"
				aria-label={title}
				onmouseenter={() => (hover = "chip")}
				onmouseleave={() => (hover = "none")}
				onclick={toggleGreeting}
				onkeydown={(e) => {
					if (e.key === "Enter" || e.key === " ") toggleGreeting();
				}}
			>
				<span
					class="flex min-w-0 items-center overflow-hidden"
					style="height: {agentMark.chip.innerHeight}px; padding: {agentMark.chip.pad}; gap: {agentMark.chip.gap}px"
				>
					<span
						class="min-w-0 overflow-hidden whitespace-nowrap"
						style="font-size: {agentMark.chip.font}; font-weight: {agentMark.chip.weight}; line-height: 15.2px"
					>
						{title}
					</span>
					<span
						class="agent-chip-close flex shrink-0 items-center justify-center"
						style="width: {agentMark.chip.close}px; height: {agentMark.chip.close}px"
						role="button"
						tabindex="0"
						aria-label="Close"
					onclick={(e) => {
						e.stopPropagation();
						greeting = "closed";
					}}
					onkeydown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							e.stopPropagation();
							greeting = "closed";
						}
					}}
				>
						<X size={agentMark.chip.closeGlyph} />
					</span>
				</span>
			</div>
		{/if}

		<button
			type="button"
			aria-label="Agent"
			style={launcherStyle}
			onmouseenter={() => (hover = "agent")}
			onmouseleave={() => (hover = "none")}
			onclick={toggleAgent}
		>
			<svg width={agentMark.launcher.glyph} height={agentMark.launcher.glyph} viewBox="0 0 16 16" aria-hidden="true">
				<path d={agentGlyphPath} fill="currentColor" />
			</svg>
			Agent
		</button>

		<button
			type="button"
			aria-label="Chat history"
			style={historyStyle}
			onmouseenter={() => (hover = "history")}
			onmouseleave={() => (hover = "none")}
		>
			<svg
				width={agentMark.history.glyph}
				height={agentMark.history.glyph}
				viewBox="0 0 16 16"
				aria-hidden="true"
			>
				{#each historyGlyphPaths as d (d)}
					<path {d} fill="currentColor" />
				{/each}
			</svg>
		</button>
	</div>
</div>

{#if greeting === "open"}
	<div
		data-role="greeting-panel"
		class="agent-panel pointer-events-auto absolute z-20 flex flex-col overflow-hidden"
		out:popoverOut
		style:--popover-origin="100% 100%"
		style:--popover-rest-opacity={`${popoverOpacity}`}
		style:--popover-from-scale={`${popoverScale}`}
		style:--popover-enter-ms={`${popoverEnterDuration}ms`}
		style:--popover-enter-ease={`${popoverEnterEasing}`}
		style="right: {agentMark.panel.insetRight}px; bottom: {agentMark.panel
			.insetBottom}px; width: {agentMark.panel.width}px; height: {agentMark.panel
			.height}px; box-sizing: border-box; background: {agentMark.panel
			.fill}; border: var(--hairline-width) solid {agentMark.panel.rim}; border-radius: {agentMark
			.panel.radius}; box-shadow: inset 0 0 0 var(--hairline-width) {agentMark.panel
			.ring}, {menuMark.shadow}; padding: 0"
	>
		<div
			class="flex shrink-0 items-center justify-between"
			style="height: {agentMark.header.height}px; padding: {agentMark.header.pad}"
		>
			<div class="flex min-w-0 items-center" style="gap: {agentMark.header.gap}px">
				<span
					class="truncate"
					style="padding-left: {agentMark.header
						.titlePadLeft}px; font-size: {agentMark.header.titleFont}; font-weight: {agentMark
						.header.titleWeight}; color: {agentMark.header.titleInk}"
				>
					{title}
				</span>
				<button type="button" aria-label="Chat options" class="agent-icon">
					<Ellipsis size={agentMark.header.glyph} />
				</button>
			</div>
			<div class="flex items-center" style="gap: {agentMark.header.gap}px">
				<button
					type="button"
					aria-label="Minimize chat"
					class="agent-icon"
					onclick={() => (greeting = "min")}
				>
					<Minus size={agentMark.header.glyph} />
				</button>
				<button type="button" aria-label="Open full page" class="agent-icon">
					<Maximize2 size={agentMark.header.glyph} />
				</button>
				<button
					type="button"
					aria-label="Close chat"
					class="agent-icon"
					onclick={() => (greeting = "closed")}
				>
					<X size={agentMark.header.glyph} />
				</button>
			</div>
		</div>

		<div
			class="min-h-0 flex-1 overflow-auto"
			style="padding: {agentMark.body.pad}"
			role="group"
			aria-label="Agent conversation"
		>
			<p
				class="text-center"
				style="font-size: {agentMark.body
					.stampFont}px; font-weight: {agentMark.body.stampWeight}; color: {agentMark.body.stampInk}"
			>
				{stamp}
			</p>
			{#each thread as turn, i (i)}
				{#if turn.kind === "user"}
					<div class="mt-4 flex justify-end">
						<div
							style="max-width: 80%; background: {agentMark.body
								.bubbleFill}; border-radius: {agentMark.body.bubbleRadius}; padding: {agentMark.body
								.bubblePad}; font-size: {agentMark.body.messageFont}; font-weight: {agentMark.body
								.messageWeight}; color: {agentMark.body.messageInk}"
						>
							{turn.text}
						</div>
					</div>
					<div class="mt-2 flex justify-end" style="gap: {agentMark.footer.gap}px">
						<button type="button" aria-label="Copy message" class="agent-action">
							<Copy size={agentMark.body.actionButton - 10} />
						</button>
						<button type="button" aria-label="Edit message" class="agent-action">
							<Pencil size={agentMark.body.actionButton - 10} />
						</button>
					</div>
				{:else}
					<p
						class="mt-2"
						style="font-size: {agentMark.body.messageFont}; font-weight: {agentMark.body
							.messageWeight}; color: {agentMark.body.messageInk}"
					>
						{turn.text}
					</p>
					<div class="mt-2 flex" style="gap: {agentMark.footer.gap}px">
						<button type="button" aria-label="This was helpful" class="agent-action">
							<ThumbsUp size={agentMark.body.actionButton - 10} />
						</button>
						<button type="button" aria-label="Leave feedback…" class="agent-action">
							<ThumbsDown size={agentMark.body.actionButton - 10} />
						</button>
						<button type="button" aria-label="Copy message" class="agent-action">
							<Copy size={agentMark.body.actionButton - 10} />
						</button>
					</div>
				{/if}
			{/each}
		</div>

		<div class="shrink-0" style="padding: {agentMark.composer.stripPad}">
			<div
				data-agent-panel-input-wrapper="true"
				style="padding: {agentMark.composer.wrapPad}; margin: {agentMark.composer
					.wrapMargin}; border-radius: {agentMark.composer.wrapRadius}"
			>
				<form
					class="flex"
					style="background: {agentMark.composer
						.fill}; border-radius: {agentMark.composer.radius}px; box-shadow: {agentMark.composer
						.shadow}; padding: {agentMark.composer.pad}"
					onsubmit={(e) => e.preventDefault()}
				>
					<div
						class="flex w-full flex-col"
						style="gap: {agentMark.composer.stackGap}px; align-items: flex-end"
					>
						<div class="w-full" style="padding: {agentMark.composer.editorRowPad}">
							<textarea
								bind:value={draft}
								spellcheck="true"
								role="textbox"
								aria-multiline="true"
								aria-readonly="false"
								aria-label="Send a message to Linear AI"
								translate="no"
								placeholder={agentMark.composer.placeholder}
								rows="1"
								class="composer-input w-full resize-none bg-transparent outline-none"
								style="padding: {agentMark.composer.editorPad}; min-height: {agentMark.composer
									.editorLine}; font-size: {agentMark.composer.editorFont}px; font-weight: {agentMark
									.composer.editorWeight}; line-height: {agentMark.composer
									.editorLine}; color: {agentMark.composer.editorInk}"
							></textarea>
						</div>
						<div
							class="flex w-full"
							style="height: 28px; padding: {agentMark.composer
								.toolbarPad}; gap: {agentMark.composer
								.toolbarGap}px; align-items: flex-end; justify-content: space-between"
						>
							<button
								type="button"
								aria-label="Skills"
								aria-haspopup="menu"
								class="flex items-center"
								style="gap: {agentMark.launcher.gap}px; height: {agentMark.composer
									.skills.height}px; padding: {agentMark.composer.skills.pad}; border-radius: {agentMark
									.composer.skills.radius}; font-size: {agentMark.composer.skills
									.font}; font-weight: {agentMark.composer.skills.weight}; color: {agentMark.composer
									.skills.ink}"
							>
								<Box size={agentMark.composer.skills.glyph} />
								Skills
								<ChevronDown size={agentMark.composer.skills.glyph - 4} />
							</button>
							<div class="flex items-center" style="gap: {agentMark.composer.toolbarGap}px">
						<button
							type="button"
							aria-label="Attach images, files, or videos"
							class="flex items-center justify-center"
							style="width: {agentMark.composer
								.action.size}px; height: {agentMark.composer
								.action.size}px; padding: {agentMark.composer.action
								.pad}; border-radius: {agentMark.composer.action.radius}; color: {agentMark
								.composer.action.ink}"
						>
							<Paperclip size={agentMark.composer.action.size - 10} />
						</button>
						<button
							type="submit"
							aria-label="Send message"
							class="flex items-center justify-center"
							style="width: {agentMark.composer
								.send.size}px; height: {agentMark.composer
								.send.size}px; border-radius: {agentMark.composer.send
								.radius}; background: {agentMark.composer.send.fill}; color: {agentMark.composer
								.send.ink}"
						>
							<ArrowUp size={agentMark.composer.send.size - 10} />
						</button>
						</div>
						</div>
					</div>
				</form>
			</div>
		</div>
	</div>
{/if}

{#if agentOpen}
	<div
		data-role="agent-panel"
		class="agent-panel pointer-events-auto absolute z-20 flex flex-col overflow-hidden"
		out:popoverOut
		style:--popover-origin="100% 100%"
		style:--popover-rest-opacity={`${popoverOpacity}`}
		style:--popover-from-scale={`${popoverScale}`}
		style:--popover-enter-ms={`${popoverEnterDuration}ms`}
		style:--popover-enter-ease={`${popoverEnterEasing}`}
		style="right: {agentMark.panel.insetRight}px; bottom: {agentMark.panel
			.insetBottom}px; width: {agentMark.panel.width}px; height: {agentMark.panel
			.height}px; box-sizing: border-box; background: {agentMark.panel
			.fill}; border: var(--hairline-width) solid {agentMark.panel.rim}; border-radius: {agentMark
			.panel.radius}; box-shadow: inset 0 0 0 var(--hairline-width) {agentMark.panel
			.ring}, {menuMark.shadow}; padding: 0"
	>
		<div
			class="flex shrink-0 items-center justify-between"
			style="height: {agentMark.header.height}px; padding: {agentMark.header.pad}"
		>
			<span
				class="truncate"
				style="padding-left: {agentMark.header
					.titlePadLeft}px; font-size: {agentMark.header.titleFont}; font-weight: {agentMark.header
					.titleWeight}; color: {agentMark.header.titleInk}"
			>
				New chat
			</span>
			<div class="flex items-center" style="gap: {agentMark.header.gap}px">
				<button
					type="button"
					aria-label="Minimize chat"
					class="agent-icon"
					onclick={() => (agentOpen = false)}
				>
					<Minus size={agentMark.header.glyph} />
				</button>
				<button type="button" aria-label="Open full page" class="agent-icon">
					<Maximize2 size={agentMark.header.glyph} />
				</button>
				<button
					type="button"
					aria-label="Close chat"
					class="agent-icon"
					onclick={() => (agentOpen = false)}
				>
					<X size={agentMark.header.glyph} />
				</button>
			</div>
		</div>

		<div class="min-h-0 flex-1 overflow-auto px-4 pt-8">
			<p
				class="text-center"
				style="font-size: {agentMark.header.titleFont}; font-weight: {agentMark.header
					.titleWeight}; color: {agentMark.header.titleInk}"
			>
				Welcome to Linear
			</p>
			<p
				class="mt-1 text-center"
				style="font-size: {agentMark.body.messageFont}; color: {agentMark.body.stampInk}"
			>
				Ask anything or tell Linear what you need
			</p>
			<div class="mt-6 flex flex-col items-center" style="gap: 8px">
				<button type="button" class="agent-prompt">
					<Box size={14} />
					Create a new project
				</button>
				<button type="button" class="agent-prompt">
					<Search size={14} />
					Research a topic
				</button>
				<button type="button" class="agent-prompt">
					<Users size={14} />
					Set up new team
				</button>
			</div>
		</div>

		<div class="shrink-0" style="padding: {agentMark.composer.stripPad}">
			<div
				data-agent-panel-input-wrapper="true"
				style="padding: {agentMark.composer.wrapPad}; margin: {agentMark.composer
					.wrapMargin}; border-radius: {agentMark.composer.wrapRadius}"
			>
				<form
					class="flex"
					style="background: {agentMark.composer
						.fill}; border-radius: {agentMark.composer.radius}px; box-shadow: {agentMark.composer
						.shadow}; padding: {agentMark.composer.pad}"
					onsubmit={(e) => e.preventDefault()}
				>
					<div
						class="flex w-full flex-col"
						style="gap: {agentMark.composer.stackGap}px; align-items: flex-end"
					>
						<div class="w-full" style="padding: {agentMark.composer.editorRowPad}">
							<textarea
								spellcheck="true"
								role="textbox"
								aria-multiline="true"
								aria-readonly="false"
								aria-label="Send a message to Linear AI"
								translate="no"
								placeholder={agentMark.composer.agentPlaceholder}
								rows="1"
								class="composer-input w-full resize-none bg-transparent outline-none"
								style="padding: {agentMark.composer.editorPad}; min-height: {agentMark.composer
									.editorLine}; font-size: {agentMark.composer.editorFont}px; font-weight: {agentMark
									.composer.editorWeight}; line-height: {agentMark.composer
									.editorLine}; color: {agentMark.composer.editorInk}"
							></textarea>
						</div>
						<div
							class="flex w-full"
							style="height: 28px; padding: {agentMark.composer
								.toolbarPad}; gap: {agentMark.composer
								.toolbarGap}px; align-items: flex-end; justify-content: space-between"
						>
							<button
								type="button"
								aria-label="Skills"
								aria-haspopup="menu"
								class="flex items-center"
								style="gap: {agentMark.launcher.gap}px; height: {agentMark.composer
									.skills.height}px; padding: {agentMark.composer.skills.pad}; border-radius: {agentMark
									.composer.skills.radius}; font-size: {agentMark.composer.skills
									.font}; font-weight: {agentMark.composer.skills.weight}; color: {agentMark.composer
									.skills.ink}"
							>
								<Box size={agentMark.composer.skills.glyph} />
								Skills
								<ChevronDown size={agentMark.composer.skills.glyph - 4} />
							</button>
							<div class="flex items-center" style="gap: {agentMark.composer.toolbarGap}px">
								<button
									type="button"
									aria-label="Attach images, files, or videos"
									class="flex items-center justify-center"
									style="width: {agentMark.composer.action.size}px; height: {agentMark.composer.action
										.size}px; padding: {agentMark.composer.action.pad}; border-radius: {agentMark
										.composer.action.radius}; color: {agentMark.composer.action.ink}"
								>
									<Paperclip size={agentMark.composer.action.size - 10} />
								</button>
								<button
									type="submit"
									aria-label="Send message"
									class="flex items-center justify-center"
									style="width: {agentMark.composer.send.size}px; height: {agentMark.composer.send
										.size}px; border-radius: {agentMark.composer.send.radius}; background: {agentMark
										.composer.send.fill}; color: {agentMark.composer.send.ink}"
								>
									<ArrowUp size={agentMark.composer.send.size - 10} />
								</button>
							</div>
						</div>
					</div>
				</form>
			</div>
		</div>
	</div>
{/if}

<style>
	/* The live surface scales 0.98 → 1 from the footer chip's corner while opacity → 2 (the spring
	   overshoots 1, so the fade reads fast). Exit is the measured curve in popover-motion.ts. */
	.agent-panel {
		transform-origin: var(--popover-origin);
		opacity: var(--popover-rest-opacity);
		animation: agent-pop-enter var(--popover-enter-ms) var(--popover-enter-ease) 0s 1 normal none
			running;
	}

	/* Header controls and message actions: circular chrome icons, ink only. */
	.agent-icon,
	.agent-action {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0 2px;
		border-radius: var(--radius-pill);
		color: var(--ink-soft);
		transition: background-color 0.15s, color 0.15s;
	}

	.agent-action {
		width: 24px;
		height: 24px;
	}

	.agent-icon:hover,
	.agent-action:hover {
		background: rgb(24, 24, 26);
		color: var(--foreground);
	}

	.agent-chip {
		cursor: default;
	}

	.agent-chip-close {
		visibility: hidden;
	}

	.agent-chip:hover .agent-chip-close,
	.agent-chip:focus-within .agent-chip-close {
		visibility: visible;
	}

	.agent-chip svg,
	[data-role="agent-footer-cluster"] button svg {
		display: block;
		flex-shrink: 0;
	}

	.composer-input::placeholder {
		color: rgb(92, 93, 95);
		font-weight: 450;
		opacity: 1;
	}

	.agent-prompt {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 12px;
		border-radius: var(--radius-sm);
		border: var(--hairline-width) solid var(--accent);
		font-size: var(--text-label-sm);
		font-weight: 500;
		color: var(--foreground);
		background: transparent;
	}

	@keyframes agent-pop-enter {
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
