# stash

단일 Actix 바이너리. 카탈로그·실행·API는 `README.md`. UI 제약은 `.agents/rules/stash-ui.md`.

- `under` / `path`는 `allowed_roots` 안에서만 받는다.
- 릴리스 산출물은 `/var/tmp/stash-cargo-target` (`/tmp` tmpfs 금지).
- 프론트는 `stash/web/` 디스크 로드. Vite/Svelte/shadcn 컴파일러를 넣지 않는다.
- Jobs/Files 표는 `createTableLive` JSON 패치. tbody `innerHTML` 주기 교체 금지.
- 검증: `cargo test`.
