/** Shared inline styles for the TDS docs shell reconstruction.
 *
 *  Geometry here is measured on the live docs at 1440x900 / dsf 1
 *  (ref/tossmini-docs.toss.im). The colour marks are NOT theme tokens: the
 *  documentation site is Nextra, and its ink is not part of TDS. They stay
 *  literal here rather than being promoted into layout.css.
 */

/** Nextra docs ink (not TDS). Measured rgb() values, kept out of the token set. */
export const docsMark = {
	link: "light-dark(rgb(0, 123, 255), rgb(96, 165, 250))",
	headingInk: "light-dark(rgb(15, 23, 42), rgb(248, 250, 252))",
	bodyInk: "light-dark(rgb(51, 65, 85), rgb(203, 213, 225))",
	subtleInk: "light-dark(rgb(107, 114, 128), rgb(148, 163, 184))",
	codeBg: "light-dark(rgb(1, 22, 39), rgb(16, 16, 19))",
	codeInk: "rgb(214, 222, 235)",
	navBlur: "rgb(255 255 255 / 0.85)",
	rule: "var(--border)",
	inlineCodeBg: "light-dark(rgb(0 0 0 / 0.03), rgb(255 255 255 / 0.05))",
	inlineCodeRule: "light-dark(rgb(0 0 0 / 0.04), rgb(255 255 255 / 0.08))",
};
/** Nextra ink is measured on the light page only. The dark partner keeps the same
 *  role legible; it is not a TDS value and never becomes a theme token. */

/** Measured: nav 64px, 24px inline padding, 1px bottom rule. */
export const navRule = `height: 64px; padding-inline: 24px; border-bottom: 1px solid ${docsMark.rule}`;

/** Page column (doc.svelte): main 16px 48px 0 -> 832px content (--content-narrow), h1 36/54/700,
 *  h2 30/45/600 over a 0.8px rule, body 16/28, breadcrumb 14/21. Preview box (demo.svelte): r12,
 *  20px padding, 0.8px hairline — docs chrome, not TDS. */

/** Sidebar: 256px rail, white body, selected row is a blue-50 pill with blue700 ink. */
export const navItemStyle =
	"display: flex; align-items: center; height: 33px; padding-inline: 10px; border-radius: 6px; font-size: 14px; line-height: 21px";
export const navItemSelected = `${navItemStyle}; background: var(--surface-selected); color: var(--blue-700); font-weight: 500`;
export const navItemIdle = `${navItemStyle}; color: var(--grey-600)`;
export const navGroupStyle =
	"padding: 6px 10px 4px; font-size: 12px; line-height: 18px; font-weight: 600; color: var(--grey-500)";

/** Inset panel: floating white card on the grey canvas. */
export const panelStyle =
	"margin: var(--panel-inset) var(--panel-inset) var(--shell-footer-height) 0; border: var(--hairline-width) solid var(--border); border-radius: var(--radius); background: var(--card); overflow: hidden";
