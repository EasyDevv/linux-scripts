# stash

파일 검색/체크/다운로드 마크 + VPN 강제 static 다운로드 + 간단한 웹 UI를 제공하는 단일 Actix 바이너리.

## 기능

- 허용된 루트 아래 파일 검색과 존재/다운로드 여부 확인
- SQLite 기반 다운로드 파일 기록
- SOCKS VPN 강제 static 다운로드 잡 생성, 조회, 취소, 재시도
- 앱 재시작 후 `running` 잡 복구와 주기적 재시도 스케줄러
- `/` 에서 잡/파일 상태를 보는 HTMX 기반 웹 UI

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
POST /ui/files/clear-selected
POST /ui/files/delete-selected
POST /ui/files/delete
POST /ui/files/retry
```

### JSON API

```
GET  /stash/files?limit=<n>
POST /stash/files/search          {"query":"mp4","under":"/mnt/shared","limit":20}
POST /stash/files/check           {"path":"/mnt/shared/video.mp4"}
POST /stash/downloads/mark        {"path":"/mnt/shared/video.mp4","url":"...","src_url":"...","note":"..."}
POST /stash/jobs/static           {"url":"https://route/...","src_url":"https://actual-source/...","filename":"video.mp4","referer":"...","origin":"...","headers":[{"name":"Referer","value":"..."}]}
GET  /stash/jobs?limit=50
GET  /stash/page-status?url=https://example.com/video/
GET  /stash/jobs/{id}
POST /stash/jobs/{id}/cancel
POST /stash/jobs/{id}/retry
GET  /stash/test/fixture
GET  /stash/test/userscript.user.js
```

### 응답 개요

- `/health`: `bind`, `download_root`, `sqlite_path`, `allowed_roots`, `vpn_connected`, `vpn_location`, `database_ok`
- `/stash/files/search`: `results[] = { path, name, size, modified_at, downloaded }`
- `/stash/files/check`: `{ path, exists, is_file, size, modified_at, downloaded }`
- `/stash/downloads/mark`: `{ path, downloaded, downloaded_at }`
- `/stash/jobs`: `{ results: JobResponse[] }`
- `/stash/page-status`: `{ jobs: JobResponse[], files: DownloadedFileRow[] }` matched by source page URL
- `/stash/jobs/{id}`: `{ id, url, src_url, filename, status, total_bytes, downloaded_bytes, error?, file_path?, created_at, completed_at? }`

## 설정

기본 경로는 `~/.config/stash/config.toml`.

```toml
bind = "127.0.0.1:38481"
sqlite_path = "/mnt/shared/file.db"
allowed_roots = ["/mnt/shared"]
max_results = 100

download_root = "/mnt/shared"
temp_root = "/mnt/shared/.stash"

[download]
default_concurrency = 3
max_concurrency = 3
chunk_size_bytes = 8388608
user_agent = "stash/0.1"

[scheduler]
poll_interval_secs = 2
resume_on_start = true
progress_flush_interval_ms = 1000

[retry]
max_retries = 5
retry_interval_secs = 30

[vpn]
command = "/usr/local/bin/adguardvpn-cli"
socks_url = "socks5h://127.0.0.1:1080"
auto_connect = true
connect_command = ["connect", "-l", "tokyo"]
connect_timeout_secs = 20
verify_before_each_job = true
required_location = "tokyo"
required_mode = "socks"
auto_rotate_on_ip_block = true
excluded_locations = ["Seoul"]
```

메모:

- `allowed_roots` 와 `download_root` 는 없으면 자동 생성된다.
- `sqlite_path` 상위 디렉터리도 없으면 자동 생성된다.
- `under` 와 `path` 입력은 항상 `allowed_roots` 경계 안에서 검증된다.

## 실행

```bash
cargo build --release
/var/tmp/stash-cargo-target/release/stash ~/.config/stash/config.toml
```

`.cargo/config.toml` 이 빌드 산출물(`target-dir`)을 `/var/tmp/stash-cargo-target` 으로 보낸다. `/tmp` 는 tmpfs(RAM) 라서 큰 빌드 캐시는 `/var/tmp` (디스크) 를 쓴다.

추가 옵션:

- `--port 38481`
- `--port=38481`

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
- Jobs와 Files 표는 헤더를 눌러 오름차순/내림차순 정렬하며 HTMX 갱신 후에도 현재 정렬을 다시 적용한다.

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
  web.rs        - 웹 자산 로드와 HTMX partial 핸들러
web/
  index.html    - 메인 UI
  app.css       - UI 스타일
  app.js        - 선택/새로고침 보조 스크립트
  vendor/       - htmx, bootstrap-icons 정적 자산
fixtures/
  video-fixture.html  - 테스트용 fixture 페이지
```

## 개발

프론트엔드(`web/`) 파일을 수정하면 서버가 요청마다 디스크에서 다시 읽으며, 브라우저가 600ms 간격으로 변경을 감지해 자동 새로고침한다. 서버 재시작이 필요 없다.

## 테스트

```bash
cargo test
```
