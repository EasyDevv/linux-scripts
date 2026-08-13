# VM 관리 도구

`vm`은 libvirt/virt-manager 기반 VM을 조회하고 Debian 13 KDE VM을 설치·복제·접속하는 Bun TypeScript CLI다.

## 설치 위치

```text
구현: /home/easydev/.local/share/scripts/dev/virt-manager
명령: /home/easydev/.local/bin/vm
```

`~/.local/bin/vm`은 구현 디렉터리의 extensionless launcher를 가리킨다.

## 구조

```text
virt-manager/
├── vm            # PATH용 launcher
├── main.ts       # 명령 dispatch와 일반 VM 관리
├── config.ts     # 기본값과 환경변수 설정
├── libvirt.ts    # virsh와 QEMU guest-agent 경계
├── debian.ts     # Debian setup, golden, clone, Plasma 초기화
└── README.md
```

사용자 인터페이스는 `vm`으로 고정하고 provider 및 guest 구성은 모듈로 분리했다. 새 OS profile, snapshot, port forwarding 등의 기능은 기존 명령을 깨지 않고 추가할 수 있다.

## 주요 명령

```bash
vm list
vm status [name]
vm ip [name]
vm ssh-command [name]
vm ssh
vm ssh <name>
vm ssh <name> -- 'podman ps'

vm start [name]
vm stop [name]
vm restart [name]
vm console [name]
vm delete <name> --force

vm setup [--ssh]
vm reinstall --force [--ssh]
vm golden
vm clone <name> [--ssh]
vm cache
```

VM 이름을 생략하면 `debian13-kde-podman`을 사용한다.

## 즉시 SSH 접속

setup은 별도 옵션 없이 SSH server를 활성화하고 VM 전용 ED25519 키를 자동 생성해 guest에 등록한다. SSH 설정은 항상 적용되는 기본 동작이다.

```text
private key: ~/.ssh/vm_ed25519
public key:  ~/.ssh/vm_ed25519.pub
host keys:   ~/.ssh/vm_known_hosts
```

현재 SSH 접속 가능한 VM과 명령 조회:

```bash
vm ssh
```

특정 VM의 전체 raw SSH 명령 조회:

```bash
vm ssh-command debian13-kde-podman
```

직접 접속:

```bash
vm ssh debian13-kde-podman
vm ssh debian13-project-a
```

setup 또는 clone 직후 바로 접속:

```bash
vm setup --ssh
vm clone debian13-project-a --ssh
```

비대화형 원격 명령:

```bash
vm ssh debian13-kde-podman -- 'hostname && podman ps'
```

`vm ssh`를 인자 없이 실행하면 현재 실행 중이며 SSH 포트가 확인된 VM만 보여준다. `vm ssh <name>`에서 지정한 VM이 꺼져 있으면 먼저 시작하고 guest agent가 준비될 때까지 기다린다.
VM 이름을 SSH `HostKeyAlias`로 사용하므로 DHCP 주소가 바뀌거나 재사용돼도 다른 VM의 host key와 충돌하지 않는다.

기본 guest 로그인:

```text
user: easydev
password: virtuser
```

## Debian Setup

기존 VM 구성 보정:

```bash
vm setup
```

완전 재설치:

```bash
vm reinstall --force
```

`reinstall`은 기존 base VM과 디스크를 삭제하므로 `--force`를 요구한다. 설치 미디어는 다음 DVD ISO다.

```text
/home/easydev/.iso/debian-13.6.0-amd64-DVD-1.iso
SHA256: e97736b7f49af22497c8df95e381ea5025faf3575af4b7ca6d5f40971265364e
```

KDE live ISO의 Calamares는 unattended mode가 없고, 내장 Debian Installer를 사용하면 DVD와 같은 설치 비용이 발생한다. 반복 생성 속도는 live ISO가 아니라 golden image로 해결한다.

## Plasma 첫 로그인 초기화

`vm setup`은 사용자가 최초 GUI 로그인하기 전에 실제 Plasma 세션을 한 번 초기화한다.

1. `plasma-welcomerc`에 현재 Plasma 버전과 `ShowUpdatePage=false`를 기록한다.
2. `/etc/xdg/kded6/plasma-welcome`에서 Welcome KDED module autoload를 비활성화한다.
3. SDDM 임시 autologin을 설정한다.
4. 실제 Plasma Wayland 세션과 `plasmashell`을 한 번 실행한다.
5. 기본 desktop layout, KDE service cache, font cache를 생성한다.
6. 임시 autologin을 제거하고 사용자 세션을 종료한다.
7. SDDM 로그인 화면으로 복귀한다.
8. `/var/lib/vm-tool/plasma-initialized` marker를 기록한다.

따라서 사용자가 비밀번호를 입력한 뒤에는 Welcome 창이나 최초 layout 생성 대기 없이 준비된 desktop을 보게 된다. setup을 다시 실행하면 marker를 확인하고 실제 초기화 세션은 반복하지 않는다.

## Golden Image

Golden image는 OS 설치, KDE/Podman/WireGuard 구성, Plasma 첫 로그인 초기화까지 끝낸 읽기 전용 기준 디스크다.

```text
/home/easydev/.vm-images/debian13-kde-golden.qcow2
```

생성 또는 갱신:

```bash
vm golden
```

새 VM 생성:

```bash
vm clone debian13-project-a
```

clone은 Btrfs reflink를 사용해 전체 80 GiB를 복사하지 않는다. clone 부팅 후 다음 항목만 고유화한다.

- libvirt UUID
- MAC 및 DHCP 주소
- hostname
- `/etc/machine-id`
- SSH host keys

Plasma 초기화 marker와 cache는 golden에서 상속하므로 clone마다 Welcome 초기화를 반복하지 않는다.

실측 clone 생성·부팅·고유화·SSH 준비 시간은 약 38초다.

## 공유 폴더

```text
host:  /home/easydev/.vm-shared
guest: /home/easydev/shared
type:  virtiofs
tag:   vm-shared
```

게스트 `/etc/fstab`:

```fstab
vm-shared /home/easydev/shared virtiofs defaults,nofail,x-systemd.automount 0 0
```

확인:

```bash
vm ssh debian13-kde-podman -- 'findmnt /home/easydev/shared'
```

## APT Archive Cache

추가 패키지의 `.deb`는 virtiofs로 공유한다.

```text
host:  /home/easydev/.vm-shared/apt-archives
guest: /home/easydev/shared/apt-archives
```

guest 설정:

```aptconf
Dir::Cache::archives "/home/easydev/shared/apt-archives";
```

초기화:

```bash
vm cache
```

## 환경변수

주요 기본값은 환경변수로 변경할 수 있다.

```text
VM_NAME
VM_USER
VM_PASSWORD
VM_MEMORY_MIB
VM_VCPUS
VM_DISK_GIB
VM_IP
VM_MAC
ISO_PATH
DISK_PATH
VM_IMAGES_DIR
HOST_SHARED_DIR
GUEST_SHARED_DIR
SSH_PUBLIC_KEY_PATH
LIBVIRT_URI
LIBVIRT_NETWORK
STORAGE_POOL
GOLDEN_PATH
```

예:

```bash
VM_MEMORY_MIB=16384 VM_VCPUS=8 vm clone debian13-heavy-test
```

## 현재 상태

```bash
vm list
vm status
vm ssh-command
```

Base VM 디스크:

```text
/home/easydev/.vm-images/debian13-kde-podman.qcow2
```

공유 폴더와 guest agent, Podman, WireGuard tools, SSH, Plasma 초기화가 검증된 상태다.
