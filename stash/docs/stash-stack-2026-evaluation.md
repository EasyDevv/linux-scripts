# stash stack evaluation (2026)

기준일: 2026-07-08

## 목적

`stash`의 현재 주요 스택을 2026년 기준으로 다시 보고,

- 최신성
- 커뮤니티 신호
- 대안 스택의 실익
- 실제 마이그레이션 비용

을 중립적으로 평가한다.

이 문서는 "무조건 갈아타기"가 아니라 `stash`의 현재 성격에 맞는 선택을 정리하는 보고서다.

## 현재 스택

### backend

- Rust 2024 edition
- `actix-web = "4"`
- `tokio = "1"`
- `rusqlite = "0.32"`
- `reqwest = "0.12"`
- `serde`, `serde_json`, `serde_urlencoded`

### frontend

- HTMX stable `2.0.10`, self-host
- Bootstrap Icons `1.13.1`, self-host
- plain CSS
- plain JS

### delivery model

- Rust server가 HTML partial을 직접 렌더링
- HTMX polling으로 `tbody` 단위 갱신
- 클라이언트 상태는 최소화

이 구조는 전형적인 SPA보다 "HTML-over-the-wire + small JS" 쪽에 가깝다.

## 2026 snapshot

### backend frameworks

| 후보 | 2026 상태 | 공개 신호 |
|---|---|---|
| Actix Web | 성숙, 고성능, 여전히 활발 | GitHub 24.7k stars, docs.rs latest `4.14.0`, 2026-06 릴리즈 |
| Axum | Tokio/Tower 중심 표준 후보, 생태계 호환성 강함 | GitHub 26.4k stars, docs.rs latest `0.8.9`, 2026-04 릴리즈 |
| Rocket | DX는 좋지만 현재 `stash`와의 직접 이점은 작음 | 이번 평가에서는 우선순위 낮음 |

### frontend partial/UI layer

| 후보 | 2026 상태 | 공개 신호 |
|---|---|---|
| HTMX | HTML-over-the-wire의 대표 주자 | GitHub 48.3k stars, stable `2.0.10`, v4 beta 진행 중 |
| Alpine.js | 작은 상호작용 레이어로 여전히 강함 | GitHub 31.7k stars, 극소형 선언형 JS 용도에 적합 |
| React 계열 SPA | 여전히 거대 생태계 | 커뮤니티는 가장 크지만 `stash` 현재 구조와는 방향이 다름 |

### icon layer

| 후보 | 2026 상태 | 공개 신호 |
|---|---|---|
| Bootstrap Icons | 안정적, font/sprite/svg 사용성 좋음 | GitHub 8.0k stars, latest `1.13.1`, 2,000+ icons |
| Lucide Static | 최근 더 선호되는 경향, 현대적 스타일, static 모드 강함 | GitHub 23.3k stars, `lucide-static` latest `1.23.0` |

## 커뮤니티 평가 요약

### 1. Rust backend

#### Actix Web

- 장점으로 가장 자주 언급되는 것은 성능, 성숙도, 실전 운용 이력이다.
- 공식 문서도 "powerful, pragmatic, and extremely fast"를 전면에 둔다.
- 여전히 릴리즈가 이어지고 있어 "죽은 프로젝트"로 보기는 어렵다.
- 다만 새 팀원이나 새 예제는 Axum/Tower 기준으로 더 많이 접하게 되는 흐름이 분명하다.

#### Axum

- 커뮤니티에서는 "Tokio/Tower 쪽 표준적인 선택"으로 많이 받아들여진다.
- 공식 문서도 ergonomics, modularity, Tower ecosystem을 핵심 차별점으로 둔다.
- 새 middleware, observability, auth, service composition 자료는 Axum 쪽이 더 쉽게 연결되는 편이다.
- 성능 자체는 대체로 충분하다는 평가가 많고, 실무에서는 raw throughput보다 ecosystem fit이 더 자주 언급된다.

### 2. HTMX / small-JS 계열

#### HTMX

- 커뮤니티 평가는 양극이 아니라 "철학이 분명한 도구"에 가깝다.
- 서버가 HTML을 잘 만들 수 있고, client state가 복잡하지 않은 경우 매우 좋은 평가를 받는다.
- 공식 사이트도 dependency-free, small size, reduced code base size를 강하게 내세운다.
- 2026 시점에도 stable 2.x가 유지되고, 4.x beta가 진행 중이라 프로젝트 momentum도 살아 있다.

#### Alpine.js

- HTMX의 대체재라기보다 보완재로 보는 시각이 많다.
- 로컬 토글, modal, small state, keyboard interaction 같은 client-side 상호작용은 HTMX보다 Alpine이 더 간단할 때가 많다.
- 즉 "HTMX vs Alpine"보다 "HTMX + Alpine 최소 병행"이 더 현실적인 비교다.

### 3. icon system

#### Bootstrap Icons

- 강점은 단순성이다.
- CSS 한 장으로 font icon을 바로 붙일 수 있어 현재 `stash`처럼 작은 관리자 UI에는 도입 마찰이 거의 없다.
- 단점은 최신 디자인 취향 기준에서 Lucide보다 덜 선호되는 경우가 있다는 점이다.

#### Lucide Static

- 커뮤니티 선호도는 최근 더 높아 보인다.
- icon style consistency와 현대적인 stroke 기반 미감을 선호하면 Lucide 쪽이 유리하다.
- 다만 현재 `stash`의 요구는 "미려한 marketing UI"가 아니라 "dense utility UI"라서, 실익이 반드시 크다고 보긴 어렵다.

## stash 기준 중립 평가

### A. Rust backend: Actix 유지 vs Axum 마이그레이션

| 항목 | Actix 유지 | Axum 마이그레이션 |
|---|---|---|
| 현재 적합성 | 높음 | 중간 |
| 성능 리스크 | 낮음 | 낮음 |
| 구현 재작업 | 없음 | 중간~높음 |
| 팀 학습 이점 | 중간 | 높음 |
| 생태계 호환성 | 충분 | 매우 좋음 |
| 즉시 사용자 가치 | 낮음 | 낮음~중간 |

판단:

- `stash`는 대규모 public API 서비스가 아니라 로컬 툴 + HTML dashboard다.
- 현재 코드도 Actix를 무리 없이 사용하고 있고, 병목이 framework 선택에서 오고 있지 않다.
- 따라서 **지금 당장 Axum으로 옮길 기술적 압박은 낮다.**
- 다만 앞으로 아래가 중요해지면 Axum 이점이 커진다.
  - Tower middleware 공유
  - OpenTelemetry/observability layering 확대
  - auth / reverse proxy / service composition 확장
  - 신규 팀원이 Axum 경험 위주일 때

중립 결론:

- **단기: Actix 유지**가 합리적
- **중기: Axum 재평가**는 충분히 가치 있음
- 지금 옮기면 "최신 스택 정렬" 이상의 실익은 제한적

### B. HTMX 유지 vs SPA 전환

| 항목 | HTMX 유지 | SPA 전환 |
|---|---|---|
| 현재 구조 적합성 | 매우 높음 | 낮음 |
| 복잡도 | 낮음 | 높음 |
| bundle/tooling 증가 | 거의 없음 | 큼 |
| table/polling/admin UI 적합성 | 높음 | 높음 |
| 마이그레이션 비용 | 없음 | 매우 큼 |

판단:

- `stash` UI는 표 중심, partial refresh 중심, 로컬 상태 최소화라는 점에서 HTMX에 잘 맞는다.
- React/Vue/Svelte로 가면 기술 선택의 현대성은 올라가도, 현재 제품 문제를 더 잘 푸는 건 아니다.
- 오히려 빌드/상태관리/번들/SSR 경계를 새로 만들 가능성이 크다.

중립 결론:

- **HTMX 유지가 맞다.**
- 다만 local interaction이 더 늘어나면 **HTMX + Alpine.js** 조합은 검토할 가치가 있다.
- "SPA 전환"은 현재 기준 과투자다.

### C. Bootstrap Icons 유지 vs Lucide 이동

| 항목 | Bootstrap Icons 유지 | Lucide Static 이동 |
|---|---|---|
| 현재 구현 적합성 | 높음 | 중간 |
| CDN font 사용 편의 | 높음 | 중간 |
| 시각적 현대성 | 중간 | 높음 |
| dense utility UI 적합성 | 높음 | 높음 |
| 마이그레이션 비용 | 없음 | 낮음~중간 |

판단:

- 현재 UI는 qBittorrent 스타일의 dense admin table이라 Bootstrap Icons가 충분히 어울린다.
- Lucide로 가면 더 정돈된 시각 언어를 얻을 수 있지만 기능적 이점은 거의 없다.
- 디자인 리프레시가 목적이 아니면 우선순위는 높지 않다.

중립 결론:

- **지금은 Bootstrap Icons 유지**가 합리적
- 다만 최신 버전 `1.13.1`로 올리거나, 더 나아가 self-host로 전환하는 것은 검토할 만하다.

### D. 외부 CDN 유지 vs self-host

| 항목 | 외부 CDN 유지 | self-host |
|---|---|---|
| 운영 단순성 | 높음 | 중간 |
| 재현성 / 공급망 통제 | 낮음 | 높음 |
| 오프라인/로컬 환경 일관성 | 낮음 | 높음 |
| 배포 자산 관리 | 낮음 | 중간 |

판단:

- `stash`는 로컬 툴 성격이 강해서, 외부 CDN 장애/변경/SRI 문제의 영향을 굳이 안고 갈 이유가 크지 않다.
- HTMX와 icon font 모두 크기가 큰 편이 아니므로 vendoring 비용도 낮다.

중립 결론:

- **기능상 급하지는 않지만, self-host 쪽이 제품 성격에는 더 잘 맞는다.**

## 최신성 기준의 갭

### 현재와 최신의 차이

| 영역 | 현재 | 2026 관찰치 | 평가 |
|---|---|---|---|
| Actix Web | `4.x` 범위 지정 | docs.rs latest `4.14.0` | 크게 뒤처지지 않음 |
| HTMX | `2.0.10` | stable `2.0.10`, v4 beta 진행 | 최신 |
| Bootstrap Icons | `1.13.1` | `1.13.1` | 최신 |

핵심은 backend보다 **프론트 자산 delivery 전략**이 더 실질적인 개선 포인트였다는 점이다.

## 권장안

### 권장안 A: 최소 변경, 최신성 보강

1. Actix 유지
2. HTMX를 `2.0.10`으로 업데이트
3. Bootstrap Icons를 `1.13.1`로 업데이트
4. CDN 자산을 self-host로 유지

장점:

- 가장 작은 비용으로 2026 기준 최신성 확보
- 현재 구조와 가장 잘 맞음
- 회귀 리스크가 작음

### 권장안 B: 소규모 개선

1. 권장안 A 수행
2. local UI interaction이 늘면 Alpine.js를 보조적으로만 도입

장점:

- HTMX 철학은 유지
- checkbox state, modal, keyboard shortcut 같은 로컬 상태를 더 단순하게 처리 가능

주의:

- HTMX를 Alpine로 대체하는 것이 아니라, 필요한 곳에만 보조적으로 써야 이점이 크다.

### 권장안 C: 중기 리플랫폼 검토

아래가 roadmap에 들어오면 Axum 마이그레이션을 다시 검토한다.

- 더 큰 HTTP API surface
- middleware 재사용 요구 증가
- observability / auth / service composition 확대
- 팀 표준을 Tokio/Tower 쪽으로 맞출 필요

현재 시점에서는 선제 전환보다 **명확한 확장 압력이 생겼을 때** 검토하는 편이 더 중립적이다.

## 최종 결론

2026년 기준으로 `stash`의 현재 스택은 **구식이라고 보기 어렵다.**

- Rust + Actix는 여전히 충분히 유효하다.
- HTMX는 오히려 `stash` 같은 UI에 잘 맞는 선택이다.
- 가장 현실적인 개선 포인트는 framework 교체가 아니라 **버전 정리와 asset self-host 전략**이었다.

중립 평가 한 줄 요약:

> 지금 `stash`가 당장 바꿔야 할 것은 backend framework가 아니라, 프론트 자산 버전과 delivery 방식이었다.

## Sources

- 현재 코드: `stash/Cargo.toml`, `stash/web/index.html`
- Actix Web docs.rs latest: https://docs.rs/actix-web/latest/actix_web/
- Axum docs.rs latest: https://docs.rs/axum/latest/axum/
- Actix Web GitHub: https://github.com/actix/actix-web
- Axum GitHub: https://github.com/tokio-rs/axum
- HTMX site: https://htmx.org/
- HTMX GitHub: https://github.com/bigskysoftware/htmx
- Bootstrap Icons site: https://icons.getbootstrap.com/
- Bootstrap Icons GitHub: https://github.com/twbs/icons
- Lucide static docs: https://lucide.dev/guide/static/
- Lucide GitHub: https://github.com/lucide-icons/lucide

참고:

- crates.io API는 이 환경에서 직접 수집이 막혀 있어, backend community signal은 docs.rs 최신 버전, GitHub star, 최근 push/release를 주된 proxy로 사용했다.
