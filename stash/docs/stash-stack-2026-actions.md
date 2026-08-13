# stash 2026 actions

기준일: 2026-07-08

## 목표

2026 평가 보고서 기준으로, `stash`에서 지금 바로 할 만한 실행안을 한 페이지로 정리한다.

## 결론

지금 우선순위는 framework 교체가 아니라 **프론트 자산 최신화 + self-host**다.

## 바로 실행할 항목

### 1. HTMX 업데이트

- 기존: `2.0.4`
- 권장: `2.0.10`
- 이유:
  - 같은 2.x 라인에서 안정적인 최신 패치 적용
  - 현재 구조(HTML partial + polling)를 유지하면서 최신성만 보강 가능

### 2. Bootstrap Icons 업데이트

- 기존: `1.11.3`
- 권장: `1.13.1`
- 이유:
  - 아이콘셋 최신화
  - 현재 dense admin UI와 잘 맞는 delivery 방식 유지

### 3. CDN -> self-host 전환

- 대상:
  - HTMX
  - Bootstrap Icons CSS
  - Bootstrap Icons font files
- 이유:
  - 로컬 툴 성격과 더 잘 맞음
  - 외부 CDN 가용성/변경에 덜 의존
  - 재현성과 공급망 통제 개선

## 지금 하지 않는 항목

### Actix -> Axum 마이그레이션

- 보류 이유:
  - 현재 사용자 가치가 작음
  - 라우팅/handler/extractor 전반 재작업 필요
  - 현재 병목이 framework choice에서 오고 있지 않음

### HTMX -> SPA 전환

- 보류 이유:
  - 현재 UI는 table + partial refresh 중심이라 HTMX 적합도가 높음
  - 상태관리/빌드/번들 복잡도만 증가할 가능성이 큼

## 중기 재평가 조건

아래가 roadmap에 들어오면 다시 본다.

- API surface 확대
- middleware 재사용 요구 증가
- observability / auth / service composition 확대
- richer client-side local interaction 증가

## 권장 순서

1. self-host된 HTMX/Icons 적용
2. bun-webview로 렌더/interaction 회귀 확인
3. 이후 필요 시 Alpine.js 보조 도입 검토

## 상태

이 문서 작성 시점 기준으로 1, 2, 3은 실행 가치가 높고,
Actix -> Axum / HTMX -> SPA는 관찰 대상이지 즉시 실행 대상은 아니다.
