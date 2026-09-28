# themes/toss/components

TDS Mobile (토스 디자인 시스템 모바일) 컴포넌트를 shadcn-svelte 프로젝트에 붙여 넣는 복사 스니펫.
런타임 임포트 경로가 아니다. 필요한 파일을 앱으로 복사하고 토큰(`layout.css`)과 함께 쓴다.

전부 `tossmini-docs.toss.im` 문서를 390px 뷰포트로 실측한 값만 사용했다. 수치는
`../SOURCE.md`의 "Measured control geometry" 표와 각 파일 헤더 주석에 있다.

| file | TDS 대응 | 실측 기준 |
| --- | --- | --- |
| `button.svelte` | Button | 32/38/48/56, r 8/10/14/16, px 10/16/16/28, label leading 1.252 |
| `text-button.svelte` | TextButton | 28h, r 8, press 36h r 9, 17/21.284/500 |
| `icon-button.svelte` | IconButton | 48x48 (50x50 bordered), pad 12, icon 24, r 12 |
| `badge.svelte` | Badge | 21/24/26/29 → r 9/11/12/13, pad 3px 7px (4px 8px large) |
| `checkbox.svelte` | Checkbox | 24x24, gap 8, circle/line + disabled |
| `switch.svelte` | Switch | 50x30 r 15, thumb 24/16 |
| `text-field.svelte` | TextField / SplitTextField | box 55h r 14, underline 1.6px, label/help 13/19.5 |
| `search-field.svelte` | SearchField | well 44h r 12, pad 8px 10px |
| `list-row.svelte` | ListRow | pad 12px 24px, hover r 12, gap 16, accessory 12 |
| `list-header.svelte` | ListHeader | pad 24px 0 8px, sub 13, title 20, accessory +24 |
| `list-footer.svelte` | ListFooter | row 58, 1px hairline, label 17/21.284/500 |
| `grid-list.svelte` | GridList | gap 8, cell r 9, pad 12px 8px, label 14/21/500 |
| `segmented-control.svelte` | SegmentedControl | track r 14, pad 4px 5px, radiogroup |
| `tab.svelte` | Tab | bar 47, item pad 0 8, indicator 2 + 10 |
| `stepper.svelte` | Stepper | row pad 3px 24px, icon 30/36, connector 2x32 |
| `board-row.svelte` | BoardRow | pad 16px 16px 16px 24px, hover r 12, chevron 24 |
| `bottom-cta.svelte` | BottomCTA | pad 0 20px 20px, 56h button |
| `bottom-sheet.svelte` | BottomSheet | pad 16, white surface, scrim rgba(0,0,0,.56) |
| `paragraph.svelte` | Paragraph | 17/25.5, display 30/40, link pad 0 4 / margin 0 -4 |
| `agreement-row.svelte` | Agreement | well r 12, row pad 10px 20px, toggle 28x28 r 6 |

미실측이라 스니펫이 없는 컴포넌트: Keypad, Chart, Top, Result, Rating, Bubble, Menu,
Toast, Tooltip, Slider, Progress, Skeleton, Loader, NumericSpinner, TableRow, Post,
Highlight, Border, Asset, Dialog. 라우트 전체 목록과 prop 표는 `../chrome.json`의
`pages`와 `SOURCE.md`의 "Not measured"를 본다.

## 측정 표식

각 스니펫의 루트에는 TDS 자신과 같은 `data-tds-mobile-component` 속성이 붙어 있다
(`Button`, `Badge`, `Switch`, `Checkbox`, `ListRow`, …). live 문서와 같은 이름이라
`collect-computed-styles.ts --xpath` 으로 양쪽 노드를 같은 셀렉터로 지정해
computed style을 직접 비교할 수 있다. `ref/components/page.svelte`가 이 표식을 쓴다.

## 포트 차이 (의도적으로 남긴 것)

- `checkbox.svelte` — TDS는 그래픽을 SVG로 그려 박스의 `border-radius`가 0이다.
  CSS 포트는 모양을 박스에 올리므로 `9999px`(circle) / `4px`(line)가 된다.
- `search-field.svelte` · `text-field.svelte`의 라벨 크기 — TDS 컴포넌트 기준 15/22.5
  (`--text-body-sm`). live 문서 페이지 본문이 16/24를 상속하므로 문서 맥락에서는 1px씩 다르다.
- 폰트는 Toss Product Sans가 상용이라 `Pretendard`로 대체된다. 그래서 같은 13px/700 배지가
  live 64px, draft 67.7px로 측정된다. 높이·padding·radius는 동일하다.
