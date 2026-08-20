# init-vps

OVH Debian 13을 한 번에 올리는 원패스 스크립트입니다. LLM이 필요 없습니다.
실패한 단계부터 다시 이어집니다.

```sh
init-vps --reinstall --apply --yes   # ovhcloud vps reinstall 후 전부
init-vps --apply                     # 이미 와이프된 디스크, 공개 SSH부터
init-vps                             # 읽기 전용 plan (기존 호스트 조회)
init-vps status
init-vps --from host_join --apply
```

`--reinstall`은 `ovhcloud vps reinstall`입니다. 게스트에 SSH하기 전에 OVH 작업이
끝납니다. `--wait` 반환은 SSH가 아닙니다. 로그인 시도는 그 다음입니다.
플래그 없이 `--apply`만 쓰면 디스크는 이미 비어 있다고 보고 공개 SSH부터 갑니다.

공개 TCP 22는 닫지 않습니다. 앱 Quadlet은 설치하지 않습니다.

반복 원격 단계는 120초 동안 SSH ControlMaster 연결을 재사용합니다. control socket은
`$XDG_RUNTIME_DIR/easydev-ssh-control` 또는 `~/.cache/easydev-ssh-control`의 mode 0700
디렉터리에 둡니다. host-key 복구 검사는 정확성을 위해 multiplexing을 의도적으로 끕니다.

`early_warning` 단계가 CrowdSec(nft 바운서 + Caddy AppSec), auditd, Falco, Discord 버스를 설치합니다. Discord는 정책을 통과한 보안 이벤트만 Rich Embed로 알립니다. 일반 SSH preauth 거절은 집계하고, 5분 내 서로 다른 소스 5개 또는 총 20회 이상일 때만 burst 알림을 보냅니다. 성공 로그인·CrowdSec decision·authorized_keys/sshd/nftables 변경·SSH/NetBird 동시 복구 장애는 즉시 보냅니다. bootstrap은 nftables·키 전용 SSH만 합니다.

## 사람 손길이 필요한 지점

이미 값이 있으면 묻지 않습니다.

| 게이트 | 언제 | 입력 |
|---|---|---|
| `--reinstall` | 디스크를 지울 때 | TTY 확인 또는 `--yes` |
| `ssh-add` | IdentityFile이 agent에 없을 때 | 키 암호 |
| Owner PAT | `~/.local/share/scripts/dev/.env.netbird`의 `NETBIRD_API_KEY`가 없거나 401 | `/setup`에서 만든 PAT |
| `netbird up` | 이 PC가 새 management에 없을 때 | `netbird up --management-url https://DOMAIN` |
| Sender | early-warning이고 `.env.sender`가 없을 때 | `--sender-env` |

비-TTY `--apply`는 키가 이미 agent에 있어야 하고, PAT와 `.env.sender`가 있어야 하며, 재설치는 `--yes`가 필요합니다.

## 재개

상태 파일: `~/.local/share/scripts/dev/init-debian-vps/.log/TARGET/state.json`

같은 명령을 다시 실행하면 이미 건강한 단계는 건너뜁니다. `--from STAGE`는 그 단계부터 강제 재개합니다. `--reset`은 상태만 지웁니다.

`--apply`가 끝까지 끝나면 `.log/TARGET/report.md`에 정적 보고서를 씁니다. CrowdSec/Falco 등
층별 역할, 추가된 경로, 유닛/리슨 상태입니다. 웹훅과 키는 넣지 않습니다.

## 프로파일

기본값은 로컬 전용 `profiles/ovh-vps.json`입니다. 공개 저장소에는
`profiles/*.example.json` 형태의 비식별 템플릿만 둡니다. 처음 설치할 때는
`profiles/README.md`의 복사 명령으로 런타임 프로파일을 만든 뒤 실제 도메인,
주소, 피어, 직원 목록으로 채우세요. 런타임 프로파일은 `.gitignore`에 의해
커밋되지 않습니다.

`reconcile-vps.sh`는 `init-vps.py`로 전달하는 호환 래퍼입니다.
