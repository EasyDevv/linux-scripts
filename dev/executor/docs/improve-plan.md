# Executor Bun 1.4 성능·안정성 개선 계획

## 1. 목적

현재 TypeScript/Bun 구조와 다음 외부 계약을 유지하면서 executor의 장애 격리, 장시간 안정성, 프록시 처리량을 개선한다.

- 설정: `~/.config/systemd/user/executor.json`
- 공개 명령: `executor run|list|log|status|start|stop|reload|service`
- 라우팅: `http://<instance>.localhost`
- 로그: systemd journal과 `executor/<instance>` 태그
- 실행 환경: Linux user systemd, Bun **1.4.x**

완료 후에는 잘못된 프로젝트 하나, 누락된 실행 파일, 반복 종료, 느린 upstream, WebSocket 과부하가 다른 프로젝트나 supervisor 전체를 중단시키지 않아야 한다.

## 2. 비목표

- Rust 재작성
- 프로젝트별 systemd unit 전환
- `executor.json` 스키마의 호환성 파괴
- Vite 또는 각 프로젝트의 실행 명령 변경
- 검증되지 않은 `/proc` 직접 구현으로 `ps`, `lsof`를 일괄 교체
- HTTP/2·HTTP/3 등 Bun 1.4의 실험적 기능 도입
- 단순 줄 수 감소를 위한 모듈 재분할

## 3. 기준선

확인된 현재 상태:

- Bun: `1.4.0`
- 설정 항목 12개, 활성 항목 8개
- supervisor RSS 약 45 MiB, 관찰 시 CPU 약 0.2%
- systemd unit의 `KillMode=control-group`, `Restart=always`, `RestartSec=1`
- 테스트: `config.test.ts`, `local-proxy.test.ts`의 22개 테스트 통과
- 현재 `Bun.serve`, `Bun.spawn`, `Bun.spawnSync`, `Bun.file`, `Bun.write`, `Bun.sleep`을 사용
- hot path는 `local-proxy.ts`; 설정 reconcile과 프로세스 전환은 control path

관찰된 대표 장애:

- `/usr/bin/systemd-cat`이 없을 때 `Bun.spawn()`이 `ENOENT`를 던졌다.
- `ProcessManager.start()` 내부의 백그라운드 loop rejection이 supervisor까지 종료시켰다.
- systemd가 executor를 반복 재시작하면서 정상 프로젝트도 모두 재시작되었고 `start-limit-hit`에 도달했다.

## 4. 설계 원칙과 불변조건

### 4.1 장애 격리

- 인스턴스의 spawn, 로그, readiness, restart 실패는 해당 인스턴스 상태로 귀속한다.
- 한 인스턴스 오류는 `runSupervisor()`의 reconcile loop를 reject하지 않는다.
- 백그라운드 Promise는 모두 소유자를 가지며, `void promise`를 쓸 때도 같은 위치에서 rejection을 처리한다.
- supervisor를 종료할 수 있는 오류는 설정 전체를 해석할 수 없는 경우와 proxy listen 실패 같은 전역 불변조건 위반으로 제한한다.

### 4.2 자원 제한

- restart storm은 지수 backoff와 상한으로 제한한다.
- HTTP timeout 시 upstream body를 `arrayBuffer()`로 끝까지 적재하지 않는다.
- WebSocket 연결 전 큐와 송신 backpressure를 명시적으로 제한한다.
- sync subprocess는 control path에서만 사용하고 timeout과 `maxBuffer`를 둔다.
- hot path에서 전체 응답을 버퍼링하거나 매 요청 subprocess를 실행하지 않는다.

### 4.3 종료 정확성

- 정상 종료는 SIGTERM → 유예 시간 → SIGKILL 순서로 동작한다.
- proxy는 먼저 신규 요청을 차단하고 진행 중 요청을 유예 시간 동안 종료한다.
- 모든 managed loop가 종료된 뒤 supervisor가 끝난다.
- Bun 1.4의 `--no-orphans`는 마지막 안전망일 뿐 정상 종료 구현을 대체하지 않는다.

### 4.4 호환성

- 기존 JSON과 CLI 동작을 먼저 characterization test로 고정한다.
- 성능 개선은 오류 응답, redirect, streaming, WebSocket subprotocol을 바꾸지 않는다.
- 성능 최적화는 측정으로 입증하며 control path의 가독성을 희생하지 않는다.

## 5. 목표 구조

현재 모듈 이름과 책임을 유지하고 관찰된 마찰이 있는 세 모듈만 깊게 만든다.

```text
main.ts
  └─ commands.ts
      ├─ config.ts            설정 검증·원자적 변경
      ├─ supervisor.ts        desired/actual reconcile만 담당
      │   ├─ process-manager.ts  인스턴스 상태·spawn·backoff·종료
      │   └─ local-proxy.ts      HTTP/WS 전달·timeout·backpressure
      ├─ readiness.ts         CLI readiness 확인
      └─ journal.ts           journal/systemd 명령
```

새 공개 seam은 만들지 않는다. 테스트에 필요한 clock, spawn, journal 의존성은 `ProcessManager` 구현 내부 seam으로 유지한다.

## 6. 단계별 실행 계획

각 단계는 독립적으로 배포·롤백 가능해야 한다. 앞 단계의 수용 조건을 통과하기 전 다음 단계로 진행하지 않는다.

### Phase 0 — 런타임 고정과 기준선 측정

대상:

- `executor.sh`
- 상위 `package.json`
- `main.ts`
- 신규 `bench/` 또는 `scripts/` 아래 측정 스크립트

작업:

1. 설치 루트의 `packageManager`를 실제 고정 버전인 `bun@1.4.0`으로 명시한다.
2. supervisor 실행에 `--no-env-file`을 적용한다.
   - systemd가 주입한 환경과 `executor.json`의 인스턴스 환경만 supervisor가 사용한다.
   - 자식 프로젝트가 자신의 cwd에서 실행하는 Bun의 `.env` 로딩은 변경하지 않는다.
3. `--no-orphans`를 canary에서 먼저 검증한 후 적용한다.
   - 정상 SIGTERM 때 기존 graceful stop이 먼저 완료되는지 확인한다.
   - executor가 SIGKILL되었을 때 descendants가 남지 않는지 확인한다.
4. 시작 시 `Bun.version`이 `1.4.`로 시작하지 않으면 실제 버전과 요구 버전을 포함해 fail closed한다.
5. 다음 기준선을 같은 머신에서 3회 이상 수집한다.
   - 10분 idle CPU와 RSS
   - config reload 시간
   - 1 KiB HTTP 응답 throughput/p50/p95
   - 64 MiB streaming 전달 중 peak RSS
   - WebSocket echo 처리량과 peak RSS
   - 8개 프로젝트 동시 시작 완료 시간
6. benchmark는 기본 테스트와 분리하고 결과를 저장하지 않는다. 운영 경로, 도메인, 명령은 문서에 기록하지 않는다.

수용 조건:

- 기존 22개 테스트 통과
- 기존 8개 활성 프로젝트가 동일하게 기동
- `.env` 비활성화가 supervisor 환경만 제한함을 테스트
- 기준선 결과가 재현 가능한 명령과 함께 기록됨

### Phase 1 — subprocess 인터페이스를 fail-safe로 강화

대상:

- `utils.ts`
- `utils.test.ts` 신규
- `journal.ts`
- `process-manager.ts`

작업:

1. subprocess 실행 결과를 하나의 내부 타입으로 정규화한다.
   - `ok`, `exitCode`, `signalCode`, `stdout`, `stderr`, `spawnError`, `timedOut`
   - spawn throw와 non-zero exit를 구분한다.
2. `runText` 계열에 명시적 timeout과 `maxBuffer`를 추가한다.
   - CLI 출력처럼 사람이 요청한 긴 journal 스트림은 별도 unbounded/streaming 경로를 사용한다.
   - supervisor의 `ps`, `lsof`, `journalctl`, 보조 logging 호출은 bounded 경로만 사용한다.
3. `Bun.spawn()`의 `onExit`/`proc.exited`를 한 module 안에서 정규화하고 호출자가 Bun 세부 동작을 알지 않게 한다.
4. `journalLog()`를 best-effort로 변경한다.
   - `systemd-cat` spawn 실패가 인스턴스 loop를 종료시키지 않는다.
   - 실패 시 systemd가 수집하는 supervisor stderr로 한 번만 fallback한다.
   - 동일 오류는 rate limit하여 journal 폭주를 막는다.
5. supervisor 시작 시 외부 실행 파일과 proxy bind를 preflight한다.
   - 전역 필수 항목과 인스턴스별 항목을 구분한다.
   - `systemd-cat`은 fallback 가능 항목으로 취급한다.
   - cwd나 shell 실행 준비가 잘못된 인스턴스는 `blocked`로 표시하고 나머지는 시작한다.
6. `spawnSync`는 hot path에서 금지한다. control path에서 유지할 경우 timeout과 출력 상한을 반드시 지정한다.

수용 조건:

- `systemd-cat` 누락 fixture에서 supervisor가 살아 있고 다른 인스턴스가 실행됨
- 존재하지 않는 cwd/명령은 해당 인스턴스만 `blocked`가 됨
- helper timeout과 output overflow가 테스트에서 bounded result로 반환됨
- 의도하지 않은 unhandled rejection이 없음

### Phase 2 — 인스턴스 상태 머신과 restart storm 차단

대상:

- `process-manager.ts`
- `process-manager.test.ts` 신규
- `types.ts`
- 필요 시 `paths.ts`

상태:

```text
stopped → starting → running → stopping → stopped
             └────→ backoff ────┘
             └────→ blocked
```

작업:

1. `ManagedProcess`가 다음 snapshot을 제공하도록 인터페이스를 깊게 만든다.
   - `state`, `pid`, `startedAt`, `restartAttempts`, `nextRetryAt`, `lastExit`, `lastError`
2. `start()`가 만든 background loop는 자체 최상단 `try/catch/finally`를 가진다.
   - spawn 실패와 exit wait 실패를 상태로 변환한다.
   - loop Promise는 `stop()`이 항상 await할 수 있게 보존한다.
3. restart 정책을 적용한다.
   - 지연: `1s → 2s → 4s → 8s → 16s → 30s`
   - ±20% jitter
   - 60초 이상 정상 실행하면 attempt를 0으로 reset
   - stop/reload 요청은 backoff sleep을 즉시 취소
4. `restart()`와 `stop()`을 인스턴스별 직렬 operation으로 만든다.
   - proxy timeout restart, reconcile 변경, CLI stop이 겹쳐도 하나의 전이만 수행한다.
5. 시작 전 포트 사용자를 무조건 `fuser -k` 하는 동작을 제거한다.
   - PID 파일과 descendant 관계로 현재 인스턴스 소유가 확인된 프로세스만 종료한다.
   - 소유를 확인할 수 없는 포트 충돌은 occupant 정보를 기록하고 해당 인스턴스를 `blocked` 처리한다.
6. PID 파일의 PID만으로 프로세스 신원을 확정하지 않는다.
   - 기존 구현으로 즉시 rollback할 수 있도록 PID 파일은 숫자 형식을 유지한다.
   - 별도 versioned identity sidecar에 Linux `/proc/<pid>/stat`의 start time 또는 command fingerprint를 저장해 PID 재사용을 검출한다.
   - sidecar가 없는 기존 PID 파일은 보수적으로 검증하고, 다음 정상 spawn에서 sidecar를 생성한다.
7. SIGTERM 유예 후 남은 process tree에만 SIGKILL한다. 종료 결과를 snapshot에 남긴다.
8. `Bun.Subprocess.resourceUsage()`는 종료 후 진단 로그/테스트 계측에만 사용하고 restart hot path의 필수 조건으로 만들지 않는다.

수용 조건:

- 실패하는 인스턴스가 backoff되는 동안 정상 인스턴스 PID 유지
- 5분 failure storm에서 무제한 spawn이 발생하지 않음
- backoff 중 stop이 1초 이내 반응
- 동시에 여러 번 restart해도 실제 restart는 한 번만 수행
- stale PID 파일이 다른 프로세스를 종료시키지 않음
- 외부 프로세스가 점유한 포트를 자동 SIGKILL하지 않음
- SIGTERM 후 orphan 0개

### Phase 3 — supervisor reconcile과 설정 감시 안정화

대상:

- `supervisor.ts`
- `supervisor.test.ts` 신규
- `config.ts`
- `paths.ts`

작업:

1. reconcile을 두 부분으로 나눈다.
   - 순수한 `desired → plan(start/stop/restart/keep)` 계산
   - plan 실행
   - plan 계산은 내부 함수로 두고 interface-level test를 제공한다.
2. 각 인스턴스 plan 실행 오류를 개별적으로 수집한다. 한 항목 실패 후에도 나머지 plan을 계속 실행한다.
3. `reconcile()` 중첩 실행을 금지한다.
   - 실행 중 SIGHUP/config 변경은 `dirty` flag 하나로 합친다.
   - 현재 reconcile 종료 직후 한 번만 다시 실행한다.
4. 2초 full polling을 다음 hybrid 방식으로 교체한다.
   - 설정 디렉터리를 `fs.watch`로 감시하여 atomic rename도 포착
   - 50~100ms debounce
   - SIGHUP 즉시 wake 유지
   - watcher 유실 복구용 30초 safety poll 유지
   - watcher error 시 polling-only mode로 자동 강등
5. config 내용 fingerprint가 동일하면 parse와 reconcile을 건너뛴다.
6. config 읽기 실패 시 마지막 정상 desired state를 유지한다. 잘못된 파일 때문에 실행 중인 프로젝트를 중단하지 않는다.
7. config/control write를 같은 디렉터리의 임시 파일에 쓴 뒤 sync/rename하는 crash-safe 경로로 통일한다.
8. 서로 다른 CLI 프로세스의 동시 write를 lock file(`open(..., "wx")`, timeout, stale-owner 검증)로 직렬화하여 lost update를 막는다.
9. runtime 상태 파일에 인스턴스 snapshot을 원자적으로 기록한다.
   - 명령 문자열과 환경값은 기록하지 않는다.
   - `status`가 `running/backoff/blocked/stopped`와 마지막 오류를 표시하게 한다.

수용 조건:

- config atomic rename 한 번당 reconcile 최대 1회
- watcher 실패 후 safety poll로 변경 반영
- malformed config 동안 기존 프로세스 PID 유지
- config 복구 후 별도 supervisor restart 없이 반영
- 동시 `start/stop/reload`에서 JSON 손상과 lost update 없음
- 한 인스턴스 plan 실패 후 나머지 항목 plan 완료
- idle file read/wakeup 횟수가 기존 2초 polling 대비 감소

### Phase 4 — `Bun.serve` HTTP proxy hot path 최적화

대상:

- `local-proxy.ts`
- `local-proxy.test.ts`
- benchmark 스크립트

작업:

1. streaming을 유지한다.
   - request body와 `response.body`를 그대로 전달한다.
   - `arrayBuffer()`, `text()`, `clone()`으로 전체 body를 적재하지 않는다.
   - Bun 1.4의 `Bun.serve`/`fetch` ReadableStream backpressure를 활용한다.
2. 현재 `Promise.race + setTimeout + drain(response.arrayBuffer())`를 abort 가능한 upstream fetch로 교체한다.
   - navigation timeout 시 upstream fetch를 실제 abort한다.
   - 빠르게 완료된 요청의 timer를 즉시 해제한다.
   - client disconnect 신호를 upstream 취소에 연결한다.
3. navigation과 일반 요청의 정책을 분리한다.
   - HTML navigation: 기존 5초 health 판단 유지
   - 일반 요청/streaming: 임의의 5초 timeout을 적용하지 않음
   - SSE/장기 stream은 `server.timeout(request, 0)` 적용 조건을 characterization test로 고정
4. `Bun.serve` 옵션을 Bun 1.4 기준으로 명시한다.
   - `hostname: "127.0.0.1"` 유지
   - HTTP `idleTimeout`은 dev server/SSE 테스트 후 명시
   - `maxRequestBodySize`는 현재 실제 upload 요구량을 측정한 뒤 명시하여 버전 기본값 변화 방지
   - HTTP/2·HTTP/3는 WebSocket 호환성과 안정성 때문에 비활성 유지
5. `error` handler를 추가해 handler exception을 request-level 502/500과 rate-limited log로 격리한다.
6. forwarding header 계약을 테스트한다.
   - `host`, `x-forwarded-host`, `x-forwarded-proto`
   - hop-by-hop header 제거
   - redirect/location, cookies, cache headers 보존
   - 현재 decompression 동작에 맞춘 `content-encoding/content-length` 처리
7. root index HTML의 instance 이름은 escape하여 설정 이름이 HTML로 실행되지 않게 한다.
8. built-in metric인 `pendingRequests`, `pendingWebSockets`를 상태 snapshot에 노출하되 요청마다 로그하지 않는다.
9. graceful shutdown 시 `await server.stop()`으로 신규 연결을 막고, 제한 시간 초과 때만 `await server.stop(true)`를 호출한다.

수용 조건:

- 기존 HTTP/WebSocket 테스트 전부 통과
- timeout 요청 후 upstream fetch와 timer가 남지 않음
- 64 MiB streaming 중 응답 크기에 비례한 RSS 증가가 없음
- client disconnect 후 upstream 작업이 취소됨
- slow/SSE 응답이 설정된 idle 정책에서 유지됨
- proxy throughput이 기준선보다 10% 이상 하락하지 않음
- proxy p95 latency가 기준선보다 10% 이상 악화되지 않음
- handler exception이 supervisor를 종료시키지 않음

### Phase 5 — WebSocket queue와 backpressure 제한

대상:

- `local-proxy.ts`
- `local-proxy.test.ts`

작업:

1. upstream 연결 전 메시지 queue에 byte 및 message count 상한을 둔다.
   - 초기값 후보: 1 MiB 또는 256 messages 중 먼저 도달하는 값
   - 실제 HMR 트래픽 측정 후 확정
2. upstream connect timeout을 둔다. timeout 시 client를 1013 또는 명시된 내부 정책 code로 종료하고 queue를 해제한다.
3. upstream → client 전달에서 `ServerWebSocket.send()` 반환값을 처리한다.
   - `-1`: Bun client WebSocket의 `pause()`로 upstream read를 멈춤
   - server socket `drain`에서 `resume()`
   - `0`: 양쪽 연결 정리
4. client → upstream은 `bufferedAmount` 상한을 감시한다. 상한 초과 시 무한 buffering 대신 연결을 종료한다.
5. Bun 1.4 문서 기본값에 의존하지 않고 `idleTimeout`과 `maxPayloadLength`를 명시한다.
   - 기본 호환 후보: 120초, 16 MiB
   - 실제 dev HMR 동작을 확인한 후 더 낮출지 결정
6. close/error/open race마다 양쪽 socket과 queue가 정확히 한 번 정리되게 한다.
7. `perMessageDeflate`는 CPU 비용과 HMR 메시지 크기를 측정하기 전 활성화하지 않는다.

수용 조건:

- 연결되지 않는 upstream으로 메시지를 계속 보내도 RSS가 queue 상한 근처에서 bounded
- 느린 browser/client에서 upstream read가 pause되고 drain 후 resume
- close/error race에서 열린 반대편 socket과 timer가 남지 않음
- subprotocol 전달과 양방향 binary/text 전달 유지
- WebSocket benchmark 처리량 10% 이상 회귀 없음

### Phase 6 — 운영 관찰성 및 systemd 정책 정리

대상:

- `commands.ts`
- `journal.ts`
- `supervisor.ts`
- `~/.config/systemd/user/executor.service` 배포 변경
- 관련 테스트와 운영 문서

작업:

1. `executor status`에 다음을 표시한다.
   - supervisor uptime/version
   - instance state/PID/restartAttempts/nextRetryAt
   - 마지막 exit code/signal과 redacted error
   - proxy pending request/WebSocket 수
2. 상태 변경만 journal에 기록한다. 2초 또는 30초 reconcile마다 동일 상태를 반복 기록하지 않는다.
3. 오류 메시지에 env 값, token, 전체 command를 자동 포함하지 않는다. command가 필요할 때도 설정된 문자열만 사용하고 환경은 redaction한다.
4. systemd 정책을 restart backoff와 조화시킨다.
   - supervisor 자체에는 `Restart=on-failure` 또는 현재 `always` 유지 여부를 fault-injection 결과로 결정
   - `StartLimitIntervalSec`/`StartLimitBurst`를 명시
   - `TimeoutStopSec`를 실제 8개 프로젝트 graceful stop p95보다 길게 설정
   - `KillMode=control-group` 유지
5. Bun 1.4 heap/CPU 문제 조사 runbook에 `--heap-prof-md`, process RSS, journal query 명령을 기록한다. profiling flag는 상시 활성화하지 않는다.
6. canary에서 `--no-orphans`와 systemd control-group 종료가 중복되어 정상 종료를 방해하지 않는지 재확인한다.

수용 조건:

- 운영자가 1개 명령으로 blocked/backoff 원인을 확인 가능
- 로그에 설정 환경값이나 secret이 노출되지 않음
- supervisor fault injection에서 start-limit lockout 없이 자동 복구하거나 명확히 fail closed
- 정상 systemd stop에서 SIGKILL 없이 종료
- 강제 종료에서 orphan 0개

### Phase 7 — 장시간 검증과 단계적 배포

1. 테스트 환경에서 fault matrix를 실행한다.
2. 중요도가 낮은 1~2개 인스턴스로 canary한다.
3. 전체 8개 인스턴스로 24시간, 이후 7일 soak test를 수행한다.
4. 기준선을 동일 조건으로 다시 측정한다.
5. 모든 gate 통과 후 기존 systemd ExecStart를 갱신한다.

최종 성능 gate:

- idle CPU: 기준선 이하 또는 통계적으로 유의한 회귀 없음
- idle RSS: 64 MiB 이하, 24시간 증가량 10 MiB 이하
- HTTP throughput/p95: 기준선 대비 10% 이내
- 64 MiB streaming: payload 크기에 비례하는 heap 증가 없음
- WebSocket queue: 설정 상한을 넘는 무제한 성장 없음
- config idle wakeup: 기존 2초 polling보다 감소

최종 안정성 gate:

- 7일 동안 supervisor 비계획 종료 0회
- 인스턴스 실패가 다른 인스턴스 PID를 변경하지 않음
- malformed config에서 마지막 정상 상태 유지
- spawn ENOENT, journal failure, port conflict, hung upstream 모두 격리
- SIGTERM 및 SIGKILL 시나리오 후 orphan 0개
- start/stop/reload 동시 실행에서 config 손상 0회

## 7. 필수 테스트 매트릭스

| 영역 | 시나리오 | 기대 결과 |
|---|---|---|
| Spawn | executable ENOENT | 해당 인스턴스만 blocked/backoff |
| Spawn | cwd ENOENT | 다른 PID 유지 |
| Spawn | 즉시 exit 반복 | bounded exponential backoff |
| Spawn | 60초 이상 정상 후 exit | attempt reset 후 1초부터 재시작 |
| Logging | `systemd-cat` 없음 | fallback log, 인스턴스 실행 유지 |
| Config | malformed JSON | 마지막 정상 desired state 유지 |
| Config | atomic rename | reconcile 1회 |
| Config | CLI 동시 write | lost update/JSON 손상 없음 |
| Port | 외부 프로세스가 점유 | 외부 PID 생존, instance blocked |
| Stop | backoff 중 SIGTERM | 즉시 취소, orphan 없음 |
| HTTP | upstream refused | bounded 503, supervisor 생존 |
| HTTP | navigation hang | 5초 후 abort, restart 정책 적용 |
| HTTP | 64 MiB stream | body 전체 buffering 없음 |
| HTTP | client disconnect | upstream abort |
| HTTP | SSE/느린 응답 | 명시된 idle 정책대로 유지 |
| WebSocket | upstream connect hang | queue bounded, timeout close |
| WebSocket | client가 느림 | pause/drain/resume |
| WebSocket | 16 MiB 초과 payload | 명시된 정책대로 close |
| Race | proxy restart + config reload + stop | 한 번의 직렬 상태 전이 |
| Runtime | supervisor SIGKILL | systemd/`--no-orphans` 후 orphan 없음 |

## 8. 검증 명령

구현 단계에서 최소 다음을 실행한다.

```bash
bun --version
bun test ./config.test.ts ./local-proxy.test.ts
bun test ./utils.test.ts ./process-manager.test.ts ./supervisor.test.ts
bun test
```

정적 진단은 변경 파일마다 LSP diagnostics를 먼저 확인한다. 이후:

```bash
systemd-analyze --user verify ~/.config/systemd/user/executor.service
systemctl --user daemon-reload
systemctl --user restart executor.service
systemctl --user show executor.service \
  -p ActiveState -p SubState -p MainPID -p NRestarts \
  -p MemoryCurrent -p TasksCurrent
executor status
```

운영 검증에서는 실제 설정 내용이나 환경값을 출력하지 않고 항목 수, 상태, PID, 자원 지표만 수집한다.

## 9. 롤백

- 단계마다 별도 commit으로 유지한다.
- JSON 스키마를 바꾸지 않아 이전 TypeScript 구현이 동일 설정을 읽을 수 있게 한다.
- runtime PID/state 파일은 version field를 두고 이전 구현이 모르는 파일을 안전하게 무시하게 한다.
- `executor.sh`는 version control의 이전 revision으로 복구한다. 저장소 밖의 user unit은 변경 전에 XDG runtime 아래의 mode `0600` 로컬 백업으로 보존하며 저장소에 복사하지 않는다.
- canary 실패 시 해당 단계의 코드와 ExecStart flag만 되돌리고 `daemon-reload` 후 restart한다.
- rollback 후 모든 활성 인스턴스의 PID/port/readiness와 orphan 부재를 다시 확인한다.

## 10. 구현 우선순위

성능보다 장애 전파 차단을 먼저 완료한다.

1. Phase 0: 기준선과 Bun 1.4 실행 계약
2. Phase 1: spawn/log 오류 정규화
3. Phase 2: 상태 머신과 backoff
4. Phase 3: reconcile 직렬화와 config 안정성
5. Phase 4: HTTP abort/streaming hot path
6. Phase 5: WebSocket backpressure
7. Phase 6: 관찰성/systemd 정책
8. Phase 7: soak 및 배포

Phase 1~3만으로 최근 `systemd-cat ENOENT → executor 전체 crash loop` 장애를 차단할 수 있다. Phase 4~5는 Bun 1.4의 stream backpressure와 `Bun.serve` 특성을 활용해 처리량을 유지하면서 메모리 상한을 만든다. 측정에서 이득이 확인되지 않는 추가 추상화나 `/proc` 재구현은 수행하지 않는다.
