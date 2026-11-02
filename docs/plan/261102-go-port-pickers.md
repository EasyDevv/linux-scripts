# 피커 도구 Go + Bubble Tea 포팅

## Intent

- **Problem**: 피커가 있는 스크립트마다 termios/raw mode 키 리더를 직접 만들어 따로 유지하고 있습니다. ship 포팅(커밋 `66e3183`, `1dc63b7`)으로 Go + Bubble Tea 구성이 검증되었습니다.
- **Outcome**: `set-rules`, `netbird-setup`을 Go + Bubble Tea v2로 옮기고, 원본과의 동등성을 기록된 출력과 테스트로 증명합니다.
- **Affected users and systems**: 사용자의 대화형 사용, `meta/cmd-links.json`, `~/.local/usr/bin` 링크. netbird-setup은 NetBird 관리 API와 Windows 설치 USB를 다룹니다.
- **Constraints**: `port-script-to-go`와 `build-terminal` 규칙을 따릅니다. 동작은 원본과 같게 하고, 의도한 차이는 각 README의 Changelog에 적습니다. 보안 검사를 약하게 하지 않고, 비밀값을 출력하지 않으며, 실제 HOME과 실제 API를 건드리지 않습니다.
- **Out of scope**: browser, db-sync, 비대화형 스크립트.
- **Removed**: `swap-opencode`(소스 삭제), `wxt-*` manifest 항목 3개(target 경로가 이미 깨져 있었음. `dev/wxt` 파일은 유지).
- **Open questions**: 원본 은퇴 커밋은 동등성 확인 후 사용자 승인을 받습니다.
- **Confirmed**: 범위는 피커 도구만, swap-opencode 제거, db-sync·browser 제외, wxt-* 제거(2026-11-02).

## Changelog

- set-rules: [meta/set-rules/README.md](../../meta/set-rules/README.md) Changelog. 동등성 16개 케이스 일치(PTY 피커 5개 포함). 원본도 중단 시 130으로 끝나서 이 부분은 차이가 없습니다.
- netbird-setup: [dev/netbird/go/README.md](../../dev/netbird/go/README.md) Changelog 13개 항목. 동등성 31개 케이스 일치(가짜 API, 임시 HOME). 위/아래 이동은 build-terminal 규칙에 따라 순환하지 않고 끝에서 멈춥니다. 키 이름 입력을 가리던 worker의 변경은 원본처럼 입력이 보이도록 되돌렸습니다.
- 미검증: 실제 NetBird API, TTY에서 `--dest` 없는 `usb`(실제 USB 필요), MSI 다운로드, Windows PowerShell 실행.
- 다음: 원본 은퇴(커밋 → `meta/set-rules.py`, `dev/netbird/netbird-setup.py`, `dev/netbird/tests/test_netbird_setup.py` 삭제 → README에 해시 기록 → parity를 git history 복원 방식으로 전환).
