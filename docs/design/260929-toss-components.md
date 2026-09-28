# toss 테마 컴포넌트 전수 구성 (TDS Mobile 47개 + 토큰 재구성)

> 작성일: 2026-09-29 (260929)
> 선행: [260928-toss-theme.md](260928-toss-theme.md)
> 원본: toss-docs MCP(`tds_mobile` = `https://tossmini-docs.toss.im/tds-mobile/llms-full.txt`) + 라이브 문서 실측
> 산출물: `~/.local/share/scripts/dev/design/themes/toss/` (`spec.json`, `layout.css`, `.build/`, `components/`, `ref/`, `design.json`, `chrome.json`, `SOURCE.md`)
> 검수: `http://dashboard.localhost/design` → theme-toss 8개 페이지, light / dark

## 결론

- **컴포넌트** — 20개 → **47개**. TDS Mobile 문서의 컴포넌트 라우트 57개를 전부 대응한다
  (ListRowLegacy·AgreementV3 같은 구 API만 제외). 새 27개의 수치는 전부 라이브에서 새로 쟀다.
  오버레이(Dialog, Modal, BottomSheet, Toast, Tooltip)는 실제로 클릭해 연 뒤 쟀다.
- **토큰** — linear처럼 3층으로 재구성했다: **adaptive 팔레트**(8색 × 50–900 + greyOpacity, `:root`/`.dark` 쌍)
  → **역할**(`--surface-*`, `--ink-*`, `--status-*`) → **컴포넌트 기하**(`--control-*`, `--field-*`, `--list-row-*`,
  `--dialog-*` …). 타입은 TDS 이름 그대로 `text-t1…t7`, `text-st1…st13`에 역할 별칭과 두 예외 행간
  (버튼 ×1.252, 리스트 ×1.35)을 더했다.
- **오류 정정** — 선행 보고서의 greyOpacity 500/700/900 라이트·다크 뒤바뀜, dim `.56/.2` 뒤바뀜을 바로잡았다.
  다크에서 버튼 글자색이 `--surface-float`(= 다크 회색)로 깨지던 것도 고쳤다.
- **검수** — 게이트 전부 통과, `measure-theme-ref` 8페이지 × light/dark `ok`, 모든 섹션을 light/dark 나란히 캡처해 확인,
  드래프트 박스 수치를 라이브 실측과 대조(차이는 폰트·테두리 1–2px뿐).

## 0. 다크 모드 정책

toss-docs MCP의 앱인토스 문서에 따르면 **미니앱은 다크 모드를 지원하지 않는다**
(FAQ "라이트 모드 기준으로 개발/디자인 및 출시", 디자인 FAQ "추후 지원 예정", 비게임 출시 검수 체크리스트
"미니앱 테마는 라이트 모드로 구현"). TDS Mobile 문서에는 전환 방법이 없다. 따라서 이 테마의 **기준은 라이트뿐**이고,
`.dark`는 문서 사이트에 남은 adaptive 쌍 + 파생 보정으로 만든 비공식 참고값이다. `design.json` `color.darkMode`,
`SOURCE.md` "Dark mode policy", `components/README.md`에 명시했다. 다크 그림자는 TDS RN 예시(`darkColor: '#fff'`)와 달리
검정으로 유지하기로 했다.

## 1. 무엇을 읽고 쟀나

| 단계 | 방법 |
| --- | --- |
| 문서 | toss-docs MCP 소스 `tds_mobile`의 `llms-full.txt`를 라우트별 67개 파일로 나눠 각 컴포넌트의 prop·기본값·variant를 읽음 |
| 정적 실측 | 390×844, dsf 1, 모바일 에뮬레이션. 각 `.preview` 블록을 depth 7까지 덤프(offset/computed 값 — 폰 프리뷰 스케일 영향 없음) |
| 오버레이 실측 | 트리거 버튼을 실제 클릭(`Input.dispatchMouseEvent`) → 0.9–1.8초 뒤 새로 생긴 fixed/absolute 노드 덤프 |
| 모양 확인 | 번호 아이콘, 보안 키패드, Agreement v4 등은 프리뷰 영역을 2x로 캡처해 눈으로 확인 |
| 다크 판정 | 문서 사이트는 `<html class="light">`로 고정. 이때 `:root`의 `adaptive*`는 **다크** 값(`--adaptiveGrey700 = #c3c3c6`, dim `.56`)을 가진다 → 쌍의 방향 확정. dialog dim은 라이트에서 검정 `.2`로 실측 |

**다크 컴포넌트 렌더는 라이브로 볼 수 없다.** 다크 값은 adaptive 쌍에서 오고, 파생 보정 3가지만 더했다
(검정 그림자, dark 버튼 라벨 = `--surface-base`, Highlight 마스크 고정값). `chrome.json`의 `notMeasured`에 적었다.

## 2. 토큰 구조

`spec.json`이 값의 원본이고 `layout.css`는 생성물이다.

```bash
bun ~/.local/share/scripts/dev/design/themes/toss/.build/emit.ts
```

| 층 | 예 | 비고 |
| --- | --- | --- |
| 팔레트 | `--grey-50 … --purple-900`, `--grey-opacity-50 … 900` | `:root` 라이트, `.dark` 실측 다크. Tailwind `bg-grey-100` 등으로도 노출 |
| 역할 | `--surface-base/grey/layered/float/well/hover/selected`, `--ink-strong … --ink-link`, `--status-*` | 팔레트를 `var()`로 가리켜 다크에서 자동 전환 |
| 타입 | `--text-t1…t7`, `--text-st1…st13`, `--text-display…caption`, `--text-control-*`, `--text-row*` | **`:root`에 런타임 값**, `@theme inline`은 참조만 |
| 기하 | `--control-height-sm…xl`, `--control-radius-*`, `--field-*`, `--list-row-padding-*`, `--dialog-*`, `--sheet-*`, `--track-*` … | 컴포넌트가 공유하는 수치만 토큰화, 1회성 수치는 스니펫 주석에 |
| 그림자 | `--shadow-float`, `--shadow-float-strong`, `--shadow-toast`, `--shadow-thumb*` | 라이트 실측, 다크는 검정 파생 |

**타입을 `:root`로 옮긴 이유** — Tailwind v4는 `@theme` 변수를 자기가 컴파일하는 CSS에서 참조될 때만 방출한다.
스니펫의 scoped `<style>`이 `var(--text-t5)`를 읽으면 정의되지 않은 채로 남아, 첫 캡처에서 TextField big/hero가
line과 같은 크기로 보였다. 값을 `:root`(레이어 밖)에 두고 `@theme inline`은 `var()`만 두어 해결했다(linear의 `--font-heading`과 같은 방식).

**빌드 이전** — 선행 작업의 빌드는 `/tmp/site-to-design/toss/`에 있었다. 재부팅이면 사라지므로 `themes/toss/.build/`
(`emit.ts`, `chrome.css`)로 옮겼다. 대시보드의 `emit-layout-css.ts`는 `.dark`에 비-shadcn 토큰을 넣지 못해 쓰지 않는다.

## 3. 컴포넌트

전부 `components/*.svelte`. **scoped `<style>` + 토큰 변수**로 작성해 붙여 넣는 앱의 Tailwind 소스 설정과 무관하게 동작한다.
루트에 TDS와 같은 `data-tds-mobile-component` 표식이 있다. 목록과 수치는 `components/README.md`.

| 묶음 | 컴포넌트 |
| --- | --- |
| 컨트롤 | Button, TextButton, IconButton, Badge, Checkbox, Switch, SegmentedControl, Tab |
| 입력 | TextField(box/line/big/hero), TextArea, SplitTextField, SearchField, NumericSpinner, Slider, Rating |
| 리스트 | ListRow, ListRow.Asset, ListHeader, ListFooter, BoardRow, GridList, TableRow, Border, Stepper |
| 콘텐츠 | Paragraph, Post, Top, Result, Asset.Frame, Bubble, BottomInfo, BarChart, Highlight, AgreementV4 |
| 오버레이 | AlertDialog/ConfirmDialog, Modal, BottomSheet, Toast, Tooltip, Menu |
| 피드백·액션 | Loader, Skeleton, ProgressBar, ProgressStepper, BottomCTA(Single/Double/Fixed), NumberKeypad/AlphabetKeypad, FullSecureKeypad |

선행 스니펫에서 바로잡은 것: BottomCTA.Double은 세로 스택이 아니라 **좌우 2버튼 + 위 36px 그라데이션**,
BottomSheet는 **좌우·아래 10px 띄운 r28 카드 + 48×4 그립**, Checkbox는 CSS 상자가 아니라 **SVG 원판/체크**,
TextField 테두리는 hairline이 아니라 **greyOpacity100**, Button은 dark/light 색과 로딩 점이 추가됐다.

## 4. 카탈로그 (`themes/toss/ref/`)

라이브 문서 셸(256 사이드바, 64 헤더, 832 본문)을 그대로 두고 페이지를 재편했다.
사이드바는 문서 내비게이션 순서대로 모든 컴포넌트를 해당 페이지·앵커로 연결한다.

| 페이지 | 내용 |
| --- | --- |
| `foundation` | 팔레트 8×10 + greyOpacity, surface·ink·status, t1…st13, 컨트롤/리스트 타입, 기하·그림자 |
| `button` | 라이브 `/components/button/` 재현 |
| `controls` · `inputs` · `lists` · `content` · `overlays` · `feedback` | 섹션마다 실측 스펙 한 줄 + 375px 모바일 프리뷰 |

오버레이는 열린 상태를 딤 위에 인라인으로 보여주고, 트리거 버튼으로 실제 fixed 오버레이도 열 수 있다.

## 5. 검수

### 게이트

| 게이트 | 결과 |
| --- | --- |
| `validate-layout-scheme.ts --project themes/toss/layout.css` | ok (root 269 / dark 131 / theme 282) |
| `check-theme-chrome.ts --theme themes/toss` | ok |
| `compare-shadcn-theme.ts` | missing 0, unsectioned 0 |
| `measure-theme-ref.ts --slug toss` light / dark | 8페이지 모두 `ok: true`, `fail: []` |
| Svelte 컴파일(47 스니펫 + ref) | 전부 성공. 경고는 TDS 라이브 속성 `role="text"` 이식에서 나온 a11y 린트뿐 |
| 브라우저 콘솔 | 16개 페이지×스킴 조합에서 오류·경고 0 |

### 시각 검수에서 잡아 고친 것

| 증상 | 원인 | 조치 |
| --- | --- | --- |
| 카탈로그에서 `text-st12`, `bg-surface-grey` 등이 적용 안 됨 | 대시보드 드래프트 시트가 `.product`만 Tailwind 소스로 넣고 테마 ref는 안 넣음 | `inject-draft-chrome.ts`의 소스 루트에 테마 ref 추가(아래 6) |
| TextField big/hero가 line과 같은 크기 | `@theme` 변수 미방출 | 타입 스케일을 `:root`로 |
| 다크의 dark 버튼: 밝은 회색 위 흰 글자 | grey700이 다크에서 밝아짐 | 라벨 = `--surface-base` |
| 다크 툴팁·메뉴·토스트 주변 흰 광채 | greyOpacity 그림자가 다크에서 밝은 색 | `.dark`에서 검정 그림자 |
| 다크 Highlight 마스크가 흰색 | greyOpacity700이 다크에서 흰색 75% | 고정 토큰 `--highlight-dim` |
| Loader light가 다크에서 안 보임 | 컴포넌트가 grey600 배경을 품고 있었음 | 배경 제거, 어두운 면 위에 놓는 용도로 |
| overlays 데모에서 Dialog·Modal이 왼쪽으로 쏠리고 BottomSheet가 딤 폭을 꽉 채움 | `inline` 모드가 fixed 배치의 가운데 정렬·10px 인셋을 버리고 `display: block` / `margin: 0` | inline도 가운데 정렬·시트 인셋 유지, 트리거·Menu·Button 스테이지 가운데 정렬 (좌우 여백 28/28, 10/10/10 대칭 확인) |

### 드래프트 ↔ 라이브 박스 대조

일치: Button 32/38/48/56, Switch 50×30, Badge 21/24/26/29, IconButton 48/50, Segmented 48, Tab 47/37,
TextField 55·37·46·40·138, SearchField 44, Slider 40, ListRow 47/44/55/71, ListFooter 59, BoardRow 56, TableRow 42,
GridList 75, Stepper 74, ListHeader 81, Dialog 320, Toast 47/48·51/60, Tooltip 36/49, ProgressBar 5/2/8,
Loader 48/60/80, Keypad 66, BottomCTA 76, Result 273, BarChart 205.

남은 차이(모두 폰트·테두리): NumericSpinner tiny/small 1px(값 상자 폭 = 대체 폰트의 "000" 폭),
Menu 188 vs 186(0.8px 테두리 2개), Bubble 48 vs 50(라이브 Toss Product Sans 줄 상자 메트릭).

## 6. 짚어둘 것

**대시보드 코드를 한 곳 고쳤다.** `~/dev/dashboard/apps/client/src/lib/server/design/cli/inject-draft-chrome.ts`의
`compileSourceRoots()`가 테마 ref 디렉터리(`themes/<slug>/ref`)도 Tailwind `@source`로 넣게 했다. 카탈로그가 이미
theme-ref를 프로젝트로 나열하므로 같은 목록을 쓴다. 다른 테마 ref(linear 등)도 이제 토큰 유틸리티가 시트에 들어간다.
커밋은 하지 않았다.

**대시보드를 executor 밖에서 띄웠다.** 새 ref 디렉터리를 반영하려고 `executor reload dashboard`를 했는데,
시스템 부하(load ~17)로 `lsof`가 1–2.5초 걸려 executor의 포트 검사(2초 타임아웃)에 막혔고 재기동이 계속 `blocked`였다.
같은 명령(`dev-stack --web-dir apps/client --api-dir apps/server --web-port 45110 --api-port 45111`)을
`~/dev/dashboard`에서 직접 띄워 `dashboard.localhost`를 복구했다. 부하가 내려가면 이 프로세스를 끄고
`executor start dashboard`로 되돌리면 된다. executor의 lsof 타임아웃(`src/runner.rs` `DEFAULT_RUN_TIMEOUT_MS = 2000`)은 그대로다.

**linear `layout.css`는 `validate-layout-scheme`에서 실패한다.** `--color-board-band` 등이 `/* Project utilities */`
앞에 있고 `--list-group-fill` 값이 spec과 다르다는 기존 상태이며, 이번 작업에서 건드리지 않았다.

**드래프트 시트는 60초 캐시된다.** `/design/sheet/<slug>`가 `max-age=60`이라 시트를 다시 구운 직후의 캡처는
이전 CSS로 찍힐 수 있다. 재캡처 전 1분 기다리거나 하드 리로드한다.

## 7. 재현

```bash
# 토큰
bun ~/.local/share/scripts/dev/design/themes/toss/.build/emit.ts
bun ~/.local/share/scripts/dev/design/cli/validate-layout-scheme.ts --project ~/.local/share/scripts/dev/design/themes/toss/layout.css
bun ~/.local/share/scripts/dev/design/cli/check-theme-chrome.ts --theme ~/.local/share/scripts/dev/design/themes/toss

# 카탈로그 시트
cd ~/dev/dashboard && bun apps/client/src/lib/server/design/cli/inject-draft-chrome.ts

# ref 셸 게이트
bun ~/.agents/skills-ready/site-to-design/scripts/measure-theme-ref.ts --slug toss --scheme light
bun ~/.agents/skills-ready/site-to-design/scripts/measure-theme-ref.ts --slug toss --scheme dark
```

카탈로그: `http://dashboard.localhost/design/draft?file=foundation/page.svelte&project=theme-toss&style=toss&scheme=light`
(`file=`을 `controls|inputs|lists|content|overlays|feedback|button/page.svelte`로 바꾸고, `scheme=dark`로 다크 확인).
