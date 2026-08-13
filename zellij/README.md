# zju — Zellij Utility CLI

Zellij 패인, 레이아웃, 탭을 관리하는 통합 CLI.

## 사용법

```
zju <command> [options]
```

### `pane` — 패인 동기화 + 레이아웃 저장/로드

```sh
# 현재 탭의 모든 터미널 패인을 현재 디렉터리로 동기화
zju pane sync

# 특정 경로로 동기화
zju pane sync ~/projects/my-app

# 현재 탭 레이아웃을 my-layout.kdl에 저장
# 이후 zju tab new / zju tab new N 의 기본 레이아웃으로 사용됨
# 같은 세션에서 Ctrl+t,n 으로 연 plain 새 탭에도 자동 적용됨
zju pane save

# 특정 파일로 저장 (프로필 저장, 자동 기본값은 바꾸지 않음)
zju pane save feature-work

# 세션 캐시에서 저장
zju pane save --from-session-cache main

# my-layout.kdl 을 현재 탭에 적용
# 현재 탭 이름은 유지됨
zju pane load

# 특정 저장 레이아웃을 현재 탭에 적용
zju pane load feature-work

# 캐시된 세션에서 복원 레이아웃 생성
zju pane restore main
```

### `tab` — 탭 관리

```sh
# 새 탭 열기
# my-layout.kdl 이 있으면 해당 레이아웃을 기본 사용
zju tab new

# 3개 탭 열기 (병렬, 기본 레이아웃 반영)
zju tab new 3

# 이름 지정하여 탭 열기
zju tab new --name dev --cwd ~/projects

# 명시적으로 저장한 프로필 레이아웃 사용
zju tab new --layout feature-work

# 현재 탭 닫기 (확인 프롬프트)
zju tab close

# 현재 탭 오른쪽 모두 닫기 (병렬)
zju tab close --right

# 현재 탭 제외 모두 닫기 (병렬)
zju tab close --others

# 확인 없이 닫기
zju tab close --right -y
```

## 파일 구조

| 파일 | 설명 |
|------|------|
| `zju.py` | 진입점 (서브커맨드 라우팅) |
| `pane.py` | 공개 pane CLI (`sync/save/load/restore`) |
| `pane_layout.py` | pane 레이아웃 내부 헬퍼 |
| `tab.py` | 탭 관리 |
| `common.py` | 공용 유틸리티 |
