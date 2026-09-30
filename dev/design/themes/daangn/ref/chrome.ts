/** Shared inline styles for the seed-design.io docs shell reconstruction.
 *
 *  Geometry is measured on the live docs at 1440x900 / dsf 1, light
 *  (ref/seed-design.io/desktop/action-button.png). The docs chrome is itself
 *  built from SEED tokens (ink gray-1000, idle gray-800, selected
 *  bg-transparent-selected, hairline stroke-neutral-muted), so it reads theme
 *  tokens; only the promo strip's lime ink is a docs mark.
 */

export const docsMark = {
	/** promo strip "우리는 왜 디자인 엔지니어를 찾게 됐을까" ink on the inverted strip */
	promoInk: "rgb(214, 245, 91)",
};

/** Header: 76 tall, full width above the rail; logo 16,18; centred nav links 16/24 pad 6 12 r8. */
export const HEADER_HEIGHT = 76;
export const headerStyle = `height: ${HEADER_HEIGHT}px; padding-inline: 16px`;
export const navLink =
	"display: inline-flex; align-items: center; height: 36px; padding: 6px 12px; border-radius: 8px; font-size: 16px; line-height: 24px; color: var(--fg-neutral)";
export const roundButton =
	"display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 9999px; background: var(--bg-transparent-selected); color: var(--fg-neutral)";

/** Rail: 240 wide under the header, 12px side inset; items 216x40 pad 0 8 r8 14/20;
 *  idle fg-neutral-muted, current bg-transparent-selected + fg-neutral; group label 12/16 pad 6 10 4. */
export const railItem =
	"display: flex; align-items: center; gap: 12px; height: 40px; padding: 0 8px; border-radius: 8px; font-size: 14px; line-height: 20px; text-decoration: none";
export const railIdle = `${railItem}; color: var(--fg-neutral-muted)`;
export const railCurrent = `${railItem}; color: var(--fg-neutral); background: var(--bg-transparent-selected)`;
export const railGroup = "padding: 6px 10px 4px; margin-top: 16px; font-size: 12px; line-height: 16px; color: var(--fg-neutral-subtle)";
export const versionButton =
	"display: flex; align-items: center; justify-content: space-between; width: 100%; height: 36px; padding: 8px 14px; border-radius: 8px; background: var(--bg-transparent-selected); font-size: 14px; line-height: 19px; font-weight: 500; color: var(--fg-neutral)";

/** Article: pad 56 32 24 (+10px prose margin) → 900 column at x 282; h1 60/66/500; lead 16/24/300 muted;
 *  h2 24/32/500 margin 48 0 24; TOC 200 wide at x 1225, title 12/16/300, items 12/20 pad-left 20. */
export const TOC_WIDTH = 200;
