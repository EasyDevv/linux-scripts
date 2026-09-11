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
export const panelStyle =
	"margin: var(--panel-inset) var(--panel-inset) var(--shell-footer-height) var(--panel-inset); border: var(--hairline-width) solid var(--border); box-shadow: var(--panel-shadow); border-radius: var(--radius); background: var(--card)";
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
	done: "var(--status-highlight)",
};
