export const navStyle = "font-size: var(--text-heading-sm)";
export const titleStyle = "font-size: var(--text-heading-sm)";
export const sectionStyle =
	"font-size: var(--text-heading-sm); font-weight: 500; color: var(--muted-foreground)";
/** Linear aside section row: 16px content, 28px hit targets overflowing. */
export const sectionHeadStyle =
	"display: flex; align-items: center; justify-content: space-between; height: 16px; padding: 0; gap: 0; overflow: visible; border-radius: 0";
export const sectionTriggerStyle =
	"display: flex; align-items: center; gap: 6px; width: 100%; height: 28px; padding: 0 8px; margin: 0 0 0 -8px; border-radius: 8px; font-size: var(--text-heading-sm); font-weight: 500; line-height: 16px; color: var(--muted-foreground)";
export const sectionIconStyle =
	"width: 28px; height: 28px; padding: 0; border-radius: 9999px; color: var(--muted-foreground)";
export const sectionBodyStyle =
	"display: grid; gap: 0; min-width: 0; padding: 12px 0 0";
export const propRowStyle =
	"display: flex; align-items: center; height: 28px; gap: 12px";
export const propLabelStyle =
	"width: 80px; flex-shrink: 0; font-size: var(--text-heading-sm); font-weight: 500; color: var(--muted-foreground)";
export const propFilledStyle =
	"display: flex; align-items: center; gap: 6px; font-size: var(--text-heading-sm); font-weight: 500; color: var(--ink-soft)";
export const propEmptyStyle =
	"display: flex; align-items: center; gap: 6px; font-size: var(--text-heading-sm); font-weight: 500; color: var(--muted-foreground)";
export const metaStyle = "font-size: var(--text-body-sm); font-weight: 450";
export const tabOn =
	"height: var(--control-height-nav); border-radius: var(--radius-pill); font-size: var(--text-label-sm); background: var(--tab-selected); color: var(--foreground)";
export const tabOff =
	"height: var(--control-height-nav); border-radius: var(--radius-pill); font-size: var(--text-label-sm); background: var(--tab-idle); color: var(--muted-foreground)";
export const inspectorStyle =
	"background: var(--inspector); border: var(--hairline-width) solid var(--inspector-border); border-radius: var(--radius-md); box-shadow: var(--panel-shadow); padding: 12px";
/** Measured from all three desktop captures: the main pane is flush with the 244px rail (no left gutter). */
export const panelStyle =
	"margin: var(--panel-inset) var(--panel-inset) var(--shell-footer-height) 0; border: var(--hairline-width) solid var(--border); box-shadow: var(--panel-shadow); border-radius: var(--radius); background: var(--card)";
export const headerRule = "border-bottom: var(--hairline-width) solid var(--border)";
export const iconChrome =
	"height: var(--control-height-nav); width: var(--control-height-nav); border-radius: var(--radius-pill); border: var(--hairline-width) solid color-mix(in srgb, var(--foreground) 12%, transparent)";

/** Measured from linear.app overview menus (role=dialog around listbox). */
export const menuMark = {
	bg: "rgb(33, 33, 34)",
	border: "rgb(50, 51, 54)",
	text: "rgb(229, 230, 232)",
	hover: "rgb(49, 50, 52)",
	sep: "rgb(41, 42, 45)",
	kbd: "rgb(156, 157, 159)",
	/* the 6px "▶" submenu marker, the 12px item counts and the 14x14 select box ink
	   (live: lch(41.778 1.425 272) / lch(55.92 1.93 272)) */
	arrow: "rgb(98, 99, 101)",
	checkbox: "rgb(133, 134, 137)",
	caret: "rgb(94, 106, 210)",
	radius: "12px",
	radiusTight: "8px",
	width: "260px",
	widthHelp: "384px",
	widthNotify: "335px",
	widthStatus: "307px",
	widthWorkspace: "230px",
	shadow:
		"rgb(0 0 0 / 0.125) 0px 3px 8px 0px, rgb(0 0 0 / 0.125) 0px 2px 5px 0px, rgb(0 0 0 / 0.125) 0px 1px 1px 0px",
};

export const menuSurface =
	`background: ${menuMark.bg}; color: ${menuMark.text}; border: 0.8px solid ${menuMark.border}; border-radius: ${menuMark.radius}; box-shadow: ${menuMark.shadow}; padding: 0; font-size: 13px; line-height: 19.5px; font-weight: 400`;

export const menuItemStyle =
	"height: 32px; padding: 0 18px 0 14px; margin: 0; border-radius: 0; font-size: 13px; line-height: 19.5px; font-weight: 450; color: rgb(229, 230, 232); gap: 8px; position: relative";

/** Measured from linear.app desktop captures, not theme tokens. */
export const mark = {
	workspace: "rgb(197, 171, 95)",
	team: "var(--status-info)",
	ok: "rgb(61, 173, 81)",
	progress: "rgb(233, 186, 1)",
	backlog: "rgb(231, 146, 71)",
	/** team-all Done glyph is Linear indigo, not --status-highlight (that is a project status). */
	done: "rgb(94, 106, 210)",
	/** team-all Canceled glyph: filled --status-neutral disc with a dark x. */
	canceled: "var(--status-neutral)",
	/** team-all Todo ring reads rgb(220, 220, 220), not --muted-foreground. */
	todo: "color-mix(in srgb, var(--foreground) 84%, transparent)",
	/** Backlog dashed ring (live board SVG stroke). */
	backlog: "rgb(190, 194, 200)",
};

/** Issue status tones drawn by status-glyph.svelte (board + list). */
export type BoardTone = "backlog" | "todo" | "progress" | "done" | "canceled" | "duplicate";

/**
 * Board view, measured from ref/linear.app/desktop/team-board.png and the live DOM
 * (`#routeContentContainer` board scroller, 2026-09-14). Column cells are 348px wide with no gap:
 * 4px row padding + 5 columns + a 350px "Hidden columns" slot = 2098px scrollWidth in a 1186px viewport.
 */
export const boardMark = {
	columnWidth: 348,
	rowPadLeft: 4,
	headHeight: 50,
	/** Header band: inset 4px per side, 46px tall, top corners only (tab shape above the column). */
	bandInset: 4,
	bandHeight: 46,
	bandRadius: "5px 5px 0 0",
	bandFill: "var(--board-band)",
	headPad: "2px 12px 0 18px",
	headGap: 12,
	headIconGap: 8,
	headButton: 24,
	headButtonGap: 2,
	bodyHeight: 694,
	bodyPad: "1px 0 0 12px",
	cardWidth: 319,
	cardHeight: 117,
	cardRadius: 8,
	cardPad: 8,
	cardFill: "var(--board-card)",
	/** live card box-shadow: lch(100 0 0 / 0.048) 0 0 0 1px */
	cardRing: "0 0 0 1px var(--board-card-ring)",
	cardItemPad: "0 1px 8px",
	/** id 15.2 + 6 gap + title 16 = 37.2; then 10 to the chip row, 6 to the footer row. */
	titleRowHeight: 37,
	titleGap: 6,
	chipsTop: 10,
	chipsBottom: 6,
	chipsGap: 4,
	chipHeight: 24,
	chipPadIcon: "0 4.5px",
	chipPadLabel: "0 8px",
	chipBorder: "var(--hairline-width) solid var(--board-chip-border)",
	chipIcon: 14,
	labelDot: 9,
	progressRingTrack: "rgb(43, 44, 46)",
	avatar: 18,
	priorityIcon: 16,
	addHeight: 28,
	addPad: "6px 8px",
	addFill: "var(--board-add)",
	addBorder: "var(--hairline-width) solid var(--board-add-border)",
	/** Trailing "Hidden columns" rail (header 50px + collapsed column tab 38px). */
	hiddenWidth: 350,
	hiddenPad: "0 12px 0 0",
	hiddenRowHeight: 38,
	/** SVG stroke/fill inks read from the live board DOM. */
	statusInk: {
		backlog: "rgb(190, 194, 200)",
		todo: "rgb(226, 226, 226)",
		progress: "rgb(240, 191, 0)",
		done: "rgb(94, 106, 210)",
		canceled: "var(--status-neutral)",
		duplicate: "var(--status-neutral)",
	} as Record<BoardTone, string>,
};

/** team-all list rhythm, measured from ref/linear.app/desktop/team-all.png. */
export const listMark = {
	rowHeight: 44,
	groupHeight: 36,
	rowGap: 2,
	groupBar: "var(--list-group-fill)",
	rowFill: "var(--list-row-fill)",
	rowInset: "var(--list-row-hover-inset)",
	/** 8 indent | 18 checkbox | 16 priority | 42 identifier | 16 status | title | 16 avatar | 60 date | 18 end */
	rowGrid: "8px 18px 16px 42px 16px minmax(0, 1fr) 16px 60px 18px",
	rowGapPx: 8,
	identifierWidth: "42px",
	dateWidth: "60px",
	chevronInk: "color-mix(in srgb, var(--muted-foreground) 28%, transparent)",
};

/**
 * List row priority cell + its "Change priority" menu, measured from the live team-all list
 * (`/easydevs/team/EAS/all`, CDP 9201, 2026-09-14): the 16px grid column is a 16x36 trigger in the
 * row ink rgb(149,149,151); the row's muted glyphs brighten to #fff on row hover (the svg keeps its
 * muted fill attribute, so the live paint is a CSS override, not a per-priority colour).
 * The menu reuses `menuMark` (surface, 12px radius, 0.8px rgb(50,51,54) border, 260px row width,
 * 32px rows, 6px-inset rgb(49,50,52) pill, 37px search row, 8px-inset 18x18.8 "P" chip): measured box
 * 261.6x211 at (287, 178) = the cell's left edge, 4px under the row, 36.8px search row + 6px-inset
 * list of 5 rows. Option icons paint `menuMark.kbd` and follow the row to #fff when it is highlighted.
 */
export const priorityMark = {
	cell: {
		width: 16,
		height: 36,
		icon: 16,
		ink: "rgb(149, 149, 151)",
		hoverInk: "rgb(255, 255, 255)",
	},
	menu: {
		search: "Change priority to…",
		searchKbd: "P",
		iconInk: "muted" as const,
	},
};

/** Issue detail rail, measured from the live issue screen (linear.app/easydevs/issue/EAS-5/test). */
export const railMark = {
	width: "376px",
	rowHeight: 28,
	rowGap: 4,
	sectionGap: 20,
	chipHeight: 25,
	chipBorder: "var(--hairline-width) solid var(--inspector-border)",
};

/** Display options popover, measured from the live issues toolbar (view=team EAS all). */
export const displayMark = {
	width: "302px",
	rowHeight: 32,
	valueChip: "rgb(44, 44, 45)",
	valueChipText: "rgb(200, 201, 203)",
	segmentOn: "rgb(57, 58, 60)",
	segmentOff: "rgb(44, 44, 45)",
	chipOn: "rgb(61, 62, 64)",
	chipOff: "rgb(44, 44, 45)",
	toggleOn: "var(--primary)",
	toggleOff: "rgb(114, 115, 116)",
	toggleKnob: "rgb(255, 254, 255)",
	sectionLabel: "rgb(200, 201, 203)",
};

/**
 * Agent chat, measured from the live app (linear.app/easydevs/{agent,projects/all,team/EAS/all},
 * CDP 9201 2026-09-14, viewport 1440x900 dark).
 *
 * The footer strip carries three controls, left to right inside its right cluster (2px gaps,
 * 10px from the window edge): the minimized-chat chip, the `Agent` launcher and `Chat history`.
 * Chip and launcher are both 8px-radius controls that read differently on purpose: the chip is a
 * filled surface once its chat is open (and stays flat/muted while minimized), the launcher is a
 * chromeless icon+label that only gets a fill on hover.
 *
 * Panel tone relation (the point of the composition): the floating panel's 0.8px rim is the same
 * tone as the chip's active fill — rgb(35,36,38) vs rgb(35,35,37), i.e. `--accent`. The panel body
 * is one step darker, `--secondary` rgb(26,26,27), inside a 0.8px ring of `--background`.
 */
export const agentMark = {
	/** Floating panel: 400x600, opened 32px from the window's right edge and 34px off the bottom. */
	panel: {
		width: 400,
		height: 600,
		radius: "12px 12px 16px 16px",
		fill: "var(--secondary)",
		/** 0.8px inner ring of the canvas tone between the rim and the body. */
		ring: "var(--background)",
		/** measured rgb(35, 36, 38) — the same tone as the chip's active fill (`--accent`). */
		rim: "var(--accent)",
		insetRight: 32,
		insetBottom: 34,
	},
	header: {
		height: 48,
		pad: "0 6px 0 10px",
		titleFont: "var(--text-heading-sm)",
		titleWeight: 500,
		titleInk: "var(--foreground)",
		titlePadLeft: 6,
		button: 28,
		/** header controls are circular; the footer controls are 8px radius. */
		buttonRadius: "var(--radius-pill)",
		buttonPad: "0 2px",
		glyph: 14,
		glyphInk: "var(--ink-soft)",
		gap: 2,
	},
	body: {
		pad: "24px 16px 32px",
		stampFont: 12,
		stampWeight: 500,
		/** measured rgb(92, 93, 95) */
		stampInk: "rgb(92, 93, 95)",
		messageFont: "var(--text-heading-sm)",
		messageWeight: 450,
		messageInk: "var(--accent-foreground)",
		/** user turn: right-aligned filled bubble, measured rgb(35, 35, 37) / radius 8 / pad 8px 12px. */
		bubbleFill: "var(--accent)",
		bubbleRadius: "var(--radius-sm)",
		bubblePad: "8px 12px",
		actionButton: 24,
		actionRadius: "var(--radius-pill)",
	},
	composer: {
		/** live strip around the input: pad 0 8px 8px on the 398.4 panel inner. */
		stripPad: "0 8px 8px",
		/** data-agent-panel-input-wrapper: pad 4, margin 0 -4px -4px, radius 8. */
		wrapPad: "4px",
		wrapMargin: "0 -4px -4px",
		wrapRadius: "8px",
		pad: "6px 4px",
		fill: "var(--accent)",
		radius: 7,
		shadow: "lch(0 0 0 / 0.3) 0px 0.5px 1px 1px",
		stackGap: 8,
		editorRowPad: "2px 6px",
		toolbarPad: "0 6px 4px 2px",
		toolbarGap: 8,
		editorFont: 13,
		editorWeight: 450,
		editorLine: "20.8px",
		editorPad: "0",
		editorInk: "var(--accent-foreground)",
		/** live ::before on empty ProseMirror: lch(41.928 1.65 272) */
		placeholderInk: "rgb(92, 93, 95)",
		placeholder: "Reply…",
		agentPlaceholder: "@ to mention any issue, project, or document",
		skills: {
			height: 24,
			radius: "var(--radius-pill)",
			pad: "0 6px 0 4px",
			font: "var(--text-label-sm)",
			weight: 500,
			/** measured rgb(156, 157, 160) */
			ink: "rgb(156, 157, 160)",
			glyph: 14,
		},
		action: {
			size: 24,
			radius: "var(--radius-pill)",
			pad: "0 2px",
			ink: "var(--ink-soft)",
		},
		/** send is the only filled circle in the composer: measured rgb(42, 43, 45), radius 12. */
		send: {
			size: 24,
			radius: "var(--radius)",
			fill: "rgb(42, 43, 45)",
			ink: "var(--ink-soft)",
		},
	},
	footer: {
		gap: 2,
		padRight: 10,
		padLeft: 10,
		height: 28,
		/** left corner of the footer row (sidebar side), not part of the right cluster. */
		help: {
			size: 24,
			radius: "50%",
			pad: "0 2px",
			glyph: 14,
			ink: "var(--ink-soft)",
			hoverFill: "rgb(27, 28, 29)",
			hoverInk: "var(--foreground)",
		},
	},
	/** Minimized/active chat chip: 173.2x28 wrapper (inner 27px + 1px bottom pad), radius 8. */
	chip: {
		maxWidth: "240px",
		outerHeight: 28,
		innerHeight: 27,
		radius: "var(--radius-sm)",
		pad: "0 8px",
		gap: 5,
		labelPadRight: 8,
		closeTop: 6,
		closeRight: 4,
		font: "var(--text-label-sm)",
		weight: 450,
		/** minimized: no fill, muted label; a hover only lifts the label ink. */
		idleFill: "transparent",
		idleInk: "var(--muted-foreground)",
		hoverFill: "rgb(24, 24, 26)",
		hoverInk: "var(--foreground)",
		/** open: filled with the same tone as the panel rim. */
		activeFill: "var(--accent)",
		activeInk: "var(--foreground)",
		close: 16,
		closeGlyph: 12,
	},
	/** `Agent` launcher: 77.5x28, radius 8 (not a pill), label 12/500, muted until hovered. */
	launcher: {
		height: 28,
		radius: "var(--radius-sm)",
		pad: "0 12px 0 10px",
		gap: 6,
		font: "var(--text-label-sm)",
		weight: 500,
		ink: "var(--muted-foreground)",
		hoverFill: "rgb(24, 24, 26)",
		hoverInk: "var(--foreground)",
		activeFill: "rgb(24, 24, 26)",
		activeInk: "var(--foreground)",
		glyph: 14,
	},
	/** `Chat history`: 28x28 radius 8 icon disc; its glyph reads brighter than the launcher label. */
	history: {
		size: 28,
		radius: "var(--radius-sm)",
		pad: "0 2px",
		glyph: 14,
		ink: "var(--ink-soft)",
		hoverFill: "rgb(27, 28, 29)",
		hoverInk: "var(--foreground)",
	},
	/** live control transition: border 0.15s, background-color 0.15s, color 0.15s, opacity 0.15s */
	controlTransition:
		"border 0.15s, background-color 0.15s, color 0.15s, opacity 0.15s",
};
