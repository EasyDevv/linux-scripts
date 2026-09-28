# themes/toss/components

TDS Mobile(토스 디자인 시스템 모바일) 컴포넌트를 Svelte 5 프로젝트에 붙여 넣는 복사 스니펫 47개.
런타임 임포트 경로가 아니다. 필요한 파일을 앱으로 복사하고 `../layout.css`의 토큰과 함께 쓴다.

## 규칙

- **스타일은 scoped `<style>` + 토큰 변수**다. Tailwind 클래스를 쓰지 않으므로 어느 앱의 Tailwind 소스 설정과도
  무관하게 동작한다. 색·크기는 전부 `var(--…)`이고 hex/rgb 리터럴은 없다.
- **색은 역할 토큰부터** 읽는다: `--ink*`, `--surface-*`, `--status-*`. TDS 기본값이 특정 단계를 지목할 때만
  팔레트(`--grey-700`, `--blue-500`…)를 직접 쓴다. 팔레트는 adaptive라 `.dark`에서 알아서 바뀐다.
- **타입은 스케일 토큰**(`--text-t1…t7`, `--text-st1…st13`)과 두 예외 행간을 쓴다:
  버튼 라벨 `--control-label-leading`(×1.252), 리스트 텍스트 `--text-row*`(×1.35).
- 루트에는 TDS와 같은 `data-tds-mobile-component` 표식이 있다. 라이브 문서와 같은 셀렉터로 양쪽을 대조할 수 있다.
- variant는 `data-*` 속성 + CSS 속성 셀렉터로 푼다(스타일 객체 분기 없음).
- 오버레이(Dialog, Modal, BottomSheet, Toast, Tooltip)는 `inline` prop으로 열린 상태를 흐름 안에 그릴 수 있다
  (카탈로그·스크린샷용). 기본은 fixed + 딤.

## 목록

| file | TDS 라우트 | 실측 요약 |
| --- | --- | --- |
| `button.svelte` | Button | 32/38/48/56, r 8/10/14/16, px 10/16/16/28, 13/15/17/17 ×1.252 600; fill 자식 레이어; primary·dark·danger·light × fill·weak; loading 점 3개 |
| `text-button.svelte` | TextButton | 13·15·17 500 / 20 600 / 22·28 700, press dimmer inset·radius 크기별 |
| `icon-button.svelte` | IconButton | 48×48, pad 12, icon 24, r12; clear·fill·border |
| `badge.svelte` | Badge | 21/24/26/29 → r 9/11/12/13; 6색 × fill·weak(400 16%) |
| `checkbox.svelte` | Checkbox | 24, circle(22 원판)·line(체크만), gap 8, disabled .4 |
| `switch.svelte` | Switch | 50×30 r15, thumb 16 @7 / 24 @23, disabled .3 |
| `segmented-control.svelte` | SegmentedControl | 48 트랙 r14 pad 4 5, thumb r10 + 0 1px 2px .09, fixed·fluid |
| `tab.svelte` | Tab | large 47 / small 37, item pad 0 8, indicator 2px inset 10, redBean |
| `text-field.svelte` | TextField | box 55 (14 16, r14) · line 22/31/600 + 1.6px · big 30/40 · hero 30/40 무선; prefix·suffix·clear·right |
| `text-area.svelte` | TextArea | box 웰 상단 정렬, 고정 200 / 최소 100 |
| `split-text-field.svelte` | SplitTextField | box 2칸 + "-" gap 6 · line gap 12 |
| `search-field.svelte` | SearchField | bar 14 16 + 16 fade, well 44 r12 pad 8 10 |
| `numeric-spinner.svelte` | NumericSpinner | tiny 87×32 … large 153×58, 값 상자 흰색 |
| `slider.svelte` | Slider | 40 hit, 5px 트랙, 12px 안쪽 fill, 라벨·툴팁 |
| `rating.svelte` | Rating | 별 20/24/32/40, full·compact·iconOnly, readOnly 값 텍스트 |
| `list-row.svelte` | ListRow | pad 8/12/16/24 × 24, asset→12→texts→16→right, ×1.35 텍스트, indented divider |
| `list-row-asset.svelte` | ListRow.Asset* | 24/32/40, squircle·circle·card·original |
| `list-header.svelte` | ListHeader | pad 24 0 8, 13 설명 + 17/700 제목 + 오른쪽 텍스트·화살표 |
| `list-footer.svelte` | ListFooter | 59 (1px + 58), 17 ×1.252 500 blue500 |
| `board-row.svelte` | BoardRow | 헤더 56 pad 16 16 16 24, prefix, 파란 4% 내용 |
| `grid-list.svelte` | GridList | 1-3열 gap 8, 셀 r9 pad 12 8, 14/21/500 |
| `table-row.svelte` | TableRow | 42, 좌 grey700 / 우 grey900, 16/21.6 |
| `border.svelte` | Border | full · padding24 · height16 |
| `stepper.svelte` | Stepper | 74 행 pad 3 24, 30 번호 원판, 2px 연결선, A·B 텍스트 |
| `paragraph.svelte` | Paragraph | t1…st13 × regular…bold |
| `post.svelte` | Post | h1-h4 700 ×1.35, p 17/25.5, ol/ul 들여쓰기, hr |
| `top.svelte` | Top | pad 24/24, 제목 22/31 (28/37), 부제 17/500, right·upper·lower |
| `result.svelte` | Result | pad 32 40 40, figure 60 + 12, 17/600 + 15, 버튼 +16 |
| `asset.svelte` | Asset.Frame | square·rectangle·circle·card 프리셋, acc |
| `bubble.svelte` | Bubble | pad 12 14 r16, max 253, blue·grey, 13×17 꼬리 |
| `bottom-info.svelte` | BottomInfo | 회색 블록, 13/19.5 (28 행), 160 fade |
| `bar-chart.svelte` | BarChart | 205h, 막대 28 r7 radial, all-bar·single-bar·auto |
| `highlight.svelte` | Highlight | greyOpacity700 마스크 + 둥근 구멍 + 흰 메시지 |
| `agreement.svelte` | AgreementV4 | margin 4 20 0, 28 체크, xLarge·medium·medium-title·small, 필수·선택, badge·arrow |
| `dialog.svelte` | AlertDialog / ConfirmDialog | 320 r24, 20/27/700 + 15/22.5/500, TextButton 또는 48 버튼 2개 |
| `modal.svelte` | Modal | 320 r24 pad 32 20 20 |
| `bottom-sheet.svelte` | BottomSheet | 떠 있는 시트 inset 10, r28, grip 48×4 |
| `toast.svelte` | Toast | top pill 12 16 + shadow · bottom grey500 14 20 + 버튼 |
| `tooltip.svelte` | Tooltip | small 8 12 r12 · medium 13 16 r16 · large 16 20 |
| `menu.svelte` | Menu.Dropdown | 182 r20 glass, header 36, item 42 |
| `loader.svelte` | Loader | 48/60/80, stroke 6, primary·dark·light, label |
| `skeleton.svelte` | Skeleton | topList·topListWithIcon·custom 패턴 |
| `progress-bar.svelte` | ProgressBar | 2/5/8, blue400 |
| `progress-stepper.svelte` | ProgressStepper | compact 8px / icon 28px |
| `bottom-cta.svelte` | BottomCTA / FixedBottomCTA | 36 fade + pad 0 20 20, single·double(gap 8) |
| `number-keypad.svelte` | NumberKeypad / AlphabetKeypad | 66 행, 30/64 grey700 |
| `full-secure-keypad.svelte` | FullSecureKeypad | 항상 다크, 행마다 무작위 빈칸, 하단 56 |

전 라우트 대응. 제외: ListRowLegacy·AgreementV3(현행 ListRow·AgreementV4로 대체된 구 API).

## 다크 모드

**앱인토스는 다크 모드를 지원하지 않는다.** 미니앱은 라이트 모드로 디자인·개발·출시해야 하고(FAQ),
출시 검수 체크리스트에도 "미니앱 테마는 라이트 모드로 구현"이 있다. 스니펫은 `.dark`에서도 깨지지 않게
토큰으로 짰지만, 다크 값은 **비공식 참고값**이다. 실제 미니앱에는 라이트만 쓴다.

## 미실측 · 파생

- 라이브 문서가 `.light`로 고정돼 **다크 컴포넌트 렌더는 볼 수 없다**. 다크 값은 adaptive 쌍에서 온다.
  파생 보정 3가지: floating 그림자를 검정 계열로(`.dark --shadow-*`), dark 버튼 라벨을 `--surface-base`로,
  Highlight 마스크를 고정값(`--highlight-dim`)으로.
- Tooltip large는 문서 데모가 열리지 않아 medium 비율로 맞췄다(16 20, 17/25.5).
  SegmentedControl large는 실측하지 않았고 스니펫에도 없다(small만).
- 폰트: Toss Product Sans는 상용이라 Pretendard/시스템으로 대체된다. 글자 폭에 따라 정해지는 박스
  (NumericSpinner 값 상자, 배지 폭)는 1-3px 다를 수 있고, Bubble 높이는 라이브 폰트 메트릭 때문에 2px 낮다.
