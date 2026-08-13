# stash tech stack

## Backend

| 언어 | Rust (edition 2024) |
|---|---|
| 웹 프레임워크 | [actix-web](https://actix.rs) 4 |
| SQLite | [rusqlite](https://github.com/rusqlite/rusqlite) 0.32 (bundled) |
| HTTP 클라이언트 | [reqwest](https://docs.rs/reqwest) 0.12 (socks + rustls-tls) |
| 비동기 런타임 | [tokio](https://tokio.rs) 1 (full) |
| 직렬화 | [serde](https://serde.rs) 1 + serde_json + serde_urlencoded 0.7 |
| 설정 | [toml](https://docs.rs/toml) 0.8 |
| 로깅 | [tracing](https://docs.rs/tracing) 0.1 + tracing-subscriber (env-filter) |
| UUID | [uuid](https://docs.rs/uuid) 1 (v4) |
| 파일 시스템 탐색 | [walkdir](https://docs.rs/walkdir) 2 |

## Frontend (in-browser)

| 항목 | 현재 |
|---|---|
| HTMX | self-host `2.0.10` at `/ui/vendor/htmx/htmx-2.0.10.min.js` |
| 아이콘 | self-host `bootstrap-icons@1.13.1` at `/ui/vendor/bootstrap-icons/font/bootstrap-icons.min.css` |
| 아이콘 폰트 | self-host `woff` / `woff2` at `/ui/vendor/bootstrap-icons/font/fonts/` |
| CSS | 순수 CSS (`stash/web/app.css`) |
| JS | 순수 JS (`stash/web/app.js`) |

## Delivery

| 항목 | 현재 |
|---|---|
| HTML shell | Rust가 `stash/web/index.html` 로드 |
| partial rendering | Rust 서버가 HTML partial 직접 렌더링 |
| asset hosting | third-party vendor 자산을 `stash/web/vendor/`에 저장 후 서버가 직접 서빙 |
| vendor route | `/ui/vendor/{path:.*}` |
| vendor cache | `Cache-Control: public, max-age=31536000, immutable` |
| web asset path resolution | CWD 우선, 실행 파일 기준 경로와 `CARGO_MANIFEST_DIR` fallback |
