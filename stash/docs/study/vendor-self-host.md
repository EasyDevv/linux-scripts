# vendor self-host study

기준일: 2026-07-08

## 주제

왜 `stash` 같은 로컬 도구에서 외부 CDN 대신 `vendor self-host`를 선택하는가.

여기서 `vendor self-host`는 다음을 뜻한다.

- 외부 라이브러리 파일을 프로젝트 안에 보관
- 서버가 그 파일을 직접 서빙
- 브라우저는 외부 CDN이 아니라 로컬 앱 주소에서 자산을 받음

현재 `stash`에서는 다음 자산이 이 방식으로 들어가 있다.

- HTMX `2.0.10`
- Bootstrap Icons `1.13.1`

## 한 줄 결론

`stash`는 공개 웹서비스보다 로컬 실행 도구에 가깝기 때문에, 자산 delivery도 "인터넷 의존 최소화" 쪽이 더 잘 맞는다.

## CDN 방식의 장점

먼저 CDN 방식이 왜 흔한지부터 보면:

- 설정이 빠르다
- 파일을 repo에 넣지 않아도 된다
- 다른 사이트에서 이미 캐시돼 있을 가능성이 있다
- 초기에 실험할 때는 가장 간단하다

즉, "일단 붙여보기"에는 CDN이 강하다.

## 그런데 stash에서는 왜 self-host가 더 맞나

### 1. 제품 성격이 로컬 툴이다

`stash`는 일반적인 public web app이 아니다.

- 로컬 포트에서 뜬다
- 개인 환경에서 쓴다
- 네트워크 조건이 항상 안정적이라고 가정하기 어렵다
- VPN, 로컬 파일시스템, 로컬 SQLite 같은 요소와 같이 움직인다

이런 성격의 도구는 "앱은 로컬인데 프론트 자산은 외부 인터넷에 의존"하는 구성이 어색하다.

### 2. 재현성이 좋아진다

CDN을 쓰면 코드가 같아도 실제 런타임은 외부 상태에 영향을 받는다.

예를 들면:

- CDN 장애
- 파일 교체
- redirect 정책 변경
- corporate network / firewall / adblock 영향
- offline 상태

self-host는 repo와 배포물에 포함된 파일이 그대로 실행되므로,
"이 버전의 앱은 이 버전의 자산으로 돈다"가 더 분명해진다.

로컬 툴일수록 이 재현성이 중요하다.

### 3. 공급망 통제가 쉬워진다

외부 script/link는 결국 실행 시점 의존성이다.

self-host로 바꾸면:

- 어떤 파일을 쓰는지 명확해지고
- 버전 업데이트를 의도적으로만 하게 되고
- 코드 리뷰 안에서 변경이 보이고
- 해시가 바뀌는 시점도 추적 가능하다

즉, 보안 과장 없이 말하면 "통제 범위가 repo 안으로 들어온다"는 점이 크다.

### 4. 앱 부팅 실패 면이 줄어든다

현재 `stash` UI는 아주 작다.

- HTMX 한 파일
- icon CSS + font 몇 개

이 정도 자산은 용량이 작아서 앱과 같이 싣는 비용이 거의 없다.

반면 CDN 장애가 나면 앱 자체는 떠도 UI가 깨질 수 있다.

로컬 툴에서는 이 trade-off가 잘 안 맞는다.

작은 자산을 같이 들고 가는 편이 더 단순하다.

### 5. 장기 캐시 전략이 쉬워진다

self-host + 버전 파일명 조합이면 캐시 정책이 깔끔해진다.

예:

- `/ui/vendor/htmx/htmx-2.0.10.min.js`
- `/ui/vendor/bootstrap-icons/font/bootstrap-icons.min.css`

이런 식으로 파일명이 버전 고정이면 브라우저에는:

`Cache-Control: public, max-age=31536000, immutable`

를 줘도 안전하다.

즉,

- 자주 안 바뀌는 파일은 강하게 캐시
- 버전이 바뀌면 URL이 바뀜

이 패턴을 단순하게 가져갈 수 있다.

### 6. bun-webview / 테스트 환경과도 잘 맞는다

지금 `stash`는 브라우저 자동화와 회귀 검증을 자주 한다.

이때 self-host 자산은 다음 장점이 있다.

- 테스트가 외부 CDN availability에 안 흔들림
- 로컬 서버 하나만 살아 있으면 됨
- 스냅샷/DOM 회귀가 더 안정적임

즉, 테스트 루프가 더 deterministic 해진다.

## self-host의 단점

중립적으로 보면 단점도 있다.

### 1. repo가 약간 커진다

라이브러리 파일과 폰트를 같이 들고 가므로 저장소 크기가 조금 늘어난다.

다만 현재 `stash` 규모에서는 이 비용이 작다.

### 2. 업데이트를 직접 관리해야 한다

CDN URL은 버전만 바꾸면 끝나는 경우가 많지만,
self-host는 파일을 받아오고 교체하는 절차가 필요하다.

즉, 유지보수는 약간 더 명시적이다.

하지만 이건 단점이면서 장점이기도 하다.
의도치 않은 업데이트가 줄기 때문이다.

### 3. 라우트/정적 파일 서빙 코드가 필요하다

이번처럼 `/ui/vendor/{path:.*}` 같은 route와 MIME 처리, path safety 체크가 필요하다.

그래도 한 번 만들고 나면 이후 비용은 거의 없다.

## stash 기준 판단

`stash`에서 self-host가 맞는 이유를 짧게 다시 정리하면:

1. 로컬 툴이다
2. 자산 수가 작다
3. deterministic 실행이 중요하다
4. 외부 네트워크 의존을 줄일수록 운영 성질과 맞다
5. 버전 고정 + 장기 캐시가 쉽다

그래서 `stash`에서는 CDN의 편의보다 self-host의 통제성이 더 큰 이익을 준다.

## 언제 CDN이 더 맞을 수도 있나

반대로 아래 조건이면 CDN이 더 자연스러울 수 있다.

- public website
- 아주 빠른 프로토타입
- asset bundling/serving을 별도 관리하고 싶지 않음
- shared cache 효과를 노리고 싶음

즉, self-host는 보편 정답이 아니라 `stash`의 제품 성격에 맞는 선택이다.

## 현재 적용 상태

현재 `stash`는 다음처럼 self-host되어 있다.

- HTMX: `/ui/vendor/htmx/htmx-2.0.10.min.js`
- Bootstrap Icons CSS: `/ui/vendor/bootstrap-icons/font/bootstrap-icons.min.css`
- Bootstrap Icons fonts: `/ui/vendor/bootstrap-icons/font/fonts/*`

또한 vendor 자산에는 장기 캐시 헤더가 붙어 있다.

- `Cache-Control: public, max-age=31536000, immutable`

## 실무 메모

앞으로 비슷한 자산을 추가할 때는 아래 원칙을 유지하면 된다.

1. 작은 third-party static asset은 `web/vendor/` 아래에 둔다
2. 버전이 드러나는 파일명을 유지한다
3. 서버는 vendor 자산만 장기 캐시한다
4. app shell 자체(`index.html`, partial)는 공격적으로 캐시하지 않는다

이렇게 하면 실행 안정성과 업데이트 통제가 같이 잡힌다.
