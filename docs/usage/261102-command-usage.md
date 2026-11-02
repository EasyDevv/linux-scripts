# 공개 명령 호출 빈도와 Go 포팅 우선순위

- 집계일: 2026-11-02 · 재집계: `usage-stats` (`--markdown`, `--json`, `--days N`)
- 출처: fish 히스토리(2025-11-19~, 직접 입력), Claude Code `~/.claude/projects/**/*.jsonl`의 Bash 호출, pi `~/.pi/agent/sessions/**/*.jsonl`의 bash 호출
- 명령 위치(줄 시작, `| ; & (`, `sudo`, `$(`, `exec` 뒤)에서만 셉니다. `last_seen`은 UTC 날짜입니다.
- 빠진 것: hook·systemd·확장을 통한 자동 호출. 호출처만 아래에 적었습니다.

## 자동 호출처

| 명령 | 호출처 |
| --- | --- |
| executor | systemd `executor.service`, `~/.claude/settings.json` |
| decision | `~/.claude/settings.json` hook, pi extensions(`lib/grades.ts`, `session-model.ts`) |
| provider-usage | pi extensions(`usage-policy.ts`, `live-limits.ts` 등) |
| dlint | pi `auto-lint.ts` |
| browser | `.desktop` 파일 |
| sunshine-stream-start | `~/.config/sunshine/apps.json` |

## 집계

| command | fish | claude | pi | total | last30d | last_seen |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| executor | 29 | 483 | 537 | 1049 | 457 | 2026-11-01 |
| browser | 9 | 352 | 386 | 747 | 694 | 2026-11-02 |
| dlint | 0 | 358 | 46 | 404 | 326 | 2026-11-01 |
| phone | 0 | 96 | 129 | 225 | 205 | 2026-11-01 |
| decision | 0 | 65 | 4 | 69 | 64 | 2026-11-01 |
| port | 5 | 38 | 26 | 69 | 38 | 2026-10-30 |
| doc | 6 | 12 | 41 | 59 | 21 | 2026-10-31 |
| server | 7 | 15 | 17 | 39 | 21 | 2026-10-27 |
| zju | 34 | 0 | 0 | 34 | 0 | 2026-07-10 |
| provider-usage | 0 | 2 | 28 | 30 | 4 | 2026-10-20 |
| ship | 3 | 19 | 1 | 23 | 20 | 2026-11-02 |
| cli | 4 | 10 | 2 | 16 | 14 | 2026-11-02 |
| ovh-ssh-source | 0 | 0 | 14 | 14 | 0 | 2026-08-21 |
| init-vps | 7 | 0 | 5 | 12 | 0 | 2026-08-21 |
| file-sync | 2 | 1 | 8 | 11 | 1 | 2026-11-02 |
| dev-stack | 0 | 2 | 8 | 10 | 2 | 2026-10-05 |
| netbird-setup | 1 | 0 | 5 | 6 | 0 | 2026-08-21 |
| atree | 5 | 0 | 0 | 5 | 0 | 2026-09-19 |
| db-sync | 0 | 0 | 5 | 5 | 0 | 2026-08-24 |
| route-capture | 1 | 1 | 3 | 5 | 1 | 2026-10-25 |
| swap-opencode | 5 | 0 | 0 | 5 | 0 | 2026-08-14 |
| ts-ssh-guard | 1 | 0 | 4 | 5 | 5 | 2026-10-27 |
| bu | 2 | 1 | 0 | 3 | 1 | 2026-10-04 |
| usage-stats | 0 | 3 | 0 | 3 | 2 | 2026-11-02 |
| repo-watch | 2 | 0 | 0 | 2 | 0 | 2026-08-19 |
| set-rules | 1 | 1 | 0 | 2 | 2 | 2026-10-22 |
| clean-empty-dir | 1 | 0 | 0 | 1 | 0 | 2026-08-17 |
| count-lines | 1 | 0 | 0 | 1 | 0 | 2026-06-03 |
| moon-bun-init | 1 | 0 | 0 | 1 | 0 | 2026-04-11 |
| path-cleaner | 1 | 0 | 0 | 1 | 0 | 2026-05-02 |
| podman-deploy | 1 | 0 | 0 | 1 | 0 | 2026-05-20 |
| unlock-sudo | 1 | 0 | 0 | 1 | 0 | 2026-08-18 |
| wxt-zip-version | 1 | 0 | 0 | 1 | 0 | 2026-06-06 |
| db-snapshot | 0 | 0 | 0 | 0 | 0 | - |
| dev-all | 0 | 0 | 0 | 0 | 0 | - |
| git-delete | 0 | 0 | 0 | 0 | 0 | - |
| git-init | 0 | 0 | 0 | 0 | 0 | - |
| multiple-commands | 0 | 0 | 0 | 0 | 0 | - |
| open-android-firefox-page | 0 | 0 | 0 | 0 | 0 | - |
| qdrant | 0 | 0 | 0 | 0 | 0 | - |
| rclone-backup | 0 | 0 | 0 | 0 | 0 | - |
| rclone-new-service | 0 | 0 | 0 | 0 | 0 | - |
| start-android-emulator | 0 | 0 | 0 | 0 | 0 | - |
| sunshine-display-failsafe | 0 | 0 | 0 | 0 | 0 | - |
| sunshine-stream-start | 0 | 0 | 0 | 0 | 0 | - |
| sunshine-stream-stop | 0 | 0 | 0 | 0 | 0 | - |
| video-move | 0 | 0 | 0 | 0 | 0 | - |
| wxt-run-targets | 0 | 0 | 0 | 0 | 0 | - |
| wxt-submit | 0 | 0 | 0 | 0 | 0 | - |

## Go + Bubble Tea 포팅 우선순위

기준(`port-script-to-go`): 화면이나 게이트가 있어야 옮기고, 그중 호출 빈도가 높은 순서입니다.

1. **ship**: 완료(2026-11-02). `git/ship/`. 원본은 커밋 `66e3183`의 `git/ship-ts/` 이후 삭제. 동등성 21개 케이스 일치.
2. **browser**: 피커(`ui.ts`, `list.ts`)만 옮기는 경우에 한해 조건부. 호출의 99%가 에이전트의 비대화형 경로이고, CDP websocket이 stdlib-only 규칙에 걸립니다.
3. **swap-opencode, set-rules**: Python termios로 직접 만든 키 리더 → `tea.Model` 교체 효과가 가장 큽니다. 최근 사용이 적습니다.
4. **netbird-setup, db-sync, wxt-zip-version**: 화면은 있으나 호출이 드뭅니다.
5. **유지**: executor, dlint, phone, decision, provider-usage, port, server(비대화형이거나 이미 네이티브), zju·init-vps·atree(확인 프롬프트만).
