/**
 * 컴포저 팝오버의 겉면·행 스타일이다.
 *
 * Linear 캡처에서 잰 값이라 토큰이 아니라 리터럴을 쓴다. 값은 `design.json`
 * `popovers.sharedChrome`과 `prop-picker.svelte`가 쓰는 것과 같다.
 *
 * 여기 담는 클래스는 tailwind가 이미 아는 것만 쓴다. 부르는 쪽 `<style>`에 새 유틸리티를 적는다.
 */

/** 팝오버 겉면. `width`와 `minWidth`(기본값은 `width`)는 부르는 쪽이 정한다. */
export function propMenuSurface(width: string, minWidth: string = width) {
	return `background: rgb(33, 33, 34); color: rgb(229, 230, 232); border: 0.8px solid rgb(50, 51, 54); border-radius: 12px; box-shadow: rgb(0 0 0 / 0.125) 0px 3px 8px 0px, rgb(0 0 0 / 0.125) 0px 2px 5px 0px, rgb(0 0 0 / 0.125) 0px 1px 1px 0px; padding: 0; font-size: 13px; width: ${width}; min-width: ${minWidth}`;
}

/** 목록 상자의 위아래 여백. 행 하이라이트가 상자 안쪽에 머물도록 한다. */
export const PROP_MENU_LIST_STYLE = "padding: 6px 0";

/** 목록 안의 행. 하이라이트는 `prop-menu.svelte`의 `::before`가 그린다. */
export const PROP_MENU_ITEM_CLASS =
	"prop-menu-item relative flex w-full items-center gap-2 rounded-none bg-transparent text-left text-[13px] font-[450] text-popover-foreground";
export const PROP_MENU_ITEM_STYLE =
	"height: 32px; padding: 0 18px 0 14px; margin: 0; border-radius: 0; position: relative";

/** 행 이름. 하이라이트 때 흰색이 되는 규칙이 이 클래스를 본다. */
export const PROP_MENU_LABEL_CLASS = "prop-menu-label min-w-0 flex-1 truncate";

/** 행 오른쪽의 `/별칭` 배지. */
export const PROP_MENU_BADGE_STYLE = "border: 0.8px solid rgb(41, 42, 45); font: 400 12px/13.2px var(--font-sans)";
