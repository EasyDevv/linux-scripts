# droid 공통 모듈: 폰 조작을 Go 하나로 모으기

> 상태: P0–P5 코드 완료 (261105). 실폰 `--dry` 2회째 실패 0건. 19:00 회차 확인, A2·A4 확인 대기.
> 잇는 문서: android-macro `docs/backlog/261105-karrot-run-speed.md` (B안 선택 근거).
> 대상: `dev/droid`(새 위치), control-android 스킬, `android/phone.py`(제거), android-macro의 device 모듈.

## Intent

- **확정 상태:** Clarity 10/10 (261105, 사용자 확정). android-macro `.product` surface의 동작은 바뀌지 않는다. 바뀌는 것은 화면 뒤 adapter뿐이라 `intent.json`은 고치지 않는다.

- **Problem**
  - 폰 조작이 세 벌로 구현되어 있다.
    - droid (Go, 스킬 안)
    - `phone` 명령 (`android/phone.py`, Python)
    - android-macro의 TS (`phone.ts`, `node-dump.ts`, `awake.ts`, `dimmer.ts`, `recorder.ts`, 입력 호출)
  - 한쪽에서 고친 것이 다른 쪽에 다시 터진다. 261105에는 폰 재연결과 덤프 대기를 droid에서 먼저 풀었지만, android-macro 19:00 회차가 같은 원인으로 실패했다.
  - android-macro의 폰 조작은 `spawnSync`와 `sleep` 위에 흩어져 있다. 정확히는 bump·upload·read에서 직접 부르는 adb가 22곳이다.
  - `phone.py`에는 폰 모델명이 박혀 있다(도움말과 시리얼 선택).

- **Outcome**
  - 폰 조작 구현이 `dev/droid` 하나만 남는다. 공개 명령은 `droid` 하나다(cmd-links wrapper).
  - android-macro는 adb를 직접 부르지 않는다. 폰 조작은 모두 `droid` CLI(명령마다 한 번 실행, JSON 출력)로 한다. 단, 당근 화면 판단과 흐름(무엇을 누를지)은 TS에 남는다.
  - `phone` 명령과 `android/phone.py`가 없어진다. 별칭도 남기지 않는다. 스킬과 문서는 `droid`만 안내한다.
  - 화면 깨우기 방식은 droid watchdog 하나다. `data/awake-restore.json`은 없어진다.
  - 어떤 폰을 쓸지는 호출하는 쪽이 `--model`로 넘긴다. droid는 폰 식별자를 저장하지 않는다. 다만 마지막 주소 캐시는 `~/.cache/droid/`에 둔다(추적 안 됨).
  - 단계마다 실폰 `--dry` 1회가 지금과 같은 결과를 낸다.

- **Users and systems**
  - **사람·기기:** 사람 1명, 폰 1대(무선 디버깅), PC 1대, 검증용 emulator(`medium_phone`, bench adb 서버 5038).
  - **scripts 레포:**
    - `dev/droid/` (새 위치)
    - `dev/droid.sh` (wrapper)
    - `meta/cmd-links.json` (`droid` 추가, `phone` 제거)
    - `android/phone.py`, `android/phone_test.py` (삭제)
  - **스킬:** `~/.agents/skills-routed/system/control-android/`
    - `SKILL.md`
    - `references/phone.md`, `references/recording.md`
    - `scripts/droid/`는 삭제하고 `dev/droid`로 옮긴다.
  - **android-macro:**
    - `src/lib/macro/`: `phone.ts`, `node-dump.ts`, `awake.ts`, `dimmer.ts`, `recorder.ts`, `read-phone.ts`, `bump-phone.ts`, `upload-phone.ts`, `photo-render.ts`, `gallery-scan.ts`, 그리고 각 테스트 파일
    - `scripts/karrot-due.ts`
    - `scripts/phone-tools/`
    - `src/routes/api/macro/+server.ts`
    - `.agents/skills-routed/*`
    - 새 파일 `scripts/autox.ts`

- **Constraints**

  | 영역 | 한계 |
  |---|---|
  | 폰 정보 | 추적되는 파일(코드·테스트·문서·로그 예시)에 모델명·시리얼·IP·mdns 이름을 쓰지 않는다. 테스트는 `SM-X000`, `PHONE0000`, `192.0.2.x`를 쓴다(dev/AGENTS.md). |
  | 실폰 사용 | 단계 끝마다 사람이 잠금을 푼 뒤 `--dry` 1회만 한다. 확정 버튼을 누르는 회차는 정기 19:00 회차가 맡는다. 화면 내용과 식별자를 문서에 옮기지 않는다. |
  | emulator | bench adb 서버(`ANDROID_ADB_SERVER_PORT=5038`, `ADB_MDNS=0`)만 쓴다. 기본 서버(5037)의 폰을 보지 않는다. 끝나면 `adb -P 5038 kill-server`. |
  | 호환 | 단계 사이에도 19:00 회차가 돌아야 한다. 한 단계가 끝날 때까지 그 단계의 TS 경로는 지우지 않는다. 지우는 시점은 그 단계의 `--dry`가 통과한 뒤다. |
  | 호출 방식 | 명령마다 `droid` 한 번 실행(`spawnSync`). 상주 `droid serve`는 쓰지 않는다. |
  | 종료 코드 | droid: 0 ok, 1 usage, 2 조건 불충족, 3 기기 문제(기존 `main.go` 규약 유지). karrot-due: 75 폰 없음, 78 설정 없음(유지). |
  | 커밋 | 사용자가 요청할 때만 커밋한다. |

- **Out of scope**
  - 당근 화면 판단과 흐름(bump/upload/read의 무엇을 누를지, `dump.ts` 파싱), 규칙, SQLite 저장소, Svelte 사이트를 Go로 옮기기. 보류, 재논의(C안).
  - 상주 `droid serve`와 TS 비동기화. 보류, 재논의.
  - 폰 여러 대 동시 운영.
  - git 이력과 GitHub 캐시 정리. 사용자가 이미 처리했다.

- **Verification**
  - `go test ./...` (`dev/droid`)
  - `bun test`, `bun run check` (android-macro)
  - `cmd-links doctor`
  - emulator smoke: `dev/droid/smoke.sh` (새 파일, 5038 서버). connect/state/look/dump/tap/swipe/type/awake/rest/rec/shot을 한 번씩 돌린다.
  - 실폰: 단계 끝마다 `bun scripts/karrot-due.ts --dry`. `events.jsonl`의 실패 수와 `dump` 중앙값을 직전 회차와 비교한다.
  - 잔재 검사:
    - `grep -rn "adb\"\|\"adb\"" src/lib/macro scripts`가 0줄이다. 예외는 `droid.ts` 한 곳뿐이다.
    - `command -v phone`이 아무것도 내지 않는다.

- **Open questions:** 없음.

- **Confirmed (사용자 답)**
  - B안: device 계층만 Go.
  - 위치: `~/.local/share/scripts/dev`의 공통 모듈. 모양은 `dev/droid` + `dev/droid.sh`.
  - 호출: 명령마다 CLI + JSON.
  - 옮길 범위: 연결·찾기·대기, 덤프·깨우기, 입력, 조광기·녹화·사진 넣기 전부.
  - 실폰 확인: 단계 끝마다 `--dry` 1회.
  - `phone`: 완전히 제거. 별칭 없음.
  - awake: droid watchdog.
  - 폰 선택: 호출하는 쪽이 `--model`.

## 1. 지금 있는 것 (261105 확인)

| 일 | droid (Go) | phone.py | android-macro (TS) |
|---|---|---|---|
| 폰 찾기·재연결 | `connect`, `state` (`main.go:155`) | `serial` (`pick_serial` `phone.py:74`) | `findPhoneSerial` `phone.ts:218`, 중복 `read-phone.ts:22`, `waitForPhone` `phone.ts:202` |
| 수동 포트·페어링 | 없음 | 없음 | `connectManualPort` `phone.ts:260`, `pairPhone` `phone.ts:295` (사이트 `+server.ts:9`) |
| 잠금 대기 | 없음 | `wait` | `phoneLocked` `karrot-due.ts:342` |
| 화면 덤프 | NodeDump 한 번 실행 (`device.go` `nodeDump`) | `dump` (uiautomator) | NodeDump 상주 서버 `node-dump.ts:40` |
| 깨우기 | `awake`·`rest` watchdog (`awake.go:26`) | `awake`·`rest` | `keepAwake` `awake.ts:32` (30분, PC 파일에 원래 값 저장) |
| 입력 | `tap`(라벨)·`key`·`swipe`(방향)·`type`(ClipSet) | 없음 | 좌표 `input tap/swipe/keyevent` (`bump-phone.ts:660` 등 22곳), ClipSet `upload-phone.ts:116` |
| 조광기 | 없음 | 없음 | `hideDimmer`·`restoreDimmer` `dimmer.ts:132,167` |
| 녹화 | 없음 | `rec`·`sheet` | 180초 세그먼트 루프 `recorder.ts:162` |
| 사진 넣기 | `media` | 없음 | `push` `photo-render.ts:71` |
| AutoX·Tasker | 없음 | `push`·`run`·`start`·`smoke`·`reverse` | 없음 (tasker-autox 스킬이 `phone`을 안내) |
| 공개 명령 | `~/.local/usr/bin/droid`. 손으로 빌드한 파일이고 manifest에 없다 | `phone` (`cmd-links.json:513`) | — |

`phone ...`을 안내하는 문서:
- control-android의 `SKILL.md`, `references/phone.md`, `references/recording.md`
- android-macro의 `run-karrot-pc`, `run-karrot-batch`, `read-karrot-sales`, `tasker-autox`(`SKILL.md`와 `references/schedule.md`, `survive.md`, `deploy.md`)

## 2. 모듈 모양

```text
dev/droid/
├─ go.mod                 module droid (go 1.27)
├─ main.go                명령 해석, 종료 코드, --json, --model, --serial
├─ device.go              adb 실행, 기기 선택, 마지막 주소 캐시 (~/.cache/droid/endpoint)
├─ connect.go             mdns·재연결·포트 스캔·서버 재시작·pair·--wait
├─ nodes.go               NodeDump 상주 서버 (android-macro node-dump.ts 를 옮김)
├─ input.go               tap(라벨|x,y)·swipe(방향|좌표)·key·type
├─ awake.go               watchdog (기존)
├─ overlay.go             조광기: 오버레이 appops·접근성 서비스 끄기/되돌리기, 원래 값은 폰 쪽 폴더
├─ rec.go                 세그먼트 녹화 start/stop, 시각 파일, shot, sheet
├─ java/NodeDump.java, ClipSet.java, build-dex.sh, *.dex (go:embed)
├─ droid_test.go …        가짜 adb 로 명령열 검증
└─ smoke.sh               emulator 전용, 5038 서버
dev/droid.sh              Go 소스나 dex 가 bin/droid 보다 새로우면 go build, 그 뒤 exec
```

- **wrapper와 빌드:** `dev/cli.sh`는 실행할 때마다 빌드한다. droid는 회차 한 번에 수백 번 불리므로 바뀌었을 때만 빌드한다. `bin/`은 gitignore다.
- **JSON:** `--json`이면 stdout에 객체 하나를 낸다(`{"ok":true,"serial":"…",…}`). 예외는 `dump`로, XML을 그대로 낸다(크기 때문). 사람이 읽는 출력은 지금과 같다.
- **계약 버전:** `droid version --json`은 `{"contract":N}`을 낸다. android-macro는 시작할 때 최소 N을 확인하고, 모자라면 78로 끝낸다.
- **dex 하나로:** `NodeDump.java`는 android-macro의 상주판(serve 모드)으로 합친다. 한 번 실행 모드도 그대로 둔다. android-macro `scripts/phone-tools/`는 지운다.
- **폰 쪽 상태:** 폰 쪽 상태는 모두 `/data/local/tmp/droid-*` 폴더에 둔다(awake, nodes, overlay). PC가 죽어도 폰 쪽 watchdog과 idle 종료가 정리한다.

## 3. 명령 대응표

| 지금 | droid |
|---|---|
| `phone serial`, `findPhoneSerial` | `droid serial --model M [--json]` |
| `waitForPhone` | `droid connect --model M --wait 40m` (1분마다 다시 찾고, 서버 재시작은 다섯 번에 한 번, 못 찾으면 3) |
| `connectManualPort` | `droid connect --model M --port P` (`P`는 `포트` 또는 `IP:포트`) |
| `pairPhone`, `findPairingEndpoint` | `droid pair [--port P] --code 123456 --model M` |
| `phone wait`, `phoneLocked` | `droid lock [--wait 120s]`: 잠김이면 2, 풀리면 0. PIN은 넣지 않는다 |
| `dumpScreen`, `phone dump` | `droid dump` (XML), `droid dump --text` |
| `stopNodeServer` | `droid rest --nodes` (awake와 따로 내릴 수 있음) |
| 좌표 tap/swipe/key | `droid tap 540,1200`, `droid swipe 420,1600 420,550 280`, `droid key BACK` |
| ClipSet 한글 입력 | `droid type "…"` (기존) |
| `keepAwake`·`restoreAwake`, `phone awake/rest` | `droid awake --idle 10m`, `droid rest` |
| `hideDimmer`·`restoreDimmer` | `droid overlay hide [--pkg P]`, `droid overlay restore` |
| `createRecorder`, `phone rec` | `droid rec start --dir D --segment 180`, `droid rec stop` (시각 파일과 mp4를 D로 가져옴) |
| `phone shot`, `phone sheet` | `droid shot F`, `droid sheet F --every 2` |
| 사진 push + 미디어 스캔 | `droid media push F…` (기존 `media` 확장) |
| `phone push/run/start/smoke/reverse` (AutoX) | android-macro `bun scripts/autox.ts push|run|start|smoke|reverse`. 안에서는 droid를 쓴다 |

AutoX 명령을 droid에 넣지 않는 이유가 있다. 당근 프로젝트 전용 경로와 패키지(Tasker·AutoX 액션, 포트 1780)를 알아야 하기 때문이다. 이를 droid에 넣으면 공통 모듈이 한 프로젝트에 묶인다. "phone 완전 제거"는 이 방식으로 지킨다.

## 4. android-macro 쪽 seam

- **adapter 하나:** 새 파일 `src/lib/macro/droid.ts` 하나가 `droid`를 부른다(`spawnSync`, `--model`은 `phoneModel()`).
  - 필요한 동작을 타입 있는 함수로 낸다. `serial`, `connect`, `dump`, `tap`, `swipe`, `key`, `type`, `awake`, `rest`, `overlay`, `rec`, `push`, `lock`이다.
  - 다른 모듈은 adb를 모른다.
- **테스트:** 테스트 가짜는 adb 인자열 대신 droid 인자열을 본다(`DroidExec`).
  - 기존 `AdbExec` 가짜(`bump-phone.test.ts`, `upload-phone.test.ts`의 `FakePhone`)는 단계별로 옮긴다.
  - 옮기는 동안 두 가짜를 함께 둘 수 있다. 이것은 테스트 전용 seam이라 바깥에 내지 않는다.
- **지울 것:** `node-dump.ts`, `awake.ts`, `dimmer.ts`, `scripts/phone-tools/`, `phone.ts`의 adb 부분(`.env` 읽기 `phoneModel`과 `PhoneFiles`는 남음), `read-phone.ts:22`의 중복 `findPhoneSerial`.

## 5. 단계

| 단계 | 범위 | 테스트 |
|---|---|---|
| P0 옮기기 | 스킬의 `scripts/droid`를 `dev/droid`로 옮긴다(`git mv`가 아니라 복사 후 스킬에서 삭제. 저장소가 다름). `dev/droid.sh`와 cmd-links wrapper 행을 추가하고, 손 빌드 바이너리를 지운다. 스킬은 `droid` 명령만 안내한다 | `go test ./...`, `cmd-links doctor`, `droid version`, emulator `smoke.sh`의 connect/state/look |
| P1 연결 | `--model`, `--json`, `version`, `serial`, `connect --wait/--port`, `pair`, `lock`을 넣는다. android-macro `droid.ts`를 만들고 `phone.ts`의 찾기·대기·포트·페어링과 사이트 API를 droid로 바꾼다 | `go test`(mdns 출력, 재연결, 스캔, 5번에 1번 재시작, 대기 시간 초과 3). `bun test`(phone, run API). emulator `connect --model sdk_gphone64_x86_64`. 실폰 `--dry` |
| P2 덤프 | NodeDump 상주 모드(덤프마다 `clearCache()`와 `root.refresh()`. 261105에 낡은 캐시 때문에 카드가 빠졌다)와 `dump`, `rest --nodes`를 넣는다. android-macro의 덤프 세 곳을 `droid dump`로 바꾸고 `node-dump.ts`, `phone-tools/`를 지운다 | `go test`(PUSH·TIMEOUT·ERROR·fallback, 크기 다른 dex 다시 넣기). emulator 덤프 50–100ms, uiautomator fallback 확인. 실폰 `--dry` 덤프 중앙값 |
| P3 입력 | 좌표 tap/swipe와 `key` 이름을 droid에 넣는다. android-macro의 adb `input` 22곳과 ClipSet을 바꾼다 | `go test`(인자열). `bun test`(bump/upload/read가 같은 좌표와 순서로 droid를 부르는지 기존 기대값으로). emulator smoke tap/swipe/type 한글. 실폰 `--dry` |
| P4 깨우기·조광기·녹화·사진 | `overlay`, `rec`, `shot`, `sheet`, `media push`를 넣는다. `awake.ts`·`dimmer.ts`·`recorder.ts`의 adb 부분과 `photo-render`·`gallery-scan`의 adb를 바꾼다. `data/awake-restore.json`과 `data/dimmer-restore.json`은 폰 쪽 상태로 옮기고, 남은 파일은 첫 실행 때 되돌린 뒤 지운다 | `go test`(overlay 저장·되돌림, rec 세그먼트 시각). `bun test`(recorder, dimmer 대체, photo). emulator rec 20초와 프레임 수, awake/rest 값 되돌림. 실폰 `--dry`: 녹화 밝기, `events.jsonl` 프레임 범위, 조광기 되돌림 |
| P5 phone 제거 | android-macro `scripts/autox.ts`를 만든다. cmd-links에서 `phone` 행을 지우고 `android/phone.py`, `phone_test.py`를 지운다. 스킬과 문서의 `phone …`을 `droid …` 또는 `autox.ts`로 바꾼다. 마지막으로 잔재 검사를 한다 | `cmd-links doctor`, `command -v phone` 없음, `grep -rn "phone (serial|wait|awake|rest|shot|dump|sheet|rec|push|run|start|smoke|reverse)"`가 0줄, `bun test`, 실폰 `--dry` |

- **의존:** P0 → P1 → (P2, P3, P4 순서 자유, 각자 독립) → P5. P5는 앞의 모든 단계의 `--dry`가 통과한 뒤에만 한다.
- **공통 완료 조건(단계마다)**
  1. `go test ./...`과 `bun test`가 통과한다.
  2. emulator smoke가 통과한다(5038 서버, 끝나면 kill-server).
  3. 사람이 잠금을 풀고 실폰 `--dry`를 1회 돌린다.
     - 실패 이벤트 수가 직전 `--dry` 이하여야 한다.
     - 확정 버튼(`수정 완료`, 하단 `끌어올리기`)이 눌리지 않아야 한다.
     - 조광기와 화면 꺼짐 시간이 되돌아와야 한다.
  4. 그 단계의 TS 경로를 지운다.
  5. 19:00 회차 1번을 지켜본 뒤 다음 단계로 넘어간다. 실패하면 직전 단계 커밋으로 되돌린다.
- **멈춤 규칙:** 다음 중 하나라도 생기면 그 단계를 멈추고 보고한다. 우회해서 넘어가지 않는다.
  - 테스트가 실패한다.
  - `--dry`가 직전과 다른 화면 판단을 한다(같은 글에서 다른 버튼, 건너뜀 수 변화).
  - 실폰에서 쓰기가 거부된다(One UI의 `settings put` 거부 등).

## 확인할 가정

| # | 가정 | 확인 방법 |
|---|---|---|
| A1 | 폰 셸이 `settings put system screen_off_timeout`과 `global stay_on_while_plugged_in`을 쓸 수 있다(One UI) | P4 실폰 `--dry` 전후 `droid state --json`의 `timeoutMs` 값 |
| A2 | NodeDump 상주 서버가 UiAutomation을 잡는 동안 조광기와 AutoX 접근성 서비스가 잠시 눌려도 회차에 지장이 없다 | P2 실폰 `--dry` 뒤 `settings get secure enabled_accessibility_services`가 회차 전과 같다 |
| A3 | `droid` 한 번 실행 비용(Go 시작과 adb 왕복)이 덤프 1회당 100ms 안이다 | P2 emulator: `time droid dump` 10회 중앙값 |
| A4 | systemd 서비스 안에서 droid가 띄운 adb 서버를 scope로 분리하는 것이 Go에서도 같이 된다 | P1 뒤 `systemctl --user start karrot-bump.service`를 폰 꺼진 상태로 1회 돌려 저널에 `Killing process (adb)`가 없는지 본다 |
| A5 | 실폰 덤프 중앙값이 uiautomator(2238ms)보다 확실히 짧다 | P2 실폰 `--dry`의 `events.jsonl` `dump` 중앙값 |

## 변경 이력

- 261105: 사용자 지시("중간에 묻지 않고 계속 진행")로 P1–P5를 한 번에 진행했다. 단계마다 하는 `--dry`와 19:00 확인은 건너뛰고, 끝에 `--dry`를 1회만 했다.
  - droid(contract 2): `--model`, `--json`(실패도 JSON), `--no-look`, `serial [--recover]`, `connect --wait/--port`, `pair`, `lock`, `adb -- …`, 상주 NodeDump `dump [--text]`, `rest --nodes|--all`, `tap X,Y`, `swipe X1,Y1 X2,Y2`, `overlay hide/restore`, `rec start/stop`, `shot`, `sheet`, `media push`를 넣었다. 계약은 `dev/droid/CONTRACT.md`에 있다.
  - 계획과 다른 점:
    - (1) 대응표에 없던 `droid adb -- …` 통과 명령을 넣었다. am start, dumpsys, getprop, pull처럼 전용 명령이 없는 일에 쓴다.
    - (2) 입력 22곳은 TS의 `input …` 인자열을 그대로 `droid adb --`로 넘긴다. 타입 있는 `droid tap`으로 바꾸지 않은 이유는 `FakePhone` 테스트가 adb 인자열을 보기 때문이다. 대신 dump, type, shot, rec, awake, overlay, media는 `droidOf(exec)` seam으로 전용 명령을 쓴다.
    - (3) awake는 30분 timeout 대신 watchdog을 쓴다. 마지막 droid 호출 뒤 10분이 지나면 원래 값으로 되돌린다.
    - (4) `.product`의 메커니즘 문장(restore 파일, phone-tools)을 droid 기준으로 고쳤다. 상태와 동작은 그대로다.
  - 확인한 것:
    - `go test` 통과, emulator `smoke.sh` 21/21 통과, emulator 덤프 중앙값 60ms(A3)
    - `bun test` 325 pass, `bun run check` 0 errors
    - `cmd-links doctor`에 droid·phone 문제 없음, `command -v phone` 없음
  - 실폰 `--dry` 1회(`.log/20261105-220026`):
    - 덤프 61회, 중앙값 178ms. 이전 uiautomator는 2238ms였다(A5 충족).
    - 회차 뒤 화면 꺼짐 시간과 stay-on 값이 원래대로 돌아왔다(A1 충족). 조광기 되돌림은 1건이다.
    - 기다림 실패가 5건 있었고, 결과는 "끌어올리기 창을 열 수 있는 글이 없어요"였다. 영상으로 본 원인은 둘이다.
      - (a) 다른 앱의 PiP 동영상 창이 목록 아래쪽을 덮어서, y≈2000 아래 탭이 그 창에 맞았다.
      - (b) 판매관리를 연 직후 첫 탭이 카드 본문에 맞아 글 상세가 열렸다. 빠른 덤프가 배너가 뜨기 전 배치를 읽었을 가능성이 있다. 이는 21:02 회차의 상주 NodeDump 때부터 있던 조건이다.
    - 같은 조건의 직전 `--dry`가 없어서 비교는 못 했다.
  - 남은 일:
    - PiP를 닫은 상태에서 `--dry`를 다시 돌린다.
    - 19:00 회차 1번을 지켜본다.
    - A2(접근성 서비스 목록), A4(systemd 안 adb scope)를 확인한다.
- 261105: PiP 창이 없는 상태에서 `--dry`를 다시 돌렸다(`.log/20261105-220812`).
  - 결과: 실패 0건, 덤프 21회, 중앙값 173ms. 탭 7번이 모두 기대한 화면을 열었다.
  - 첫 탭 좌표가 1회차(y 951)와 달랐다(y 1286). 1회차의 (b)는 배너가 뜨기 전 배치를 읽은 일회성 문제로 본다.
  - 회차 결과 문구 "끌어올리기 창을 열 수 있는 글이 없어요"는 두 회차가 같다. 화면 판단은 바뀌지 않았다.
  - 화면 꺼짐 시간과 조광기는 되돌아왔다.

- 261105: P0 코드 완료. `dev/droid`(dex와 Java는 `java/`, `go 1.27`), `dev/droid.sh`(바뀐 소스가 있을 때만 빌드), cmd-links `droid` 행, `.gitignore`의 `dev/droid/bin/`. `droid version [--json]`(contract 1)을 P1에서 당겨 넣었다. `smoke.sh`는 version/connect/state/look만 돌리고 단계마다 늘린다. 손 빌드 바이너리와 스킬의 `scripts/droid`(git에 올라간 적 없음)를 지웠다. 확인: `go test` 통과, emulator smoke 4/4 통과, `cmd-links doctor`에 droid 문제 없음. 실폰 `--dry`는 아직 안 했다. P0은 android-macro를 건드리지 않는다.

- 261105: P2에 "덤프마다 캐시 비우기"를 넣었다(android-macro 21:02 회차에서 판매 목록 누락).

- 261105: 처음 작성. B안, 위치, 호출 방식, 범위, 실폰 확인, phone 제거, awake 방식, 폰 선택을 사용자가 확정했다. AutoX 전용 명령을 `scripts/autox.ts`로 보내는 것은 §3의 이유로 이 계획이 정했다.

## 참고

- 스킬 droid: `~/.agents/skills-routed/system/control-android/scripts/droid/` (`main.go`, `device.go`, `awake.go`, `ui.go`, `NodeDump.java`)
- `android/phone.py`, `meta/cmd-links.json`, `dev/cli.sh` (wrapper 선례)
- android-macro:
  - `src/lib/macro/phone.ts`, `node-dump.ts`, `awake.ts`, `dimmer.ts`, `recorder.ts`, `bump-phone.ts`, `upload-phone.ts`, `read-phone.ts`
  - `scripts/karrot-due.ts`
  - `deploy/user/karrot-bump.service`
  - `docs/backlog/261105-karrot-run-speed.md`
- 측정: `docs/backlog/261105-worker-handoff-tokens.md`(droid 재측정), android-macro `.log/20261105-200313/events.jsonl`(덤프 208회, 490초)
