# stash

파일 검색/체크/다운로드 마크 + VPN 강제 static 다운로드 + 간단한 웹 UI를 제공하는 단일 Actix 바이너리.

에이전트 제약은 `AGENTS.md`와 `.agents/rules/stash-ui.md`.

## 기능

- 허용된 루트 아래 파일 검색과 존재/다운로드 여부 확인
- SQLite 기반 다운로드 파일 기록
- SOCKS VPN 강제 static 다운로드 잡 생성, 조회, 취소, 재시도
- 앱 재시작 후 `running` 잡 복구와 주기적 재시도 스케줄러
- `/` 에서 잡/파일 상태를 보는 웹 UI (명령은 HTMX, 표는 `createTableLive`)

## API

### 페이지 및 UI

```
GET  /
GET  /health
GET  /ui/app.css
GET  /ui/app.js
GET  /ui/vendor/{path}
GET  /ui/partials/jobs-count
GET  /ui/partials/files-count
GET  /ui/partials/jobs
GET  /ui/partials/files
GET  /ui/partials/vpn
POST /ui/jobs/{id}/cancel
POST /ui/jobs/{id}/retry
POST /ui/jobs/retry-failed
POST /ui/jobs/{id}/clear
POST /ui/jobs/clear-selected
POST /ui/jobs/clear-completed
POST /ui/files/clear-selected
POST /ui/files/delete-selected
POST /ui/files/delete
POST /ui/files/retry
```

### JSON API

```
GET  /stash/files?limit=100
POST /stash/files/search          {"query":"mp4","under":"/mnt/shared","limit":20}
POST /stash/files/check           {"path":"/mnt/shared/video.mp4"}
POST /stash/downloads/mark        {"path":"/mnt/shared/video.mp4","url":"...","src_url":"...","note":"..."}
POST /stash/jobs/static           {"url":"https://route/...","src_url":"https://actual-source/...","filename":"video.mp4","referer":"...","origin":"...","headers":[{"name":"Referer","value":"..."}]}
GET  /stash/jobs
GET  /stash/jobs?limit=50
GET  /stash/page-status?url=...
GET  /stash/jobs/{id}
POST /stash/jobs/{id}/cancel
POST /stash/jobs/{id}/retry
GET  /stash/test/fixture
GET  /stash/test/userscript.user.js
```

### 응답 개요

- `/health`: `bind`, `download_root`, `sqlite_path`, `allowed_roots`, `vpn_connected`, `vpn_location`, `database_ok`
- `/stash/files`: `{ results: DownloadedFileRow[] }`
- `/stash/files/search`: `results[] = { path, name, size, modified_at, downloaded }`
- `/stash/files/check`: `{ path, exists, is_file, size, modified_at, downloaded }`
- `/stash/downloads/mark`: `{ path, downloaded, downloaded_at }`
- `/stash/jobs`: `{ results: JobResponse[] }` (`limit` 생략 시 전체)
- `/stash/page-status`: `{ jobs: JobResponse[], files: DownloadedFileRow[] }` matched by source page URL
- `/stash/jobs/{id}`: `{ id, url, src_url, filename, status, total_bytes, downloaded_bytes, error?, file_path?, created_at, completed_at? }`

## 설정

기본 경로는 `~/.config/stash/config.toml`. 필드와 기본값은 `src/config.rs`.

최상위: `bind`, `sqlite_path`, `allowed_roots`, `max_results`, `download_root`, `temp_root`.
`[download]`: `default_concurrency`, `max_concurrency`, `chunk_size_bytes`, `user_agent`, `media_proxy_file`, `media_proxy_referer_hosts`.
`[scheduler]`: `poll_interval_secs`, `resume_on_start`, `progress_flush_interval_ms`.
`[retry]`: `max_retries`, `retry_interval_secs`.
`[vpn]`: `command`, `socks_url`, `auto_connect`, `connect_command`, `connect_timeout_secs`, `verify_before_each_job`, `required_location`, `required_mode`, `auto_rotate_on_ip_block`, `excluded_locations`.

메모:

- `allowed_roots` 와 `download_root` 는 없으면 자동 생성된다.
- `sqlite_path` 상위 디렉터리도 없으면 자동 생성된다.
- `under` 와 `path` 입력은 항상 `allowed_roots` 경계 안에서 검증된다.

### Blocked 복구 정책

- 403은 IP 차단을 확정하는 근거가 아니다. 안전한 미시도 대체 소스가 있으면 전환하고, 없으면 원래 오류를 보존한 채 `failed`/Blocked로 끝낸다. 후보 목록 유무에 따라 같은 요청을 무한 재시도하지 않는다.
- 과거 `retry_wait`에 남은 403·Expired·Gone 같은 비재시도 오류는 스케줄러가 정리한다. 실행 중인 워커, 일시 오류 재시도, 사용자가 지운 잡/파일은 재생성하거나 중단하지 않는다. 기존 코드도 403 대기 잡은 슬롯 수에서 제외한다.
- `auto_rotate_on_ip_block`/`excluded_locations`는 이전 설정과의 호환을 위해 남아 있지만, 단순 HTTP 403에 의한 자동 VPN 회전에는 더 이상 사용하지 않는다. 수동 VPN 설정 기능은 유지한다.
- 대체 소스 전환 중 DB 잠금을 잡은 채 캐시 디렉터리를 지우지 않는다. 목록별 캐시 식별자가 소스 혼합을 막는다.

### MissAV CDN의 Chrome 호환 전송

정확히 `https://surrit.com`인 HLS 목록과 세그먼트는 `/usr/bin/curl-impersonate`와 내장 Chrome 131 프로필(`src/browser_tls_profile.conf`, 배포판 `curl_chrome131` 기준)로 요청한다. **이 실행 파일이 설치되어 있어야 한다.** 기존 `vpn.socks_url`을 그대로 사용하며 IP/VPN 위치는 바꾸지 않는다. `recordplay.biz`/`playrecord.biz`용 명시적 HTTPS 프록시 경로가 설정되어 있으면 그 경로가 우선한다.

브라우저/CDP는 필요 없다. 실행 인자에 URL·프록시 자격 증명·헤더를 넣지 않고 stdin 설정으로 전달한다. 각 요청의 호스트를 검사하고 리다이렉트를 따라가지 않는다. 셸 없이 프로세스를 직접 관리하며, 시간 제한·읽는 도중의 응답 크기 제한·취소 시 종료를 적용한다. 원시 stderr나 자격 증명을 오류에 노출하지 않는다.

2026-09-08 비교: 동일한 surrit URL이 일반 curl에서는 Cloudflare 403, Chrome 호환 요청에서는 직접 연결과 기존 SOCKS 모두 정상 M3U8 200을 반환했다. 이 결과는 요청 프로필의 효과이며 모든 사이트의 403을 같은 원인으로 분류하지 않는다. 예를 들어 확인한 Google Storage 403은 `UserProjectAccountProblem`(원본 프로젝트 결제 계정 부재)로, 요청 프로필이나 VPN 변경으로 고칠 수 없다.

### 브라우저와 독립적인 HLS 요청 경로

`download.media_proxy_file`과 `media_proxy_referer_hosts`를 설정하면 **Referer 호스트가 정확히 일치하는 잡의 HLS 목록·세그먼트**는 해당 HTTPS 프록시를 사용하는 네이티브 `reqwest` 경로로 고정된다. 설정하지 않으면 기존 SOCKS 경로를 유지한다. 중간에 두 경로를 섞지 않는다. Chrome/CDP, 확장 프로그램, 열린 영상 탭은 다운로드에 필요하지 않다.

```toml
[download]
media_proxy_file = "/absolute/private/path/media-proxy.json"
media_proxy_referer_hosts = ["recordplay.biz", "playrecord.biz"]
```

별도 JSON 파일 형식은 `{"url":"https://proxy.example:443","username":"...","password":"..."}`. 일반 파일·소유자 전용 권한(`chmod 600`)만 허용한다. 실제 인증 정보는 저장소, 잡의 `headers_json`, 로그에 넣지 않는다. 프록시 인증이 만료되어 HTTP 407이 나오면 이 파일의 인증 정보를 갱신해야 한다. 자동으로 브라우저의 자격 증명을 읽거나 VPN 위치를 변경하지 않는다.

자격 증명은 AdGuard VPN 확장 프로그램이 세션마다 교체하므로 손으로 복사하면 다시 낡는다. `scripts/sync-media-proxy.ts`가 CDP로 확장의 `chrome.storage.local.proxy_config`를 읽어 `media_proxy_file`을 갱신한다(`bun test scripts` 18건, `--check`로 쓰기 없이 비교, `--verify`로 프록시 CONNECT 확인, 비밀 값은 sha256 앞 12자만 출력).

```bash
bun scripts/sync-media-proxy.ts --check          # 갱신 필요 여부만 확인
bun scripts/sync-media-proxy.ts --verify         # 갱신 후 프록시 경유 확인
```

`worker_cdp_url`·`media_proxy_file`은 `config.toml`에서 읽고, 확장 ID는 CDP 타깃에서 먼저 찾고 없으면 `--profile`(기본 `~/dev/tampermonkey/.user-data/chrome-tampermonkey`)의 `Extensions/`를 스캔한다. 확장의 현재 엔드포인트가 바뀌면 호스트도 함께 갱신하고 경고한다(서명 URL은 ASN에 묶여 있어 위치가 바뀌면 403이 날 수 있다). `--keep-host`로 기존 호스트를 고정할 수 있다.

프록시 CONNECT가 407로 거절되면 `reqwest`는 응답이 아닌 연결 오류를 돌려주므로 잡에는 `media route connection failed`로 기록되고, `classify_failure_for`는 이를 일시 오류로 보아 `[retry] max_retries`만큼 재시도한 뒤 `failed`로 끝난다. UI도 `Failed`로만 표시하고 Expired/Blocked로 분류하지 않는다.

소스가 특정 IP/ASN에 묶인 경우 URL을 발급받은 경로와 다운로드 경로를 맞춰야 한다. 2026-09-07 대조에서는 브라우저의 AdGuard 도쿄 HTTPS 경로와 CLI의 라고스 SOCKS 경로가 달랐으며, 같은 도쿄 경로에서는 일반 curl도 HLS를 HTTP 200으로 받았다. 서명 URL의 403만으로 실제 만료나 TLS 지문 차이를 단정하면 안 된다.

대체 소스는 기존 크기 제한(2배 이상 차이 제외)과 시도 기록을 따르고, 사용한 소스를 잡에 저장한다. 세그먼트 재개 캐시는 해석된 목록(순서·초기화 세그먼트 포함)별로 분리해 다른 소스의 파일을 혼합하지 않는다.

HLS 합치기는 `#EXTINF`의 유효한 길이를 파일·스트리밍 FIFO 양쪽 concat 목록에 전달한다. 컨테이너가 추정한 개별 길이를 누적하면 영상·음성 시작 시각 차이가 쌓일 수 있다. 실제 검증에서는 3620.754초 원본이 기존 방식으로 3671.902초가 됐으나 수정 후 3620.852초가 됐다. 파일 경로 이스케이프는 공통 함수를 사용한다.

2026-09-08 대표 검증: MissAV 기존 Blocked 3건이 전체 다운로드·h264/AAC·길이 검사를 통과했다(원본과 차이 0.10/0.14/0.07초). 회귀 테스트 108개 통과. 이는 대표 3건 검증이며 10건 전체 게이트 통과를 뜻하지 않는다. 나머지 과거 실패 기록을 지우거나 자동 재개하지 않는다.

HLS 다운로드 단계의 정체 감시는 세그먼트 전체 재시도 예산보다 길게 잡는다(현재 180초 × 3회 + 재시도 간격 4초 + 여유 60초 = 604초). 일반 다운로드의 120초 기준으로 HLS 워커를 먼저 취소해 재시도 횟수를 소진하지 않도록 별도 마감 시각을 사용한다.

## 실행

```bash
cargo build --release
/var/tmp/stash-cargo-target/release/stash ~/.config/stash/config.toml
```

감독 실행(executor)은 `scripts/stash-run.sh`를 진입점으로 쓴다. 래퍼가 `sync-media-proxy.ts --quiet`를 먼저 실행한 뒤 stash를 `exec`하므로 stash가 뜰 때마다 media proxy 자격 증명이 맞춰진다(Chrome·확장·bun이 없으면 경고만 남기고 stash는 그대로 시작한다). `~/.config/systemd/user/executor.json`의 `stash.cmd`가 이 래퍼를 가리키며, 래퍼 시작 시에만 동기화하므로 stash가 유휴일 때나 잡마다 드는 비용은 없다.

`.cargo/config.toml` 이 빌드 산출물(`target-dir`)을 `/var/tmp/stash-cargo-target` 으로 보낸다. `/tmp` 는 tmpfs(RAM) 라서 큰 빌드 캐시는 `/var/tmp` (디스크) 를 쓴다.

추가 옵션:

- `--port 38481`

설정 파일 경로를 주지 않으면 `~/.config/stash/config.toml` 을 사용한다.

## 동작 메모

- 시작 시, 다운로드 전, 실행 중 10초마다 `adguardvpn-cli status` 와 `config show` 로 VPN 위치/모드를 검사한다. 연결이 끊겼거나 상태를 읽을 수 없으면 마지막으로 성공한 UI 선택 위치(없으면 기본 Tokyo)에 자동 재연결한다. `You are not logged in`이면 재연결하지 않고 `adguardvpn-cli logged out`으로 실패한다.
- static 작업이 `HTTP 403 Forbidden`으로 재시도 대기 상태가 되면 다른 활성 작업이 모두 끝난 뒤 VPN 위치를 자동 순환한다. `excluded_locations`는 순환 대상에서 제외하며 기본값은 `Seoul`이다.
- UI에서 성공적으로 바꾼 VPN 위치, Browser-HLS 레벨, 동시 다운로드 수, 큐 모드(`src_domain` 기본 / `url_domain` / `global`)는 SQLite `app_settings`에 저장되며, 앱 재시작 후에도 복원된다. HLS 저장값이 없으면 1x를 사용한다. `src_domain`은 `src_url` 호스트별로, `url_domain`은 `url` 호스트별로 동시 다운로드 수를 제한하고, 다른 도메인은 대기 없이 시작한다. Retry all failed jobs도 같은 제한을 적용해 한도에 든 작업만 시작하고 나머지는 `queued`로 둔다. VPN 로그아웃은 상태 배지를 `VPN Error`로, 우측 상단 드롭다운을 `VPN logged out`으로 표시한다.
- Range 지원과 파일 크기를 probe 한 뒤, 큰 파일은 멀티 청크 다운로드를 시도한다.
- 완료 파일은 `download_root/<sanitized filename>` 으로 복사되고 `downloaded_files` 에 자동 마크된다.
- UI의 파일 삭제는 디스크 파일과 SQLite 기록을 함께 지운다. 파일 clear 는 SQLite 기록만 지운다.
- Files retry는 목록 기록을 제거하고 작업을 다시 큐에 넣는다. 기존 파일이 있으면 교체 확인창을 표시하며 디스크 파일은 새 결과가 완료될 때까지 유지한다.
- Segment는 Browser-HLS 작업에만 적용된다. 직접 다운로드 작업에는 `—`를 표시한다.
- Jobs와 Files 표는 헤더로 정렬한다. live 패치 중 이름 정렬은 행을 옮기지 않고, progress/speed/size 정렬은 쓰로틀한다.

## 의존성

- `adguardvpn-cli` - SOCKS 모드 확인 및 자동 접속
- `rusqlite` - 다운로드 파일/잡 메타데이터 저장
- `reqwest` - SOCKS 프록시 경유 HTTP 다운로드
- `tokio` - 잡 실행, 스케줄러, 파일 I/O

## 구조

```
src/
  main.rs       - 라우트 등록, 상태 초기화, 잡 생성/조회 API
  config.rs     - TOML 설정 로더와 기본값
  store.rs      - SQLite 스키마, 파일 검색/체크, 다운로드/잡 저장소
  downloads.rs  - VPN 검사, HTTP 다운로드, 재시도 스케줄러, 재시작 복구
  web.rs        - 웹 자산 로드와 HTML partial 팩토리
web/
  index.html    - 메인 UI 셸
  app.css       - UI 스타일
  app.js        - createTableLive, 선택/정렬/컬럼
  vendor/       - htmx, bootstrap-icons 정적 자산
fixtures/
  video-fixture.html  - 테스트용 fixture 페이지
```

## 개발

프론트엔드(`web/`) 파일을 수정하면 서버가 요청마다 디스크에서 다시 읽으며, 브라우저가 600ms 간격으로 변경을 감지해 자동 새로고침한다. 서버 재시작이 필요 없다.

표 live 경로는 `GET /stash/jobs`·`GET /stash/files` JSON 패치다. `/ui/partials/jobs`·`/ui/partials/files`는 행 삽입용이다.

## 테스트

```bash
cargo test
```
