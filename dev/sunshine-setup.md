# CachyOS KDE Wayland + Sunshine 가상 디스플레이 통합 구축 가이드

이 스크립트는 실행 직후 `Intel` 또는 `NVIDIA`를 선택받고, 선택한 GPU에 맞는 패키지 설치와 Sunshine 인코더 설정을 자동으로 적용합니다. 기존 더미 디스플레이 전환 방식은 스크립트에서 건드리지 않고, 문서 참고 사항으로만 남깁니다.

## 0단계: GPU 종류 선택

스크립트를 실행하면 먼저 아래와 같이 GPU 종류를 묻습니다.

```text
사용할 GPU를 선택하세요.
  1) Intel
  2) NVIDIA
선택 [1-2]:
```

선택 결과에 따라 이후 설정이 달라집니다.

| GPU | 설치 패키지 | Sunshine 인코더 | 추가 환경변수 |
| --- | --- | --- | --- |
| Intel | `krfb`, `intel-media-driver` | `vaapi` | `LIBVA_DRIVER_NAME=iHD` |
| NVIDIA | `krfb`, `nvidia-utils` | `nvenc` | 없음 |

이 가이드는 `krfb-virtualmonitor`를 사용하므로, Sunshine 캡처 방식도 기본 `kms`가 아니라 `kwin`으로 고정합니다. KDE Wayland의 가상 출력은 KWin 레벨에서만 보이기 때문입니다.

## 1단계: 최소 필수 패키지 설치 및 권한 부여

가상 모니터 기능(`krfb`)과 선택한 GPU에 맞는 하드웨어 인코딩 패키지만 설치합니다.

1. **최소 필수 패키지 설치**
   Intel 선택 시:
   ```bash
   sudo pacman -S krfb intel-media-driver
   ```
   NVIDIA 선택 시:
   ```bash
   sudo pacman -S krfb nvidia-utils
   ```

2. **사용자 권한 추가**
   Sunshine이 시스템의 비디오 가속 노드에 접근할 수 있도록 현재 계정에 권한을 부여합니다.
   ```bash
   sudo usermod -aG video,render $USER
   ```

3. **Intel 선택 시 전역 환경변수 등록**
   Intel GPU를 선택한 경우에만 적합한 VA-API 드라이버(iHD)를 사용하도록 시스템 환경변수를 등록합니다.
   ```bash
   echo "LIBVA_DRIVER_NAME=iHD" | sudo tee -a /etc/environment
   ```
   NVIDIA를 선택한 경우 이 단계는 건너뜁니다.

---

## 2단계: Sunshine systemd 유저 서비스 작성

사용자가 로그인했을 때 그래픽 세션이 실행된 직후, 가상 모니터를 먼저 생성한 뒤 Sunshine이 기동하도록 단일 유저 서비스를 구성합니다. `ExecStartPre`와 `ExecStopPost`를 통해 가상 디스플레이의 생명주기도 함께 관리됩니다.

1. **유저 systemd 폴더 생성**
   ```bash
   mkdir -p ~/.config/systemd/user
   ```

2. **Sunshine 서비스 파일 작성**
   ```bash
   nano ~/.config/systemd/user/sunshine.service
   ```
   아래 서비스 구성 내역을 그대로 붙여넣습니다.
   ```ini
   [Unit]
   Description=Sunshine Gamestream Server
   After=graphical-session.target
   Wants=graphical-session.target

   [Service]
   ExecStartPre=-/home/easydev/.local/usr/bin/virtual-monitor.sh
   ExecStart=/usr/bin/sunshine
   ExecStopPost=-/home/easydev/.local/usr/bin/virtual-monitor.sh --stop
   Restart=on-failure
   RestartSec=5
   Environment="WAYLAND_DISPLAY=wayland-0"
   Environment="XDG_RUNTIME_DIR=/run/user/1000"
   Environment="DISPLAY=:0"

   [Install]
   WantedBy=graphical-session.target
   ```
   * `ExecStartPre`: Sunshine 본체 실행 전에 가상 모니터를 생성합니다.
   * `ExecStopPost`: Sunshine 종료 후 가상 모니터를 정리합니다.

---

## 3단계: 가상 디스플레이 통합 스크립트 작성

시작과 종료를 하나의 스크립트로 통합합니다. 인자 없이 실행하면 현재 활성 물리 디스플레이의 해상도, 주사율, 스케일을 우선 복제해 가상 모니터를 만들고, 해상도가 `1920x1080`보다 작으면 최소 `1920x1080`으로 올려서 생성합니다. `--stop` 옵션을 주면 정리합니다.

1. **스크립트 보관 디렉터리 생성**
   ```bash
   mkdir -p ~/.local/usr/bin
   ```

2. **통합 스크립트 작성 (`virtual-monitor.sh`)**
   ```bash
   nano ~/.local/usr/bin/virtual-monitor.sh
   ```
   아래 내용을 복사하여 붙여넣습니다.
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail

   PIDFILE="/tmp/sunshine-vmon.pid"
   NAME="sunshine-vmon"
    VIRTUAL_OUTPUT="Virtual-${NAME}"
    MIN_WIDTH=1920
    MIN_HEIGHT=1080
    DEFAULT_REFRESH="60.00"
    DEFAULT_SCALE="1"

    detect_physical_mode() {
        local doctor_output line current_output="" enabled=0
        local current_scale="${DEFAULT_SCALE}"

       doctor_output="$(kscreen-doctor -o 2>/dev/null | sed -E 's/\x1B\[[0-9;]*[[:alpha:]]//g')" || return 1

       while IFS= read -r line; do
            if [[ "${line}" =~ ^Output:[[:space:]]+[0-9]+[[:space:]]+([^[:space:]]+) ]]; then
                current_output="${BASH_REMATCH[1]}"
                enabled=0
                current_scale="${DEFAULT_SCALE}"
                continue
            fi

            if [[ "${line}" =~ ^[[:space:]]*enabled$ ]]; then
                enabled=1
                continue
            fi

            if (( enabled )) && [[ "${line}" =~ ^[[:space:]]*Scale:[[:space:]]*([0-9.]+)$ ]]; then
                current_scale="${BASH_REMATCH[1]}"
                continue
            fi

            if (( enabled )) && [[ "${current_output}" != Virtual-* ]] && [[ "${line}" =~ ([0-9]+)x([0-9]+)@([0-9.]+)\* ]]; then
                printf '%s %s %s %s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${current_scale}"
                return 0
            fi
        done <<< "${doctor_output}"

       return 1
   }

    build_virtual_mode() {
        local detected width height refresh scale

        if detected="$(detect_physical_mode)"; then
            read -r width height refresh scale <<< "${detected}"
        else
            width=${MIN_WIDTH}
            height=${MIN_HEIGHT}
            refresh=${DEFAULT_REFRESH}
            scale=${DEFAULT_SCALE}
        fi

       if (( width < MIN_WIDTH || height < MIN_HEIGHT )); then
           width=${MIN_WIDTH}
           height=${MIN_HEIGHT}
       fi

        printf '%s %s %s %s\n' "${width}" "${height}" "${refresh}" "${scale}"
    }

   wait_for_virtual_output() {
       local attempt

       for attempt in {1..10}; do
           if kscreen-doctor -o 2>/dev/null | sed -E 's/\x1B\[[0-9;]*[[:alpha:]]//g' | grep -q "Output: .* ${VIRTUAL_OUTPUT} "; then
               return 0
           fi
           sleep 1
       done

       return 1
   }

    apply_virtual_mode() {
        local width="$1"
        local height="$2"
        local refresh="$3"
        local scale="$4"
        local refresh_mhz

        refresh_mhz="$(awk -v rate="${refresh}" 'BEGIN { printf "%d", rate * 1000 }')"
        kscreen-doctor \
            "output.${VIRTUAL_OUTPUT}.addCustomMode.${width}.${height}.${refresh_mhz}.full" \
            "output.${VIRTUAL_OUTPUT}.mode.${width}x${height}@${refresh}" \
            "output.${VIRTUAL_OUTPUT}.scale.${scale}" &>/dev/null || true
    }

    read -r WIDTH HEIGHT REFRESH SCALE <<< "$(build_virtual_mode)"
    RES="${WIDTH}x${HEIGHT}"

   if [[ "${1:-}" == "--stop" ]]; then
       if [[ -f "$PIDFILE" ]]; then
           pid="$(cat "$PIDFILE")"
           if kill "$pid" 2>/dev/null; then
               echo "Stopped virtual monitor (PID: $pid)"
           fi
           rm -f "$PIDFILE"
       else
           pkill -f "krfb-virtualmonitor.*$NAME" || true
       fi
       exit 0
   fi

   if [[ -f "$PIDFILE" ]]; then
       pid="$(cat "$PIDFILE")"
       if kill -0 "$pid" 2>/dev/null; then
           echo "Virtual monitor already running (PID: $pid)"
           exit 0
       else
           rm -f "$PIDFILE"
       fi
   fi

   krfb-virtualmonitor --resolution "$RES" --name "$NAME" --password "sunshinepass" --port 5905 &
   pid=$!
   echo "$pid" > "$PIDFILE"
   echo "Started virtual monitor (PID: $pid) at $RES"

   sleep 3

    if wait_for_virtual_output; then
        apply_virtual_mode "${WIDTH}" "${HEIGHT}" "${REFRESH}" "${SCALE}"
    fi
    ```
    * `NAME="sunshine-vmon"`으로 생성한 가상 디스플레이는 KDE 내부에서 `Virtual-sunshine-vmon` 이름으로 식별됩니다.
    * 물리 모니터가 `3840x2160@60`, `scale 1.25`이면 가상 모니터도 우선 같은 모드와 스케일을 맞추려 시도합니다.
    * 물리 모니터가 `1366x768@60`, `scale 1`처럼 더 작으면 가상 모니터는 `1920x1080@60`으로 생성되고 스케일은 `1`을 유지합니다.

3. **실행 권한 부여**
   ```bash
   chmod +x ~/.local/usr/bin/virtual-monitor.sh
   ```

---

## 4단계: Sunshine 글로벌 설정 변경 (`sunshine.conf`)

선택한 GPU에 맞는 하드웨어 인코더를 고정하고, 가상 화면만 정확하게 캡처하도록 설정합니다.

1. **글로벌 구성 파일 수정**
   ```bash
   nano ~/.config/sunshine/sunshine.conf
   ```

2. **아래 설정 값을 기재한 뒤 저장합니다.**
   Intel 선택 시:
   ```ini
   capture = kwin
   encoder = vaapi
   output_name = Virtual-sunshine-vmon
   ```
   NVIDIA 선택 시:
   ```ini
   capture = kwin
   encoder = nvenc
   output_name = Virtual-sunshine-vmon
   ```
   * `capture = kwin`: KDE Wayland의 `krfb-virtualmonitor` 출력을 Sunshine이 인식할 수 있도록 KWin 캡처 경로를 사용합니다.
   * `encoder = vaapi`: Intel QuickSync/VA-API 인코딩을 사용합니다.
   * `encoder = nvenc`: NVIDIA NVENC 하드웨어 인코딩을 사용합니다.
   * `output_name = Virtual-sunshine-vmon`: 가상 디스플레이만 Sunshine 출력 대상으로 지정합니다.

---

## 5단계: 서비스 갱신 및 정상 구동 테스트

모든 단계가 끝났습니다. 이제 설정을 등록하고 백그라운드 자동 기동을 수행합니다.

1. **설정 적용을 위한 재부팅**
   환경변수와 그래픽 가속 그룹 권한 등록을 완료하기 위해 한 번 재부팅하는 것이 좋습니다.

2. **Sunshine 유저 서비스 등록 및 활성화**
   ```bash
   systemctl --user daemon-reload && systemctl --user enable --now sunshine.service
   ```

3. **Moonlight 클라이언트로 스트리밍 테스트**
   접속 장치에서 Moonlight를 열어 PC에 접속하면, 그래픽 세션 시작 시점에 생성된 가상 디스플레이로 선택한 GPU의 하드웨어 인코딩 화면이 전송되는 것을 확인할 수 있습니다.

---

## 참고: 기존 더미 디스플레이 전환 방식

이 문서의 스크립트는 기존 `DP-1`/`DP-3` 전환 기반 더미 디스플레이 설정을 자동으로 수정하거나 삭제하지 않습니다.

이미 아래와 같은 구성이 있으면 필요할 때 수동으로 정리하세요.

- `~/.config/systemd/user/sunshine-display-failsafe.service`
- `~/.local/usr/bin/sunshine-display-failsafe`
- `~/.local/usr/bin/sunshine-stream-start`
- `~/.local/usr/bin/sunshine-stream-stop`
