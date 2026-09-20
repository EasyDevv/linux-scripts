# stash.localhost 502 — NFS automount 영구 dead

2026-09-20. `http://stash.localhost/` 접속 불가. stash 코드 문제가 아니라 **호스트의 tailscale NFS automount가 죽어** stash가 기동 실패한 건.

## 증상

- `curl http://stash.localhost/` → **502**, body `Upstream unavailable`
- executor 프록시(`127.0.0.1:80`, `executor.service`)는 정상. upstream만 없음
- `/run/user/1000/executor/runtime.json` → `stash: state=backoff, lastExit exitCode 1, restartAttempts 3`
- stash 바이너리 수동 실행 시:
  ```
  Error: Custom { kind: Other, error: "Permission denied (os error 13)" }
  ```
- stash 설정(`~/.config/stash/config.toml`)의 `sqlite_path=/mnt/shared/.stash/file.db`,
  `download_root=/mnt/shared` → `/mnt/shared` 미마운트 상태라 실패

## 원인

부팅 시 tailscale 인터페이스의 **라우트(netmap)가 생기기 전에 systemd가 마운트를 시도**했다.

| 시각 (KST) | 이벤트 |
|---|---|
| 08:00:44 | `mnt-shared.automount` armed |
| 08:00:47 | stash(pid 1230)가 `/mnt/shared` 접근 → automount 트리거 |
| 08:00:48 | `tailscaled.service` active 진입 (Type=notify READY) |
| 08:00:52 | `network-online.target` 도달 (마운트 유닛의 `After=`에 이미 포함) |
| 08:00:52–53 | `mount.nfs4: Network is unreachable for 100.93.169.17:/home/easydev/shared/` |
| 08:01:12 | tailscaled `control: netmap: got new dial plan from control` ← 실제 라우트 확보 |

```
08:00:53 mnt-shared.mount: Start request repeated too quickly.
08:00:53 mnt-shared.mount: Failed with result 'start-limit-hit'.
08:00:53 mnt-shared.automount: Failed with result 'mount-start-limit-hit'.
```

핵심 결함은 **실패가 영구 상태가 되는 것**이다. mount 유닛이 10초/5회 start limit을 넘기면
systemd `automount_trigger_notify`(`src/core/automount.c`)가 그 상태를 automount로 전파해
`AUTOMOUNT_FAILURE_MOUNT_START_LIMIT_HIT`으로 dead 고정 → `reset-failed` 전까지 이후 접근도 모두 실패.
그래서 executor가 stash를 재시도해도 마운트가 살아나지 않아 세션 내내 복구되지 않았다.

확인한 제약:

- `tailscaled.service`는 netmap 생성 **약 24초 전에** READY를 보낸다 → `After=tailscaled.service`만으로는 부족
- mount 유닛은 `ExecStartPre`를 지원하지 않는다
  (`Unknown key 'ExecStartPre' in section [Mount], ignoring`)
- `DefaultTimeoutStartSec=15s`가 전역 설정이다 (`/usr/lib/systemd/system.conf.d/00-timeout.conf`, `cachyos-settings` 패키지 소유)

## 조치 (수정 위치)

소스 변경 없음. **stash/executor 코드·설정은 손대지 않았고, 호스트 systemd/fstab만 수정**했다.

### 1. `/etc/fstab` — NFS 3줄 (19–21행)

각 줄 옵션 끝에 3개 옵션을 append:

```
x-systemd.requires=tailscaled.service,x-systemd.after=network-online.target,x-systemd.mount-timeout=45
```

수정 후 19–21행의 옵션 필드:

| 행 | 마운트 | 옵션 |
|---|---|---|
| 19 | `/mnt/rose/media` | `_netdev,noauto,x-systemd.automount,rw,x-gvfs-hide,x-systemd.idle-timeout=360,nofail,soft,timeo=5,retrans=2,x-systemd.requires=tailscaled.service,x-systemd.after=network-online.target,x-systemd.mount-timeout=45` |
| 20 | `/mnt/lily/downloads` | 위와 동일 |
| 21 | `/mnt/shared` | `_netdev,noauto,x-systemd.automount,rw,x-gvfs-hide,nofail,soft,timeo=5,retrans=2,x-systemd.requires=tailscaled.service,x-systemd.after=network-online.target,x-systemd.mount-timeout=45` |

- 백업: `/etc/fstab.bak-260920-101751` (수정 전, 1919 bytes)
- 수정 후: 2228 bytes, mode `644 root:root`, sha256 `a932cf2ae8479a707dba84217da54422f1ed2713ca99b0b3dff89748bddb2d17`
- 적용: `sudo systemctl daemon-reload`

### 2. drop-in 3개 (신규 생성, 324 bytes, `644 root:root`)

- `/etc/systemd/system/mnt-shared.mount.d/start-limit.conf`
- `/etc/systemd/system/mnt-rose-media.mount.d/start-limit.conf`
- `/etc/systemd/system/mnt-lily-downloads.mount.d/start-limit.conf`

3개 파일 내용 동일:

```ini
[Unit]
# NFS automount: 10s/5-failure start limit is hit while tailscaled is still
# fetching its netmap, and systemd propagates that state to the automount unit
# (AUTOMOUNT_FAILURE_MOUNT_START_LIMIT_HIT), leaving it dead until reset-failed.
# Unlimited interval keeps later accesses able to retry.
StartLimitIntervalSec=0
```

### 3. 임시 검증 산출물 (남아 있지 않음)

`/run/systemd/system/run-probenfs.mount`, `run-probenfs.automount`, `run-probe2.mount`, `run-probe2.automount`
— A/B 실험용으로 만들고 삭제. `/run`이라 재부팅 시에도 소멸. `/tmp/g`도 삭제. **잔존 파일 없음.**

## 확인

적용 후:

| 검증 | 결과 |
|---|---|
| `curl -o /dev/null -w '%{http_code}' http://stash.localhost/` | 200 |
| `/stash/jobs`, `/stash/files` | 200 / 200 |
| `/proc/mounts` | 3개 모두 `nfs4` 마운트 (`/mnt/shared`, `/mnt/rose/media`, `/mnt/lily/downloads`) |
| `systemctl show mnt-shared.mount -p StartLimitIntervalUSec -p TimeoutUSec` | `0` / `45s` |
| `systemctl show mnt-shared.mount -p After` | `tailscaled.service`, `network-online.target` 포함 |
| executor `runtime.json` | `stash: state=running, pid 1058472` |

A/B 실험 (격리 probe 유닛, 10초 내 8회 실패):

```
FIXED   (StartLimitIntervalSec=0) automount: active / waiting   ← 재시도 가능
CONTROL (기본 10s·5회)            automount: failed / failed    ← 이번 장애와 동일한 영구 고정
```

실제 복구 사례: 10:23:31 `/mnt/lily/downloads` 첫 마운트가 15초 timeout으로 실패했지만
automount가 살아 있어 10:23:50 재접근에서 2초 만에 마운트됐다 (수정 전이면 dead 고정).

`x-systemd.mount-timeout=45`는 fstab 생성기로 검증했다:

```bash
SYSTEMD_FSTAB=/tmp/g/fstab /usr/lib/systemd/system-generators/systemd-fstab-generator /tmp/g/out /tmp/g/e /tmp/g/l
# → mnt-shared.mount: TimeoutSec=45s
```

## 재발 시 복구

```bash
systemctl status mnt-shared.mount mnt-shared.automount     # start-limit-hit 인지 확인
findmnt -n -o SOURCE,FSTYPE /mnt/shared                    # 마운트 여부
sudo systemctl reset-failed mnt-shared.mount mnt-shared.automount
sudo systemctl start mnt-shared.automount
cd ~/.local/share/scripts/dev/executor && ./executor.sh start stash   # executor 재기동
```

진단 순서: `502` → `runtime.json` 상태 → `systemctl status mnt-*.{mount,automount}` → `findmnt`.
executor 설정은 `~/.config/systemd/user/executor.json` (`stash` 항목이 `stash-run.sh --port 45122` 실행),
stash 실행 로그는 `executor log stash`.

## 되돌리기

```bash
sudo cp /etc/fstab.bak-260920-101751 /etc/fstab
sudo rm -rf /etc/systemd/system/mnt-shared.mount.d \
            /etc/systemd/system/mnt-rose-media.mount.d \
            /etc/systemd/system/mnt-lily-downloads.mount.d
sudo systemctl daemon-reload
```

## 관련

- `../stash-stack.md` — stash 스택 구성
- `/etc/fstab` (19–21행), `/etc/systemd/system/mnt-*.mount.d/start-limit.conf`
- `/usr/lib/systemd/system.conf.d/00-timeout.conf` — 전역 15초 timeout (`cachyos-settings` 소유, 수정하지 않음)
