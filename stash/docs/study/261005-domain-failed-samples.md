# 도메인별 failed 샘플 분석 (sexbjcam / missav / pornavhd)

기준일: 2026-10-05. `http://stash.localhost/`의 failed 아이템을 도메인별로 2건씩 골라
원인을 분류하고, 다시 요청했을 때 정상 다운로드되도록 stash와 userscript를 함께 고쳤다.
같은 작업에서 userscript 쪽 중복 코드와 비효율도 정리했다. [[260927-mpmux-and-finalize-failures.md]]의 후속 문서.

관련 코드:

- stash: `src/media_route.rs`, `src/downloads.rs`(`classify_failure_for`), `src/config.rs`,
  `scripts/sync-media-proxy.ts`
- userscript(`~/dev/tampermonkey/projects/video`):
  `packages/stash-engine/src/{durable-source,download-engine,gm-request,list-button,media-probe,stash-client}.ts`,
  `video-downloader/src/media/detector.ts`, `missav/src/sites/missav.ts`, `sexbjcam/src/main.ts`

## 한 줄 결론

실패 원인은 도메인별로 하나씩이 아니라 다음 세 가지 버그가 겹친 결과였다.
① AdGuard 프록시 비밀번호가 바뀌었는데 stash는 예전 값을 계속 썼다.
② MissAV 관련 영상의 `preview.mp4`가 실제 HLS보다 높은 점수를 받아 소스로 선택됐다.
③ 닫힌 탭이 남긴 `downloading` 상태가 같은 페이지의 새 다운로드를 조용히 막았다.

## 1. 시작 시점 현황

| 도메인 | failed | 대표 오류 |
|---|---|---|
| sexbjcam.com | 49 | `exceeded max browser-hls restart attempts` 40, `media route connection failed` 3, 502·522·404 |
| missav01.com | 7 | `downloaded file is too small` 5, surrit `media route connection failed`, named pipe timeout |
| pornavhd.com | 3 | `media route: HTTP 504`, `media route body timed out`, packed URL 404 |

그 밖의 상태: `queued` 49, `retry_wait` 3. `retry_wait` 3건은 모두 `media route connection failed`였다.

## 2. 샘플과 원인

| 도메인 | 샘플 | 이전 오류 | 원인 | 조치 후 소스 |
|---|---|---|---|---|
| missav | fns-247 | too small (139528 B) | 사이드바 관련 영상 CJOD-527의 `fourhoi.com/cjod-527/preview.mp4`가 선택됨 | `surrit.com/.../1080p/video.m3u8` |
| missav | dm31/jyma-004 | surrit connection failed (383 MB 진행 후) | 일시적인 연결 실패. 재요청하자 정상 진행 | `surrit.com/.../playlist.m3u8` |
| pornavhd | spgymn_30 | media route 504 | 그 당시 프록시와 CDN의 일시 오류. 재요청은 ③에 막혀 있었음 | 내구성 `master.txt` |
| pornavhd | retsu_dao_78 | 404 | 서명된 packed URL(`s=`, `e=`, `asn=`)이 만료됨 | 내구성 `master.txt` |
| sexbjcam | kbj26062917_kimbbem5018 | browser-hls 재시작 한도 초과 | 폐기된 browser-hls 경로의 잔여 잡. CDP 워커 포트 12345가 꺼져 있음 | 내구성 `master.txt` (static) |
| sexbjcam | kbj26012771_gpfladl2003 | fetch text 502 | 1월에 저장된 CDN 호스트가 죽어 있음 | 새 CDN 호스트의 `master.txt` |

## 3. 원인 상세

### ① 프록시 자격 증명 만료가 `connection failed`로 보였다

`recordplay.biz` / `playrecord.biz` Referer 잡은 `media_proxy_file`의 AdGuard HTTPS 프록시를 거친다.
AdGuard 확장은 세션마다 비밀번호를 바꾼다. 그런데 `sync-media-proxy.ts`는 stash가 시작될 때 한 번만 실행됐고,
그마저 Chrome CDP 12345를 읽도록 되어 있었다. 이날 12345는 꺼져 있었고 실제 브라우저는 Brave-Origin(12346)이었다.

- 프록시는 CONNECT에 407로 답했다. hyper-util은 이를 `TunnelError::ProxyAuthRequired`
  ("proxy authorization required")로 돌려주었다.
- 그런데 `fetch_via_proxy`는 reqwest 오류를 `media route connection failed` 하나로 뭉갰다.
  그 결과 일시 오류로 분류되어 재시도 5회를 모두 쓰고 failed로 끝났다.
- `--cdp-port 12346`으로 동기화하자 비밀번호가 바뀌어 있음이 확인됐다(검증 CONNECT 200).
  같은 원인으로 failed가 된 sexbjcam 3건을 Retry하자 모두 completed가 됐다.

### ② `preview.mp4`가 HLS를 이겼다

`scoreStashSource`는 `.mp4`에 300점, `master.m3u8`에 200점, 일반 `.m3u8`에 150점을 준다.
MissAV 상세 페이지에서는 사이드바 썸네일에 마우스를 올리면 다른 작품의 `preview.mp4`가 로드되고,
detector가 이를 후보로 잡았다. 문제는 한 번으로 끝나지 않았다는 점이다.

1. 처음에 preview가 선택되면 잡은 `too small`로 실패한다.
2. 다음 방문 때 `syncPageStatus`가 그 failed 잡의 `src_url`을 다시 원격 후보로 가져온다.
3. 사용자가 다운로드를 누를 때마다 `pickStashCandidate`가 또 preview를 고른다.

실제로 이번 검증 도중 트리거를 한 번 누르자 같은 preview로 잡(0243c0b3)이 새로 생성되어 재현됐다.
missav 리스트 스크립트에는 preview 필터가 있었지만 video-downloader와 공용 선택 함수에는 없었다.

### ③ 오래된 로컬 상태가 페이지 전체를 막았다

`download-engine`은 GM 저장소에 후보와 상태를 남긴다. `enqueue`는 같은 `pageUrl`의 다른 항목 중
`downloading`이나 `downloaded-before`가 하나라도 있으면 `"active"` 또는 `"in-files"`를 반환하고 아무것도 하지 않는다.
spgymn_30에는 9월 26일 탭이 닫히면서 남은 `downloading` 7건과, 파일명만 보고 판정한 `downloaded-before` 3건이 있었다.
`syncPageStatus`는 settled 상태만 덮어썼으므로 이 항목들이 영구히 남았고, 트리거와 Retry 모두 조용히 무시됐다.
저장소는 한 페이지에 28개 항목이 쌓일 만큼 커졌고, `loadStore`가 호출될 때마다 전체가 파싱됐다.

### 기타

- `downloaded file is too small`, `browser HLS output is too small`은 다시 받아도 같은 결과인 결정론적 실패인데
  일시 오류로 분류되어 재시도 5회를 낭비했다.
- browser-hls 잡 40건은 `worker_cdp_url`(12345)이 꺼져 있어 진행될 수 없었다. 새 템플릿은 static 잡만 만든다.
- 522·521은 CDN 원본 서버 다운이다. 정상적인 일시 재시도 대상이다.

## 4. 수정

### stash

- `media_route.rs`
  - 오류 체인에서 407을 찾아 `media route proxy auth rejected`(일시 오류)로 보고한다.
    "http 407" 문구를 쓰지 않는 것은 영구 실패로 분류되지 않게 하려는 것이다.
  - `[download] media_proxy_sync_command`가 설정되어 있으면 프로세스 전체에서 60초에 한 번만 실행한다.
    실행 후 파일을 다시 읽어 client를 재생성하고, 실패한 요청을 한 번 재시도한다.
- `sync-media-proxy.ts`: `--cdp-port`가 없으면 `worker_cdp_url` 포트를 먼저 시도하고, 닫혀 있으면 12346으로 넘어간다.
- `classify_failure_for`: `file is too small`, `output is too small`은 `Permanent`로 분류한다.
- `config.toml`: `media_proxy_sync_command = [bun, sync-media-proxy.ts, --quiet]`를 추가했다.
- 결과: `cargo test` 120건 통과, `bun test scripts` 19건 통과. `executor reload stash`로 재기동했다.

### userscript

- `isPreviewClip`(`/preview.mp4`)을 `durable-source`에 두고 아래 모든 경로에서 제외한다.
  - 소스 추출: `extractMediaUrls`, `extractMediaUrlsFromHtml`
  - 소스 선택: `selectStashMediaUrl`
  - detector의 후보 추가: `addOrUpdate`
  - 원격 failed 잡을 후보로 되살리는 경로: `remoteCandidate`
- `syncPageStatus`가 페이지의 진실 공급원이다.
  - 이 탭에서 처리 중이거나 큐에 있는 항목이 아니면 원격 상태로 덮어쓴다.
  - 원격에 아무것도 없으면 `idle`로 되돌린다.
- `init`에서 큐에 없고 7일 넘게 갱신되지 않은 항목을 정리한다(`pruneStale`).
- 회귀 테스트를 추가했다.
  - `durable-source.test.ts`: preview 추출 제외, HLS 우선 선택
  - `download-engine.test.ts`: preview failed 잡이 원격 후보가 되지 않음,
    오래된 `downloading`이 `idle`로 풀리고 enqueue가 잡을 생성함.
    수정을 되돌리면 이 테스트가 실패하는 것도 확인했다.

### 중복과 비효율 정리

- 쓰지 않는 browser-hls 코드를 삭제했다.
  - `browser-hls-worker.ts`와 그 테스트
  - `stash-client`의 browser-hls 함수 6개와 `gmBinaryFetch`
  - engine의 `transport` 옵션
- re-export만 하던 파일을 지우고 패키지 경로로 직접 import한다.
  - video-downloader: `core/download-engine.ts`, `core/stash-client.ts`, `types.ts`
  - sexbjcam: `source-selection.ts`와 중복 테스트
- `GM_xmlhttpRequest` 래퍼 세 벌(missav·sexbjcam `fetchText`, `media-probe` `request`, `stash-client` `gmFetch`)을
  `gm-request.ts`(`gmRequest`, `fetchPageText`) 하나로 합쳤다.
- missav와 sexbjcam의 리스트 버튼 배치, MutationObserver, rAF 디바운스를 `list-button.ts`의
  `mountListButton`과 `observeListMounts`로 옮겼다. 이제 sexbjcam도 `href`가 제자리에서 바뀌는 경우를 다시 스캔한다.
- detector가 하던 불필요한 반복 작업을 줄였다.
  - 2초마다 리소스 버퍼 전체를 다시 읽던 것을 `PerformanceObserver`가 넘겨주는 새 항목만 처리하도록 바꿨다.
  - playrecord 페이지의 `innerHTML` 직렬화는 URL을 찾은 뒤에는 멈춘다.
- 합계: 28개 파일, 추가 250줄, 삭제 343줄.

## 5. 검증

- 설치: `update-tampermonkey-userscript.ts --port 12346 --user-data ~/.config/BraveSoftware/Brave-Origin`로
  missav·sexbjcam·video-downloader를 Brave에 직접 설치했다. 세 스크립트 모두 post-reload 해시 검증을 통과했다.
- 재요청: 6개 샘플을 실제 페이지에서 floating 트리거나 Retry 버튼으로 다시 요청했다.
  2026-10-05 기록 시점의 상태는 아래와 같다.

| 샘플 | 새 잡 | 상태 |
|---|---|---|
| missav fns-247 | 9ad93a23 | running 2175/2579 |
| missav jyma-004 | 3cd5d7a2 | **completed** 1788/1788 |
| pornavhd spgymn_30 | 5d432a9b | **completed** 166/166 |
| pornavhd retsu_dao_78 | 3c2cf209 | running 243/283 |
| sexbjcam kimbbem5018 | 3a13af7f | queued (sexbjcam 대기열 44건 뒤) |
| sexbjcam gpfladl2003 | af321781 | queued |

- 프록시를 고친 뒤 Retry한 sexbjcam 3건(kbj26092823·kbj26100323·kbj26100358)은 completed로 끝났다.
- 재요청 6건 중 2건(jyma-004, spgymn_30)이 completed, 2건은 진행 중, sexbjcam 2건은 대기 중이다. AGENTS.md의 합격 기준(종료 잡 10건 이상 중 completed 90% 이상)은 아직 판정할 수 없다.

## 6. 남은 일과 주의

- Chrome 12345가 꺼져 있으면 `bun run update:all`이 Chrome 단계에서 중단되어 Brave까지 가지 못한다.
  지금은 직접 설치 명령을 써야 한다.
- Tampermonkey를 다시 로드한 직후 약 15초 안에는 트리거 클릭이 잡을 만들지 못한 경우가 두 번 있었다.
  재시도하면 정상이었고 코드상의 원인은 찾지 못했다.
  `wv.ts nav`로 이동한 탭에서는 userscript가 주입되지 않은 적도 있었다. 이때는 `Page.navigate`나 `Page.reload`로 해결됐다.
- 나머지 sexbjcam failed 47건(browser-hls 잔여 40건 포함)은 페이지에서 다시 요청해야 한다.
  Retry Failed는 예전 `src_url`을 그대로 재사용하므로 만료되었거나 죽은 소스를 다시 받는다.
- `projects/video` 루트에서 테스트를 한꺼번에 실행하면 `mock.module` 누수로 `stash-client.test` 2건이 실패한다
  (이전에는 3건). 패키지별로 실행하면 모두 통과한다.
- `browser_hls.worker_cdp_url`은 여전히 12345를 가리킨다. 새 잡은 browser-hls를 쓰지 않으므로 그대로 두었다.
