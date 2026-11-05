# 오케스트레이터 ↔ worker 위임: 토큰과 효과 판정

`mcp__pi__worker`(Claude)와 `subagent`(pi)에 일을 맡길 때 부모 토큰이 어디에 쓰이는지 측정했다. 어떤 변경을 적용했는지, 결과적으로 위임을 계속 쓸지도 함께 정리한다.

## 결론

| 부모 | 판정 | 근거 |
|---|---|---|
| **Claude (Sonnet/Opus)** | **기본은 직접 처리. 위임은 결과에 비해 맥락을 많이 먹는 작업에만 쓴다 (pi 0.3.4부터 기본 모드 `skills`)** | 웹 작업은 9–11% 쌌지만 2–3배 느렸다. 탐색은 +10%, 작은 작업과 android는 +5–7%, desktop은 같았다. 위임을 스스로 고르게 둔 arm(natural)에서 Sonnet은 탐색을 한 번도 위임하지 않았다 |
| **pi (grok)** | **위임을 계속 쓴다** | web은 59–67%, desktop은 68% 쌌다. small은 위임 없이 같았고, android는 위임하면 +24%였다 |

**단서: 이 수치는 측정할 때 쓴 스킬의 품질에 따라 달라진다.** 스킬이 약하면(원시 dump, `sleep`, 노드로 충분한데 쓰는 스크린샷, 도구 부재) 직접 처리하는 부모의 맥락이 커지고, worker의 단계도 늘거나 멈춘다. 그래서 스킬을 고친 뒤에는 판정이 뒤집힐 수 있다. 예를 들어 control-android는 droid 도입으로 직접 처리 비용이 67% 줄었고, 그 뒤 위임 판정이 하네스마다 달라졌다(cu-r9: pi −58%, Claude 거의 같음). 위 표는 각 측정 시점의 스킬 기준이다. 스킬이나 도구가 바뀌면 두 arm을 다시 잰다.

**판정이 바뀌는 조건: worker나 부모 모델이 바뀔 때.** 지금 판정은 현재 모델 조합(worker: tiers.json의 pi quick/standard, 부모: Sonnet, grok-4.7) 기준이다. 더 빠르거나 가성비가 좋은 worker 모델이 나오면 설정이 바뀔 수 있다. 다만 바뀌는 쪽은 비용보다 속도다.

| 변화 | 판정에 미치는 영향 | 근거 (cu-r9) |
|---|---|---|
| worker가 더 싸짐 | **작다.** 위임 총비용의 대부분은 부모 몫(브리프 출력, 보고 수신, 이후 턴의 맥락)이다 | child 비용 중앙값 $0.004, 위임 총비용 $0.072–0.096의 4–5% |
| worker가 더 빨라짐 | **크다.** Claude 위임의 손해는 비용이 아니라 시간이다. 지연이 줄면 Claude도 화면 조작·긴 로그 작업에서 위임으로 기울 수 있다 | Claude 위임 87s, 직접 42s. 비용은 거의 같음 |
| worker가 더 정확해짐 (같은 가격) | 중간. 단계와 멈춤이 줄고, 부모가 보고서를 다시 확인할 일도 줄어든다 | 재확인 분량이 보고서의 93%(측정 2) |
| 부모가 더 싸지거나 캐싱 할인이 커짐 | 직접 처리 쪽으로 기운다 | Claude 직접이 위임과 비슷한 이유가 0.1배 캐시 읽기 |
| 부모가 더 비싸지거나 캐싱이 약함 | 위임 쪽으로 기운다 | pi 부모(grok)는 직접 처리 입력이 23만 토큰이라 위임이 −58% |

모델을 바꾸면(`~/.config/decision/tiers.json`의 pi 단계 또는 `CLAUDE_PARENT`·`PI_PARENT`) 같은 시나리오로 두 arm을 다시 잰다. 예: `FORCE_DELEGATE=1 ANDROID_SERIAL_BENCH=emulator-5554 ANDROID_ADB_SERVER_PORT=5038 python3 -I ~/.agents/plugins/pi/evals/computer-use.py <round> --runs 3 --jobs 1 --only android-ui --harness claude,pi`, web·desktop은 `--only web,desktop,small --jobs 4`. 기준을 고칠지는 시간 중앙값과 비용 합계를 함께 보고 정한다.

Claude에서 이득이 작은 이유는 다음 세 가지다.
1. prompt caching 덕에 직접 처리해도 이전 맥락을 0.1배 가격으로 다시 읽는다.
2. 브리프가 부모의 출력 토큰이다. 단가가 입력의 약 5배이고, 보고서와 비슷한 양이다.
3. 보고를 받은 뒤 부모가 다시 확인하는 데 보고서 분량의 93%를 더 쓴다.

pi 부모는 직접 처리할 때 입력이 27만–34만 토큰까지 커져서 위임으로 줄어드는 몫이 크다(위임하면 4만–7만).

Claude에서 위임이 여전히 이득인 경우는 다음과 같다.
- 결과보다 훨씬 큰 출력을 읽어야 하는 일: 브라우저·desktop 조작, 긴 테스트·빌드 로그, 수십 개 파일 sweep.
- 남은 세션이 길어서 그 출력이 이후 턴마다 다시 읽히는 경우.

이득이 없는 경우는 다음과 같다.
- 도구 호출 두세 번으로 끝나는 일.
- 답이 짧고 읽을 양도 적은 탐색.
- 지연이 중요한 대화.

Opus 부모로 위임과 직접 처리를 비교한 측정은 아직 없다. 토큰 단가 비율은 Sonnet과 같으므로 비율도 비슷할 것으로 추정하지만 확인하지 않았다.

## 측정 1: 위임과 직접 처리 비교 (bench)

| bench | 부모 | 시나리오 | 위임 $ | 직접 $ | 차이 | 시간 (위임 / 직접) |
|---|---|---|---|---|---|---|
| cu-r6/r7/r8 (각 6회) | Claude Sonnet | web | 0.091–0.094 | 0.102–0.104 | −9~−11% | 56–68s / 21–24s |
| cu-r5 (3회) | Claude Sonnet | web | 0.082 | 0.092 | −11% | 55s / 22s |
| cu-r5 | Claude Sonnet | desktop | 0.096 | 0.096 | 0 | 61s / 24s |
| cu-r5 | Claude Sonnet | small | 0.080 | 0.075 | +7% | 19s / 11s |
| cu-r5 | Claude Sonnet | android | 0.068 | 0.065 | +5% | 18s / 9s |
| explore-orch (11회) | Claude Sonnet | 파일 탐색 | 0.107 (explicit) | 0.097 | +10% | 35s / 10s |
| cu-r6/r7/r8 | pi grok | web | 0.079–0.103 | 0.242–0.253 | −59~−67% | 71–79s / 57–70s |
| cu-r5 | pi grok | desktop | 0.074 | 0.229 | −68% | 55s / 102s |
| cu-r5 | pi grok | small | 0.049 (위임 0회) | 0.046 | ≈0 | 10s / 11s |
| cu-r5 | pi grok | android | 0.063 | 0.051 | +24% | 31s / 18s |

정답률은 두 방식이 같았다(위임 실행은 모두 exact).

## 측정 2: 위임 한 번의 토큰 구성 (최근 30일 Claude 기록, 328건)

| 항목 | 규모 | 비고 |
|---|---|---|
| 브리프 (부모 출력 토큰) | 중앙값 2.0k자, p90 6.0k, 합계 91만 자 | 보고서와 비슷한 양이고 단가는 약 5배 |
| 보고서 (헤더 + 본문) | 중앙값 2.0k, p90 6.1k, 합계 100만 자 | 32건이 6000자에서 잘려 내용을 잃었다 |
| 보고 뒤 부모의 재확인 (보고에 나온 경로를 다음 3회 호출 안에 다시 읽음) | 289회, 92.8만 자 | **보고서 전체의 93%**. 읽기 전용 보고 뒤의 재확인이 45만 자, 파일 전체 Read가 37.6만 자 |
| `tasks[]` 브리프 사이의 중복 문장 | 1–2% | `shared` 필드를 따로 둘 가치가 없다 |
| 브리프 속 보고 형식 지시 | 7.7% | 대부분 돌려받을 값의 지정이라 필요하다 |
| 서식 군더더기 (굵은 글씨, 머리말, 제목, `Open: none`) | 0.8% | 정규화할 가치가 없다 |
| pi `subagent` 결과 | 중앙값 0.8k자, 브리프보다 작다 | wrapper가 더하는 양이 거의 없어 손대지 않았다 |

조사한 기법 가운데 Anthropic multi-agent research 시스템의 artifact 패턴이 가장 맞았다. 하위 에이전트의 긴 결과는 파일에 쓰고 부모에게는 경로만 넘긴다. 형식 비교 연구에서 일반 텍스트, Markdown, compact JSON의 토큰 차이는 15% 이내였다.

## 적용한 변경 1 (pi 0.3.3, 261105 배포)

- **worker 보고 지시:** 일반 텍스트로 쓴다. Findings 맨 앞에 질문의 답을 두고, 값마다 `file:line`을 붙인다. 파일을 바꿨으면 Files에 실행한 검사와 결과 줄을 적는다. "오케스트레이터는 파일을 다시 읽지 않고 보고대로 움직인다"는 문장을 넣었다.
- **부모용 위임 안내:** 파일을 바꾼 보고는 `git diff --stat`과 보고가 지목한 hunk나 테스트 하나만 확인한다. 읽기 전용 보고는 값이 빠졌거나 앞뒤가 모순될 때만 확인한다.
- **긴 보고:** 6000자를 넘으면 잘라 버리지 않고 전체를 `$XDG_STATE_HOME/pi-worker/reports/<call>-<i>.md`에 저장한다. 부모에게는 앞부분, 경로, Open 항목을 넘긴다. 저장 파일은 원장과 함께 30일 뒤에 지운다.
- **bench 도구:** `evals/run.sh`에 `PARENT`(부모 모델)와 `PLUGIN_DIRS`(배포 전 복사본 로드) 옵션을 추가했다. `evals/handoff.py`는 시나리오별 비용, 보고서 분량, 보고 뒤 호출 수와 그 출력 분량을 낸다.
- **함께 배포된 것** (decision 0.3.7, pi 0.3.3): 브라우저·desktop·기기가 응답하지 않으면 두 번 시도한 뒤 멈추고 보고하는 위임 문구, 그리고 pi의 사용량 한도 fallback. 그전 세션은 pi 0.3.2, decision 0.3.6으로 이 두 가지 없이 돌았다.

## 변경 전후 비교 (run.sh, Opus 부모, 시나리오 8개, 각 1회)

| 라운드 | 통과 | 합계 $ | 보고 뒤 호출 / 출력 분량 | 비고 |
|---|---|---|---|---|
| rp-base | 7/8 | 2.18 | 5회 / 4.1k자 | s01은 위임하지 않았다 |
| rp-new (4000자 기준으로 실험) | 8/8 | 2.22 | 11회 / 12.4k자 | s05: worker 하나가 멈춰 부모가 테스트를 직접 썼다(7회). s01: 파일로 뺀 목록을 부모가 다시 읽어 한 턴이 늘었다 |

두 라운드 모두 정상 위임한 4개 시나리오(s02, s03, s04, s10)에서 비용은 $1.117에서 $1.080으로 3% 줄었다. 재확인 호출은 4회에서 2회로 줄었고, s04 보고는 13.3k자에서 9.2k자가 됐다. 각 1회 실행이라 방향만 보이는 수준이다. s01에서 다시 읽는 일이 생겨 파일로 빼는 기준은 6000자로 되돌렸다.

## 적용한 변경 2 (pi 0.3.4, 261105 배포): 위임 기준을 좁히고 기본을 skills로

- **위임 기준:** "도구 호출 세 번 초과"를 "결과보다 훨씬 큰 출력을 읽는 일(브라우저·desktop·기기 조작, 긴 테스트·빌드 로그, 수십 개 파일 sweep)"로 바꿨다. 위임 안내와 도구 설명 모두 같은 문구다.
- **모드 3단:** `/worker on|skills|off`. 설정 `defaultMode`의 기본값은 `skills`다.
  - `skills`: worker 도구는 살아 있지만 부모 프롬프트에 위임 안내 섹션을 넣지 않고, Agent 차단도 하지 않는다. 스킬 frontmatter의 `delegate:`가 위임을 지시할 때만 쓰인다.
  - `on`: 이전 동작이다. 위임 안내를 넣고 catch-all Agent를 막는다.
  - `off`: 도구도 끈다.
- **android `delegate: quick` 제거:** bench에서 android 위임은 Claude +5%, pi +24%로 손해였다. `control-android`의 `delegate:`를 지우고 find_skill eval 라벨 15개를 `{}`로 고쳤다.

## android: 최근 7일 세션 점검과 `droid` 도구

최근 7일 android 관련 호출은 154건이었다. 실제 작업은 android-macro Claude 세션 5개, 약 123건이었다. 반복과 실패는 다음과 같았다.

| 패턴 | 빈도 | droid에서 바꾼 것 |
|---|---|---|
| 조작 → `sleep` → `dumpsys` top → `phone dump --text` → screencap | 약 40회 | 조작 명령이 끝나면 화면 노드 목록(`라벨 (x,y) Class flags`)과 top을 한 번에 출력한다 |
| 스크롤 → 텍스트 찾기 → 탭 반복 | 여러 세션 | `droid tap "텍스트" --scroll`: 목록 안에서 찾을 때까지 스크롤하고 탭한다. 키보드가 떠 있으면 그 위에서만 스와이프한다(키보드에 "ty"가 입력되던 버그) |
| 한글 입력용 dex를 그때그때 빌드 | 2회 | ClipSet dex를 바이너리에 넣었다. `droid type "밝기" --replace --enter`는 입력 뒤 포커스 필드를 다시 읽어 확인하고 없으면 exit 2 |
| 잠금 상태 grep 반복 | 다수 | `droid state` 한 줄: 화면·잠금·top·키보드·부팅 |
| 무선 연결 실패 진단에 7회 | 1회 | `droid connect`: mdns에서 새 포트를 찾고, 실패 원인(페어링 소실/무선 디버깅 꺼짐/미승인)과 다음 단계를 출력한다 |
| uiautomator 덤프가 느림(5.4s), "could not get idle state" | 다수 | `exec-out … /dev/tty` 한 번(약 2s). 화면이 계속 바뀌면 재시도 없이 스크린샷 경로를 내고 exit 0 |
| "more than one device" | 다수 | `--serial`, `ANDROID_SERIAL`, 준비된 기기 하나 순으로 고르고 아니면 목록과 함께 exit 3 |
| 미디어 push와 정리 | 2세션 | `droid media push/rm`: MEDIA_SCANNER 방송과 `content` 확인까지 |

exit 코드는 0 성공, 1 사용법, 2 조건 미충족, 3 기기 문제다. 소스는 `control-android/scripts/droid/`(Go), 빌드는 `go build -C {baseDir}/scripts/droid -o ~/.local/usr/bin/droid .`, `go test`·`go vet`을 통과한다.

### 재점검 (같은 작업을 새 Sonnet 세션에서, 이전 스킬과 새 스킬 각 2회)

작업: 에뮬레이터에서 설정 검색에 "밝기"를 입력해 결과 문구를 읽고, About emulated device에서 Android version을 읽은 뒤 홈으로 돌아간다. worker는 끄고 스킬만 바꿨다.

| arm | 정답 | 도구 호출 | 실패 호출 | `sleep` | 원시 dump/bounds | $ | 시간 |
|---|---|---|---|---|---|---|---|
| 이전 스킬 1 | ✓ | 27 | 1 | 24 | 12 | 0.320 | 156s |
| 이전 스킬 2 | ✓ | 43 | 0 | 37 | 20 | 0.518 | 261s |
| 새 스킬(droid) 1 | ✓ | 10 | 0 | 0 | 0 | 0.147 | 109s |
| 새 스킬(droid) 2 | ✓ | 8 | 0 | 0 | 0 | 0.130 | 97s |

새 스킬은 도구 호출을 74% 줄였고(평균 35 → 9), 비용은 67%($0.419 → $0.139), 시간은 51%(209s → 103s) 줄였다. 각 2회라 방향을 보는 수준이다. 실제 폰(무선 연결, 잠금, 여러 기기)은 다시 돌리지 않았다. `droid connect`의 원인 판정은 단위 테스트로만 확인했다.

### 2차 보완 (261105): DOM처럼 읽기, 폰 없이 검증

- **노드 덤프:** `NodeDump.java`(dex 내장, app_process)가 uiautomator의 idle 대기 없이 접근성 트리를 같은 XML로 읽는다. `uiautomator dump`는 대체 경로로만 쓴다. 계속 바뀌는 About 화면에서 uiautomator는 11s 뒤 "could not get idle state"로 실패했지만, NodeDump는 1.15s에 노드 51개를 읽었다. 홈 화면에서는 노드 수가 같았다(34개, 1.1s 대 2.0s). 스크린샷은 노드가 없는 것(이미지, 캔버스, 영상, 색)에만 쓴다.
- **고친 결함:**
  - `droid --serial S <cmd>`처럼 플래그를 명령 앞에 두면 serial이 무시됐다.
  - 에뮬레이터가 붙어 있으면 `droid connect`가 끊긴 폰을 다시 붙이지 않았다.
  - 에뮬레이터만 붙어 있으면 폰이 무선 디버깅을 알리지 않는다는 메모를 낸다.
- **폰 없이 확인한 것:**
  - 기기 여러 대: 같은 에뮬레이터를 `127.0.0.1:5555`로 한 번 더 붙였을 때 exit 3과 함께 기기 목록이 나왔다.
  - 잠금: 에뮬레이터에 임시 PIN을 걸고 화면을 껐다 켰을 때 `LOCKED`가 나왔다. PIN은 다시 지웠다.
  - 폰 재연결: 폰은 읽기 명령만 쓰고, 화면 내용은 기록에서 지웠다. `adb disconnect` 뒤 `droid connect`가 mdns로 다시 붙였다.
- **replay (에뮬레이터, 새 스킬 2회):** 둘 다 정답. 도구 호출 7·5, $0.119·0.104, 52s·41s였다. 1차 새 스킬(9회, $0.139, 103s)보다 시간이 약 54% 줄었고, 스크린샷은 0회였다.
- **추적 파일의 실제 식별자:** `droid_test.go`의 폰 serial과 LAN IP를 placeholder(`192.0.2.x`)로 바꿨고, SKILL.md와 phone.md에서 모델명을 지웠다. `dev/decision/candidates/find_skill.jsonl` 172–173행에 실제 IP와 serial이 남아 있다(이전 커밋에 들어감). 지우거나 바꿀지는 사용자가 정한다.

### 자동 슬립 대응 (261105): `droid awake`

조사한 원인은 세 가지다. 첫째, adb로 보낸 입력은 사용자 활동으로 치지 않아서 자동화 중에도 화면이 꺼진다(auto-mobile #536). 둘째, 화면이 꺼지면 폰이 잠긴다. 셋째, Wi-Fi가 쉬면서 무선 디버깅이 끊긴다(Samsung·Xiaomi·Pixel 공통 보고). 이번 세션에서도 폰이 mdns 알림을 멈춰 다시 붙지 못했다.

- **`droid awake [--idle 10m]`:** 원래 `screen_off_timeout`과 `stay_on_while_plugged_in` 값을 저장한다. 그다음 화면 꺼짐 시간을 사실상 무한으로, `stay_on_while_plugged_in`을 7(AC|USB|무선 충전 중 켜짐, scrcpy `--stay-awake`와 같은 값)로 바꾼다.
- **복원:** 기기 쪽 watchdog(nohup sh)이 맡는다. scrcpy의 CleanUp 프로세스와 같은 방식이다. 모든 droid 호출은 원래 보내던 셸 명령 안에서 `beat` 파일을 갱신하므로 round trip이 늘지 않는다. 마지막 호출 뒤 `--idle`이 지나면 watchdog이 원래 값을 되돌리고 끝난다. 에이전트가 죽거나 `rest`를 잊어도, 호스트 연결이 끊겨도 복원된다. `droid rest`는 즉시 복원한다.
- **잠금 설정은 바꾸지 않는다.** `lock_screen_lock_after_timeout`으로 잠금 유예를 늘리는 방법도 있지만 보안 설정이라 쓰지 않는다. 화면이 켜져 있으면 잠기지 않는다.
- **`droid state`:** 실제 폰의 꺼짐 시간이 10분보다 짧으면 `sleeps after Ns idle: run droid awake`를 덧붙인다.
- **`droid connect`:** 안내에 Android 17·adb 37의 adb Wi-Fi 2.0을 추가했다. "이 네트워크에서 항상 허용"을 켜 두면 Wi-Fi가 돌아올 때 자동으로 다시 붙는다.
- **에뮬레이터 검증:**
  - 원래 값을 60000·0으로 두고 `awake --idle 1m`을 실행한 뒤 호출을 멈추자 약 80초 뒤 60000·0으로 돌아왔고, 화면도 원래대로 꺼졌다.
  - 30초마다 호출을 2분 동안 이어 가는 동안에는 계속 깨어 있었다.
  - watchdog은 `adb shell` 세션이 끝난 뒤에도 살아 있었다.
  - `go test`가 통과했다.
- **확인하지 못한 것:**
  - One UI에서 shell 권한으로 두 설정을 쓸 수 있는지.
  - 화면이 계속 켜져 있을 때 무선 디버깅이 끊기지 않는지.

  사용자가 직접 `droid awake` 뒤 긴 작업을 돌려 보면 된다. 출력에는 serial과 timeout만 나온다.

### droid 이후 위임 재측정 (cu-r9, android-ui, 각 3회)

화면을 조작하는 작업(설정 검색 결과 수, About 화면의 Android version)으로 위임과 직접 처리를 비교했다. 실행 조건은 다음과 같다.
- delegate arm에는 `FORCE_DELEGATE=1`로 위임 지시를 붙였다. android의 `delegate:`를 지웠기 때문이다.
- 폰이 보이지 않도록 bench 전용 adb 서버(포트 5038, mdns 끔)를 띄웠다.
- 화면을 함께 쓰므로 `--jobs 1`로 순차 실행했다.

| 부모 | arm | 정답 | 비용 중앙값 (평균) | 시간 중앙값 | 부모 입력 토큰 |
|---|---|---|---|---|---|
| Claude Sonnet | 위임 | 3/3 | $0.096 ($0.108) | 87s | 6.0만 |
| Claude Sonnet | 직접 | 3/3 | $0.111 ($0.111) | 42s | 20.7만 |
| pi grok | 위임 | 3/3 | $0.072 ($0.083) | 87s | 4.5만 |
| pi grok | 직접 | 3/3 | $0.196 ($0.199) | 64s | 22.8만 |

- **Claude:** 비용은 거의 같다(평균 −2%, 중앙값 −13%). 대신 2배 느리다. 직접 처리 기본값을 유지한다.
- **pi:** 위임하면 58–63% 싸다. 예전 android 측정(+24%)은 getprop만 읽는 작업이어서 결론이 달랐다. 화면을 조작하면 직접 처리 쪽 맥락이 커진다.
- **현재 설정의 한계:** `delegate:`는 두 하네스에 같은 값으로 적용된다(CONTRACTS.md). 지금 설정으로는 pi가 android 위임으로 아낄 몫을 잃는다. 하네스별 값(예: `delegate: {pi: quick}`)을 지원할지는 사용자가 정한다.

## 남은 일

- **Opus 부모로 위임과 직접 처리 비교:** `CLAUDE_PARENT=opus python3 -I ~/.agents/plugins/pi/evals/computer-use.py <round> --runs 3 --only web,desktop,small --harness claude --jobs 4`. Claude 판정을 Opus에서도 확정하려면 필요하다.
- **변경 전후 비교 3회 반복:** `PARENT=opus PLUGIN_DIRS="<copy>/pi <copy>/decision" bash evals/run.sh <round> s01-search s02-tests s03-testfile s04-parallel3 s05-parallel-write s10-mixed s11-rename s12-chain`, 이어서 `python3 -I evals/handoff.py <round dirs>`.
- **배포 1주 뒤 30일 재확인 sweep 재측정:** 보고서 대비 재확인 분량 93%가 크게 줄었는지 본다.
- **폰 연결이 바뀌는 경우 수동 확인:** 무선 디버깅을 껐다 켜 포트가 바뀌었을 때와 페어링을 지웠을 때 `droid connect`의 판정을 본다. 폰 설정을 바꿔야 해서 사용자가 직접 해야 한다. 원인 판정 로직은 단위 테스트로 확인했다. 폰 화면을 쓰는 replay는 하지 않는다(폰 정보는 민감정보).
- **skills 기본값 1주 뒤 확인:** 최근 7일 Claude 기록에서 `mcp__pi__worker` 호출 수와 그 호출이 `delegate:` 스킬에서 나왔는지 센다. 일반 세션에서 위임이 0에 가까워야 한다.
