# `bu` 통합 CLI 사용법

## 개요

`bu` 는 Bun 관련 정리와 버전 동기화를 한 명령 아래로 묶은 개인용 CLI다.

- `bu clear`: 현재 작업 트리에서 `node_modules`, `dist`, `.cache`, `bun.lock*` 를 정리한다.
- `bu update`: 아래 3곳의 Bun 버전을 한 번에 같은 값으로 맞춘다.

- 전역 proto 설정: `~/.proto/.prototools`
- 저장소 루트: `package.json#packageManager`
- moon 툴체인 설정: `.moon/toolchain.yml` 또는 `.moon/toolchains.yml`

기본 업데이트 모드는 먼저 전역 proto Bun 을 업데이트/핀 고정하고, 그 다음 같은 resolved 버전으로 로컬 설정까지 sync 한다.

## 위치

스크립트 경로:

```bash
/home/easydev/.local/usr/bin/bu
```

`~/.local/usr/bin` 이 `PATH` 에 들어 있으면 아래처럼 바로 실행할 수 있다.

```bash
bu
```

## 동작 방식

### `bu clear`

아무 추가 인자 없이 현재 디렉터리 아래를 재귀적으로 스캔해서 아래 항목을 제거한다.

- `node_modules`
- `dist`
- `.cache`
- `bun.lock`
- `bun.lockb`

```bash
bu clear
```

### `bu update`: 업데이트 + sync

아무 옵션 없이 실행하면 아래 순서로 동작한다.

1. `proto install --config-mode global bun <spec> --pin global -y` 실행
2. `~/.proto/.prototools` 에 기록된 **실제 resolved Bun 버전** 읽기
3. 루트 `package.json` 의 `packageManager` 를 `bun@<resolved-version>` 으로 갱신
4. `.moon/toolchain.yml` 또는 `.moon/toolchains.yml` 의 `bun.version` 을 같은 버전으로 갱신

`.moon` 설정 파일이 없으면 `.moon/toolchain.yml` 을 새로 만든다.

### 옵션 모드: sync-only

`bu update --sync-only` 를 주면 전역 proto Bun 업데이트는 건너뛰고, 이미 `~/.proto/.prototools` 에 핀된 Bun 버전을 읽어서 로컬 두 파일만 sync 한다.

## 기본 사용법

현재 저장소에서 최신 Bun으로 동기화:

```bash
bu update
```

특정 버전으로 동기화:

```bash
bu update 1.3.11
```

다른 저장소를 명시해서 동기화:

```bash
bu update latest --repo /path/to/repository
```

전역 pin 은 그대로 두고 로컬 두 파일만 sync:

```bash
bu update --sync-only
```

다른 저장소에 대해 sync-only 실행:

```bash
bu update --sync-only --repo /path/to/repository
```

## 저장소 루트 판별 방식

기본적으로 현재 디렉터리에서 `git rev-parse --show-toplevel` 을 실행해 저장소 루트를 찾는다.

만약 Git 저장소 밖에서 실행하면 현재 디렉터리를 기준으로 동작한다.

명확하게 지정하고 싶으면 `--repo` 를 사용하는 편이 안전하다.

## 예시

### 1) 지금 저장소를 최신 Bun으로 맞추기

```bash
cd /home/easydev/dev/marketing/sns-publisher
bu update
```

### 2) 정확히 `1.3.11` 로 고정하기

```bash
cd /home/easydev/dev/marketing/sns-publisher
bu update 1.3.11
```

### 3) 현재 전역 proto Bun 기준으로 로컬 파일만 재정렬하기

```bash
cd /home/easydev/dev/marketing/sns-publisher
bu update --sync-only
```

## 실행 후 확인 명령

```bash
cat ~/.proto/.prototools
cat package.json
cat .moon/toolchain.yml
bun --version
proto status
moon run desktop:check
```

## 버전 우선순위 메모

실험 결과는 아래와 같았다.

- `bun --version` 같은 일반 Bun CLI 해석은 로컬 `package.json#packageManager` 가 있으면 그 값을 우선한다.
- `moon run ...` 은 로컬 `.moon/toolchain.yml` 의 `bun.version` 이 있으면 그 값을 우선한다.
- 둘 다 없으면 전역 proto 핀을 따른다.

즉, **전역 proto만 업데이트하고 로컬 두 파일을 그대로 두면 드리프트가 남을 수 있다.**

그래서 이 스크립트는 세 지점을 항상 같은 버전으로 맞추는 방식으로 동작한다.
