# stash.localhost 502 → NFS automount 죽음 (2026-09-20)

## 증상
`http://stash.localhost/` → `502 Upstream unavailable` (executor 프록시 127.0.0.1:80은 정상).
실제 원인은 stash가 `Permission denied (os error 13)`로 exit 1 → executor `backoff`.

## 진단 순서 (재사용)
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://stash.localhost/     # 502면 프록시 OK, upstream 죽음
python3 -c "import json;d=json.load(open('/run/user/1000/executor/runtime.json'));print(d['instances']['stash'])"
systemctl status mnt-shared.mount mnt-shared.automount              # start-limit-hit 확인
findmnt /mnt/shared; ls /mnt/shared/.stash                          # 마운트/경로 확인
```
executor 설정: `~/.config/systemd/user/executor.json`
stash cmd: `~/.local/share/scripts/stash/scripts/stash-run.sh --port 45122 --config ~/.config/stash/config.toml`
stash 설정: `~/.config/stash/config.toml` (`sqlite_path`, `download_root` = `/mnt/shared` 하위)

## 근본 원인 (증거)
1. `/mnt/shared`는 tailscale NFS automount (`100.93.169.17:/home/easydev/shared`).
2. 부팅 시 `network-online.target`(08:00:52)과 `tailscaled.service` READY(08:00:48)가
   **netmap(=실제 100.64/10 라우트) 생성(08:01:12)보다 먼저** 완료된다.
   → 그 사이 automount가 트리거되면 `mount.nfs4: Network is unreachable` (ENETUNREACH).
3. plasmashell/stash가 10초 안에 5회 접근 → mount 유닛 `start-limit-hit`
   → systemd `automount_trigger_notify`가 이 상태를 automount로 전파
   (`AUTOMOUNT_FAILURE_MOUNT_START_LIMIT_HIT`) → **세션 내내 영구 dead**. 이것이 진짜 결함.
4. `tailscaled.service`는 Type=notify지만 netmap 전에 READY를 보내므로
   `After=tailscaled.service`만으로는 부족.
5. mount 유닛은 `ExecStartPre`를 지원하지 않는다 (`Unknown key 'ExecStartPre' in section [Mount], ignoring`).

## 적용된 수정
`/etc/fstab`의 NFS 3줄(rose/media, lily/downloads, shared) 옵션에 추가:
```
x-systemd.requires=tailscaled.service,x-systemd.after=network-online.target,x-systemd.mount-timeout=45
```
drop-in 3개 (`/etc/systemd/system/<unit>.mount.d/start-limit.conf`):
```ini
[Unit]
StartLimitIntervalSec=0
```
(`mnt-shared.mount`, `mnt-rose-media.mount`, `mnt-lily-downloads.mount`)

- `StartLimitIntervalSec=0` = 무제한 → 재시도가 영구 고정되지 않음 (A/B 실측: 기본값 유닛은 active/waiting → failed, 수정 유닛은 active/waiting 유지).
- `x-systemd.mount-timeout=45`: cachyos-settings가 `/usr/lib/systemd/system.conf.d/00-timeout.conf`에서
  전역 `DefaultTimeoutStartSec=15s`를 설정해 느린 첫 NFS 접속이 15초에 timeout 나는 문제 회피.
- fstab 백업: `/etc/fstab.bak-260920-101751`

## 즉시 복구 절차 (수동)
```bash
sudo systemctl reset-failed mnt-shared.mount mnt-shared.automount
sudo systemctl start mnt-shared.automount
cd ~/.local/share/scripts/dev/executor && ./executor.sh start stash
```
executor CLI: `run|list|log <name>|status [name]|start|stop|reload <name>|service`.

## 검증 명령
```bash
findmnt -n -o SOURCE,FSTYPE /mnt/shared
curl -s -o /dev/null -w "%{http_code}\n" http://stash.localhost/        # 200
curl -s -o /dev/null -w "%{http_code}\n" http://stash.localhost/stash/jobs
systemctl show mnt-shared.mount -p StartLimitIntervalUSec -p TimeoutUSec
```
