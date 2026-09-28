# toss 테마 구축 보고서 (TDS Mobile → design store)

> 작성일: 2026-09-28 (260928)
> 원본: `https://tossmini-docs.toss.im/tds-mobile/` — 토스 디자인 시스템 모바일 문서
> 산출물: `~/.local/share/scripts/dev/design/themes/toss/`
> 참조 저장소: `~/.local/share/scripts/dev/design/ref/tossmini-docs.toss.im/`
> 상태: 완료. 게이트 전부 통과. live 셸 적용은 하지 않음.
> 후속: [260929-toss-components.md](260929-toss-components.md) — 토큰 재구성, 47개 컴포넌트 전수, 이 문서의 greyOpacity·dim 표 오류 정정, 빌드 스크립트 이전(`/tmp` → `themes/toss/.build/`).

## 결론 (TL;DR)

TDS Mobile 문서 67개 라우트를 전수로 목록화하고, 19개 대표 페이지를 실측해
`themes/toss/` 테마를 만들었다. 토큰·스니펫·ref 재현 페이지까지 포함한다.

- **색** — grey/blue/red/orange/yellow/green/teal/purple 50~900, greyOpacity 50~900(라이트/다크 쌍),
  adaptive surface 전량. 다크에서 grey 램프와 모든 hue가 뒤집히는 것을 확인해 두 번째 `.dark` 블록에 실측값 반영.
- **타이포** — raw scale `f11…f42` + 의미 별칭 `t1…t7` / `st1…st13` 해석 완료.
  버튼 레이블은 스케일 line height가 아니라 `fontSize × 1.252`라 별도 토큰으로 분리.
- **기하** — 20개 컴포넌트의 상자 수치를 실측하고 토큰 + 스니펫으로 옮김.
  헤어라인 0.8px, 버튼 fill이 자식 div라는 구조까지 반영.
- **검증** — 게이트 4종 통과, ref 3페이지 light/dark 모두 `ok: true`.
  라이브와 computed style 대조에서 padding·radius·font-size·line-height·weight·색·높이는 전부 일치.

## 1. 조사 방법

문서가 각 페이지에 TDS 토큰과 `data-tds-mobile-component` 표식을 그대로 노출한다는 점을 이용했다.
Nextra 문서이므로 SSR HTML에는 일부 컴포넌트만 있고, 나머지는 클라이언트 렌더다.

| 단계 | 방법 |
| --- | --- |
| 라우트 수집 | 문서 내비게이션 href 수집 → 67개 (정규화, dedupe) |
| 토큰 해석 | 페이지 HTML의 `--tds-t-*` 정의 + 브라우저에서 `getComputedStyle`로 **해소된** `--adaptive*` 값 |
| 구성 수집 | 67개 라우트 전부 브라우저에서 순회, `.preview` 예제 블록과 `[data-tds-mobile-component]` 노드의 자손 트리를 depth 4로 덤프 |
| 실측 | `Emulation.setDeviceMetricsOverride` 390×844, dsf 1, 모바일 에뮬레이션 |
| 문서 셸 | 1440×900, dsf 1 |

**스케일된 폰 프리뷰를 쟀는가** — 문서 페이지는 컴포넌트 데모를 축소된 폰 프레임 안에 넣는다.
`getBoundingClientRect()`만 스케일되고, `getComputedStyle` 값과 `offsetWidth`/`offsetHeight`는
transform 이전 값이라 **네이티브 수치를 준다**. 모든 수치는 offset/computed 기준이며
스케일된 rect는 쓰지 않았다. 이 판정이 틀리면 폰 프레임 안 Button이 32px가 아니라 19px로 잡혔을 것이다.

## 2. 전수 컴포넌트 목록 (67개)

`components/` 57 · `foundation/` 2 · `hooks/` 4 · `migration`·`start` 3 · 소개 1

<details>
<summary>펼치기</summary>

**기초 컨트롤** — badge, border, button, checkbox, highlight, icon-button, menu, paragraph,
segmented-control, switch, tab, text-button

**입력** — TextField/text-field, TextField/text-area, TextField/split-text-field, search-field,
numeric-spinner

**리스트** — ListRow/list-row-overview, ListRow/list-row-components, ListRow/ListRowLegacy/list-row-legacy,
list-header, list-footer, board-row, grid-list, table-row, post

**오버레이** — modal, bottom-sheet, bottom-info, Dialog/dialog, Dialog/alert-dialog,
Dialog/confirm-dialog, toast, tooltip, bubble, Agreement/v3, Agreement/v4

**피드백** — loader, skeleton, progress-bar, progress-stepper, rating, result, slider, stepper

**하단 액션** — BottomCTA/Single, BottomCTA/Double, BottomCTA/check-first, BottomCTA/fixed-bottom-cta

**입력 장치 / 시각화** — Keypad/number-keypad, Keypad/alphabet-keypad, Keypad/full-secure-keypad, Chart/bar-chart

**자산** — Asset/asset, Asset/frame, Asset/check-first, top

**기초** — foundation/colors, foundation/typography

**훅** — OverlayExtension/check-first, use-bottom-sheet, use-dialog, use-toast

**이전/시작** — start, migration/v2, migration/from-toss-design-system

</details>

**미실측** — Keypad, Chart, top, result, rating, bubble, menu, toast, tooltip, slider,
progress-bar/stepper, skeleton, loader, numeric-spinner, table-row, post, highlight, border, asset,
dialog, bottom-sheet의 상자 수치는 전수 목록과 prop 표까지만 확인했다. 전수 실측은 수 시간 단위라
사용자 결정으로 **대표 실측** 범위에서 제외했다.

## 3. 토큰 시스템

### 3.1 색

`/foundation/colors/` 정의와 브라우저에서 해소된 adaptive 토큰 기준.

**기본 색상** (라이트 50~900) — grey `#f9fafb → #191f28`, blue `#e8f3ff → #194aa6`,
red `#ffeeee → #a51926`, orange `#fff3e0 → #e45600`, yellow `#fff9e7 → #dd7d02`,
green `#f0faf6 → #027648`, teal `#edf8f8 → #076565`, purple `#f9f0fc → #65237b`.

**Grey opacity** — TDS의 헤어라인·웰·호버가 전부 이 램프다. 라이트/다크가 다른 값이라 쌍으로 기록했다.

| step | light | dark |
| --- | --- | --- |
| 50 | `rgba(0,23,51,.02)` | `rgba(209,209,253,.05)` |
| 100 | `rgba(2,32,71,.05)` | `rgba(217,217,255,.11)` |
| 200 | `rgba(0,27,55,.10)` | `rgba(222,222,255,.19)` |
| 300 | `rgba(0,29,58,.18)` | `rgba(224,224,255,.27)` |
| 400 | `rgba(0,25,54,.31)` | `rgba(232,232,253,.36)` |
| 500 | `rgba(242,242,255,.47)` | `rgba(3,24,50,.46)` |
| 600 | `rgba(0,19,43,.58)` | `rgba(248,248,255,.60)` |
| 700 | `rgba(253,253,255,.75)` | `rgba(3,18,40,.70)` |
| 800 | `rgba(0,12,30,.80)` | `rgba(253,253,254,.89)` |
| 900 | `#ffffff` | `rgba(2,9,19,.91)` |

**Adaptive surface** (light / dark) — background `#ffffff` / `#17171c`,
greyBackground `#f2f4f6` / `#101013`, layeredBackground `#ffffff` / `#202027`,
floatedBackground `#ffffff` / `#2c2c35`, hairlineBorder `#e5e8eb` / `#3c3c47`,
dimmedBackground `rgba(0,0,0,.56)` / `rgba(0,0,0,.2)`.

**캔버스 매핑 판단** — TDS의 화면 배경은 흰색(`adaptiveBackground`)이고 회색 표면은 그룹용이다.
shadcn의 `--background`은 캔버스이므로 그룹 표면인 `#f2f4f6`으로 매핑하고 흰색 종이 표면은
`--card`에 남겼다. 두 토큰을 같은 값으로 두면 `validate-layout-scheme`이 거부한다 — 이 게이트가
첫 실행에서 실제로 잡았다.

### 3.2 타이포그래피

raw scale `--tds-t-f11 … --tds-t-f42` (font size = n px).

- line height = **n × 1.5** (n = 11…29), **n × 4/3** (n = 30…42)
- `icon-height`·`badge-*`는 같은 인덱스를 따라간다 (f11 icon 12px, f29 icon 33px, f42 icon 48px;
  badge padding 3px 6px @f11 → 5px 10px @f39)
- `link-lightThickness` 0.7px @f11 → 2px @f35

의미 별칭 해석 (`/foundation/typography/` 표와 일치 확인):

| token | f | size / line height | usage |
| --- | --- | --- | --- |
| Typography 1 | f30 | 30 / 40 | 매우 큰 제목 |
| sub Typography 1 | f29 | 29 / 38 | sub |
| sub Typography 2 | f28 | 28 / 37 | sub |
| sub Typography 3 | f27 | 27 / 36 | sub |
| Typography 2 | f26 | 26 / 35 | 큰 제목 |
| sub Typography 4 | f25 | 25 / 34 | sub |
| sub Typography 5 | f24 | 24 / 33 | 조금 큰 제목 |
| sub Typography 6 | f23 | 23 / 32 | sub |
| Typography 3 | f22 | 22 / 31 | 일반 제목 |
| sub Typography 7 | f21 | 21 / 30 | sub |
| Typography 4 | f20 | 20 / 29 | 작은 제목 |
| sub Typography 8 | f19 | 19 / 28 | 조금 큰 본문 |
| sub Typography 9 | f18 | 18 / 27 | sub |
| Typography 5 | f17 | 17 / 25.5 | 일반 본문 |
| sub Typography 10 | f16 | 16 / 24 | sub |
| Typography 6 | f15 | 15 / 22.5 | 작은 본문 |
| sub Typography 11 | f14 | 14 / 21 | sub |
| Typography 7 | f13 | 13 / 19.5 | 안 읽어도 됨 |
| sub Typography 12 | f12 | 12 / 18 | sub |
| sub Typography 13 | f11 | 11 / 16.5 | 아예 안읽어도 됨 |

**버튼 라벨은 예외다** — 13→16.276, 15→18.78, 17→21.284, 20→25.04, 22→27.544, 28→35.056.
모두 `fontSize × 1.252`다. 스케일 line height가 아니므로 `--control-label-leading`으로 분리했다.
세 크기에서 같은 비율이 반복되는 것을 확인하고 올렸다.

**더 큰 텍스트** — iOS/Android 동적 타입이 1.01~1.4배로 확대한다. 값을 하드코딩하면
larger-text 모드에서 무너지므로 토큰으로 남겼다.

### 3.3 컨트롤 기하 (실측)

| role | size | radius | padding | type |
| --- | --- | --- | --- | --- |
| Button small | 44×32 | 8px | 0 10px | 13/16.276/600 |
| Button medium | 73×38 | 10px | 0 16px | 15/18.78/600 |
| Button large | 66×48 | 14px | 0 16px | 17/21.284/600 |
| Button default | 96×56 | 16px | 0 28px | 17/21.284/600 |
| TextButton | 77×28 | 8px (press 9px) | — | 17/21.284/500 |
| IconButton | 48×48 | 12px | 12px, icon 24 | — |
| IconButton bordered | 50×50 | 12px | 12px + 0.8px border | — |
| Checkbox | 24×24 | (SVG) | label gap 8px | 1px stroke |
| Switch | 50×30 | 15px | thumb 24 on / 16 off | — |
| Badge xsmall | 44×21 | 9px | 3px 7px | 10/15/600 |
| Badge small | 44×24 | 11px | 3px 7px | 12/18/700 |
| Badge medium | 64×26 | 12px | 3px 7px | 13/19.5/700 |
| Badge large | 49×29 | 13px | 4px 8px | 14/21/700 |
| TextField box | 261×55 | 14px | 14px 16px, 0.8px border | 17/25.5/400 |
| TextField underline | 253×37 | — | 0 0 4px, 1.6px rule | 22/31/600 |
| SearchField well | 269×44 | 12px | 8px 10px | — |
| SegmentedControl | 253×48 | 14px | 4px 5px | 17/25.5 |
| Tab | 87×47 | — | 0 8px, indicator 2px + 0 10px | 17/21.284 |
| ListRow | 44…82 h | 12px hover | 12px 24px | 17/22.95/500 |
| ListHeader | — | — | 24px 0 8px | 20 title / 13 sub |
| ListFooter | 301×59 | — | 0 24px | 17/21.284/500 |
| GridList cell | 79×75 | 9px | 12px 8px, gap 6px | 14/21/500 |
| Stepper row | 301×74 | — | 3px 24px, icon 30, connector 2×32 | — |
| BoardRow header | 301×56 | 12px hover | 16px 16px 16px 24px | 17/22.95 |
| BottomCTA | — | — | 0 20px 20px | — |

**Button은 button이 아니라 자식 div가 fill을 갖는다.** `button`가 transparent이고
`div`(fill) → `span`(label, min-height + padding-inline) 순서다. radius만 button에 있다.
`aria-busy` / `aria-live="off|polite"`도 실측했다.

**배지 반경은 크기를 따라간다** — 21→9, 24→11, 26→12, 29→13. 하나의 스텝으로 환원하지 않는다.
Badge는 단일 tone 규칙이 아니라 height에 묶인 값이라 스니펫에 크기별 값을 그대로 넣었다.

## 4. 산출물

`~/.local/share/scripts/dev/design/themes/toss/`

| 파일 | 내용 |
| --- | --- |
| `layout.css` 551줄 | 생성물. shadcn 프리미티브 + TDS 프로젝트 프리미티브 + adaptive 다크 + primitive chrome tail |
| `spec.json` 261줄 | 값 원본 (`:root` / `dark` / `projectPrimitives` / `projectUtilities`) |
| `SOURCE.md` 225줄 | 실측 수치표 3개, 폰트 대체, 문서 셸, 검증 결과, 미실측 목록 |
| `design.json` 381줄 | TDS 역할 (canvas / type / controls / lists / notLinear / shell). 토큰 이름만 |
| `chrome.json` 410줄 | 어느 라이브 페이지가 어떤 역할을 가르쳤는지 + 기하 수치 + 색 역할 |
| `components/*.svelte` 20개 | TDS 컴포넌트 복사 스니펫 + `README.md` |
| `ref/` | theme-ref 재현: `shell.svelte`, `app-sidebar/header/footer.svelte`, `chrome.ts`, `data.ts`, 3개 페이지 |

`styles.json`에 `toss` 등록, `ref/` 생성으로 카탈로그에 `theme-toss`가 자동 노출된다.
캡처는 `ref/tossmini-docs.toss.im/`에 19페이지(mobile 18 + desktop 1), MHTML 포함.

**스니펫 루트에는 TDS 자신과 같은 `data-tds-mobile-component` 속성**을 붙였다.
그래야 live 문서와 같은 XPath로 양쪽 노드를 지정해 computed style을 직접 대조할 수 있다.
처음에는 이 표식이 없어 비교 XPath가 엉뚱한 노드(버튼 라벨 span)를 잡았다.

## 5. 검증

### 게이트

| 게이트 | 결과 |
| --- | --- |
| `validate-layout-scheme.ts --all` | ok — root 161 / dark 33 / theme 131, unsectioned 0 |
| `check-theme-chrome.ts` | ok |
| `compare-shadcn-theme.ts` | missing 0, unsectioned additions 0 |
| `measure-theme-ref.ts` light | 3페이지 `ok: true`, `fail: []` |
| `measure-theme-ref.ts` dark | 3페이지 `ok: true`, `fail: []` |
| `vite build` | 통과 |

### ref 기하 (light · dark 공통)

| page | sidebar | inset | inset radius | header | footer |
| --- | --- | --- | --- | --- | --- |
| button | 256px | x256 y12 1172×848 | 12px | 64px | 40px @ y860 |
| components | 256px | 동일 | 12px | 64px | 40px |
| foundation | 256px | 동일 | 12px | 64px | 40px |

sidebar 256px · header 64px · content column 832px는 라이브 문서 실측값이다.
inset이 y0이 아니라 y12인 것은 대시보드 셸 계약이 `--panel-inset`(12px)으로 띄우는 패널을 쓰기 때문이고,
라이브 문서는 nav가 y0에 밀착한다. footer는 **라이브에 없는 요소**다 — `measure-theme-ref`가
`data-role=app-footer`를 요구하므로 넣었고, 코드 주석과 `SOURCE.md`에 ref 편의 요소임을 적었다.

### 컨트롤 대조 (라이브 vs 재현)

`collect-computed-styles.ts` → `compare-computed-styles.ts --mode control`
(근거 파일 `/tmp/site-to-design/toss/cmp/`). 명명 대상 `button-medium`, `badge-medium`, `switch-on`.

**일치** — padding, border-radius, font-size, line-height, font-weight, color, background,
상자 높이, 그리고 모든 실측 기하 값. `button-medium`은 `display: flex`까지 일치한다.

**남은 차이 4건, 전부 설명 가능**

1. **폰트 / 텍스트 폭** — 스택은 실측 순서로 일치하고(`"Toss Product Sans", Tossface, "SF Pro KR",
   "SF Pro Display", "SF Pro Icons", -apple-system, BlinkMacSystemFont, …`) `Pretendard`만
   하나 추가했다. 라이브는 실제 웹폰트를 로드하고 드래프트는 Pretendard로 해석되므로
   13px/700 배지가 라이브 64px, 드래프트 67.7px다. 높이·padding·radius는 영향 없음.
2. **border 기본색** — 라이브 `rgb(229,231,235)`는 문서 사이트의 전역 Tailwind 기본값이고,
   테마의 `*` 규칙은 TDS 헤어라인 `rgb(229,232,235)`다. 실측된 컨트롤 중 자체 border를 가진 것이
   없어 컴포넌트 토큰이 아니라 전역 기본값 차이다.
3. **Switch 라벨 잉크** — 라이브 `rgb(51,65,85)`는 문서 본문에서 상속된 값, 스니펫은 TDS grey800
   `rgb(51,61,75)`.
4. **Checkbox 그래픽 반경** — TDS는 SVG로 그려서 실제 박스가 `border-radius: 0px`다.
   CSS 포트는 모양을 박스에 올리므로 `9999px`(circle) / `4px`(line)가 된다.

이 대조가 실제로 잡아낸 결함 두 가지(Button `font-weight` 누락 → 400, Switch의 패딩 기반 썸 위치)
는 수정했다. 두 번째 패스는 스크립트 버그가 아니라 **셀렉터 오염**이었다 — 양쪽에서 같은 XPath가
서로 다른 노드를 잡았다. `data-tds-mobile-component` 표식을 스니펫에 붙인 이유다.

## 6. 짚어둘 것

**대시보드 레포의 `~/dev/dashboard/apps/client/src/lib/server/design/cli/emit-layout-css.ts`가 깨져 있다.** 62행 `insertBeforeClose()`가
`/\n\t/*s*Project primitivess**/[sS]*$/` 라는 잘못된 정규식을 만들어 **기존 `threads`를 포함한
모든 slug에서** 예외를 던진다.

```text
SyntaxError: Invalid regular expression: nothing to repeat
  at insertBeforeClose (apps/client/src/lib/server/design/cli/emit-layout-css.ts:62:17)
```

스킬 문서가 안내한 대로 폴백 경로(`spec.json`에서 `layout.css` 생성)를 썼다.
`/tmp/site-to-design/toss/emit-layout-css.mts`가 같은 출력을 정상 정규식으로 만들고,
`build.sh`가 ①토큰 블록 ②다크 팔레트 ③primitive chrome tail을 붙여 반복 재현 가능하게 한다.
이 도구를 고치는 것은 별도 변경이라 **손대지 않았다.**

**새 theme-ref 디렉터리는 웹 트리 재시작이 필요하다.** Vite의 draft 모듈 glob이
`themes/*/ref`를 시작 시 한 번만 훑는다. `executor reload dashboard` 후에만 노출됐다.
설정 파일 변경이 아니라 새 디렉터리 추가라 HMR로는 잡히지 않는다.

**라이브 셸에는 적용하지 않았다.** 요청대로 포터블 산출물과 검증까지만 했다.
적용하려면 `apps/client/src/routes/layout.css`의 `--text-*` 토큰을 toss 스케일로 교체해야 하며,
사전 빌드가 필요하다.

## 7. 재현 방법

```bash
cd /tmp/site-to-design/toss
bash build.sh                      # spec.json → layout.css + 다크 + tail, 게이트 확인
cd ~/dev/dashboard
bun apps/client/src/lib/server/design/cli/inject-draft-chrome.ts   # 드래프트 sheet 갱신
executor reload dashboard                                          # 새 ref 디렉터리 반영
bun ~/.agents/skills-ready/site-to-design/scripts/measure-theme-ref.ts --slug toss --scheme light
```

미탐색 자료는 `/tmp/site-to-design/toss/`에 있다.
`html/`(67개 SSR HTML), `trees/`(67개 구성 트리 덤프), `tokens/`(해소된 토큰 정복),
`cmp/`(라이브·드래프트 computed style 비교), `tds-tokens-typo.txt`(타이포 토큰 원본).

`layout.css`는 생성물이므로 직접 고치지 않는다. `spec.json`을 고치고 `build.sh`를 돌린다.
