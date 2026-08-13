#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# CachyOS KDE Wayland + Sunshine 가상 디스플레이 통합 구축 스크립트
# 대상: 설정이 전혀 없는 PC (N100 최적화)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME="${USER}"
VMON_SCRIPT="${HOME}/.local/usr/bin/virtual-monitor.sh"
SERVICE_FILE="${HOME}/.config/systemd/user/sunshine.service"
SUNSHINE_CONF="${HOME}/.config/sunshine/sunshine.conf"
GPU_VENDOR=""
GPU_LABEL=""
GPU_PACKAGES=()
SUNSHINE_ENCODER=""
LIBVA_ENV_LINE="LIBVA_DRIVER_NAME=iHD"

USER_UID="$(id -u)"
USER_RUNTIME_DIR="/run/user/${USER_UID}"
DEFAULT_VIRTUAL_WIDTH=1920
DEFAULT_VIRTUAL_HEIGHT=1080
DEFAULT_VIRTUAL_REFRESH="60.00"
DEFAULT_VIRTUAL_SCALE="1"
DETECTED_WIDTH=""
DETECTED_HEIGHT=""
DETECTED_REFRESH=""
DETECTED_SCALE=""
VIRTUAL_WIDTH=${DEFAULT_VIRTUAL_WIDTH}
VIRTUAL_HEIGHT=${DEFAULT_VIRTUAL_HEIGHT}
VIRTUAL_REFRESH="${DEFAULT_VIRTUAL_REFRESH}"
VIRTUAL_SCALE="${DEFAULT_VIRTUAL_SCALE}"

print_section() {
    echo ""
    echo "========================================"
    echo " $1"
    echo "========================================"
}

select_gpu_vendor() {
    while true; do
        echo "사용할 GPU를 선택하세요."
        echo "  1) Intel"
        echo "  2) NVIDIA"
        read -rp "선택 [1-2]: " selection

        case "${selection}" in
            1|intel|Intel|INTEL)
                GPU_VENDOR="intel"
                GPU_LABEL="Intel"
                GPU_PACKAGES=(krfb intel-media-driver)
                SUNSHINE_ENCODER="vaapi"
                return 0
                ;;
            2|nvidia|NVIDIA|Nvidia)
                GPU_VENDOR="nvidia"
                GPU_LABEL="NVIDIA"
                GPU_PACKAGES=(krfb nvidia-utils)
                SUNSHINE_ENCODER="nvenc"
                return 0
                ;;
            *)
                echo "올바른 번호 또는 이름을 입력해 주세요."
                ;;
        esac
    done
}

ensure_packages_installed() {
    local missing_packages=()
    local package

    for package in "$@"; do
        if ! pacman -Q "${package}" &>/dev/null; then
            missing_packages+=("${package}")
        fi
    done

    if (( ${#missing_packages[@]} > 0 )); then
        sudo pacman -S --needed --noconfirm "${missing_packages[@]}"
    else
        echo "   이미 설치되어 있습니다."
    fi
}

run_systemctl_user() {
    local runtime_dir="${XDG_RUNTIME_DIR:-${USER_RUNTIME_DIR}}"
    local bus_address="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${runtime_dir}/bus}"

    if [[ ! -S "${runtime_dir}/bus" ]]; then
        echo "사용자 systemd bus를 찾을 수 없습니다: ${runtime_dir}/bus"
        echo "그래픽 세션에 로그인한 상태인지 확인한 뒤 다시 실행해 주세요."
        return 1
    fi

    XDG_RUNTIME_DIR="${runtime_dir}" DBUS_SESSION_BUS_ADDRESS="${bus_address}" systemctl --user "$@"
}

detect_physical_mode() {
    local doctor_output line current_output="" enabled=0 current_scale="${DEFAULT_VIRTUAL_SCALE}"

    command -v kscreen-doctor >/dev/null 2>&1 || return 1
    doctor_output="$(kscreen-doctor -o 2>/dev/null | sed -E 's/\x1B\[[0-9;]*[[:alpha:]]//g')" || return 1

    while IFS= read -r line; do
        if [[ "${line}" =~ ^Output:[[:space:]]+[0-9]+[[:space:]]+([^[:space:]]+) ]]; then
            current_output="${BASH_REMATCH[1]}"
            enabled=0
            current_scale="${DEFAULT_VIRTUAL_SCALE}"
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

load_detected_physical_mode() {
    local detected_mode

    if detected_mode="$(detect_physical_mode)"; then
        read -r DETECTED_WIDTH DETECTED_HEIGHT DETECTED_REFRESH DETECTED_SCALE <<< "${detected_mode}"
    fi
}

select_virtual_resolution() {
    local options=()
    local selection max_option custom_resolution
    local selected_width selected_height selected_refresh

    if [[ -n "${DETECTED_WIDTH}" ]]; then
        options+=("실제 모니터 (${DETECTED_WIDTH}x${DETECTED_HEIGHT}@${DETECTED_REFRESH}, scale ${DETECTED_SCALE})|${DETECTED_WIDTH}|${DETECTED_HEIGHT}|${DETECTED_REFRESH}")
    fi

    options+=(
        "1920x1080 (FHD, 60Hz)|1920|1080|60.00"
        "2560x1440 (QHD, 60Hz)|2560|1440|60.00"
        "3440x1440 (UWQHD, 60Hz)|3440|1440|60.00"
        "3840x2160 (4K, 60Hz)|3840|2160|60.00"
        "직접 입력 (refresh 60Hz 고정)|custom||"
    )

    print_section "0단계: 가상 모니터 해상도 선택"
    if [[ -n "${DETECTED_WIDTH}" ]]; then
        echo "-> 감지된 실제 모니터: ${DETECTED_WIDTH}x${DETECTED_HEIGHT}@${DETECTED_REFRESH}, scale ${DETECTED_SCALE}"
    else
        echo "-> 감지된 실제 모니터가 없습니다. 프리셋 기준으로 선택합니다."
    fi

    max_option=${#options[@]}
    while true; do
        local idx=1 entry
        for entry in "${options[@]}"; do
            echo "  ${idx}) ${entry%%|*}"
            ((idx++))
        done

        read -rp "해상도 선택 [1-${max_option}, Enter=1]: " selection
        selection="${selection:-1}"

        if ! [[ "${selection}" =~ ^[0-9]+$ ]] || (( selection < 1 || selection > max_option )); then
            echo "올바른 번호를 입력해 주세요."
            continue
        fi

        IFS='|' read -r _ selected_width selected_height selected_refresh <<< "${options[selection-1]}"
        if [[ "${selected_width}" == "custom" ]]; then
            while true; do
                read -rp "해상도 입력 (예: 2560x1440): " custom_resolution
                if [[ "${custom_resolution}" =~ ^([0-9]+)x([0-9]+)$ ]]; then
                    VIRTUAL_WIDTH="${BASH_REMATCH[1]}"
                    VIRTUAL_HEIGHT="${BASH_REMATCH[2]}"
                    VIRTUAL_REFRESH="${DEFAULT_VIRTUAL_REFRESH}"
                    return 0
                fi
                echo "해상도 형식이 올바르지 않습니다."
            done
        fi

        VIRTUAL_WIDTH="${selected_width}"
        VIRTUAL_HEIGHT="${selected_height}"
        VIRTUAL_REFRESH="${selected_refresh}"
        return 0
    done
}

select_virtual_scale() {
    local unique_options=()
    local entry selection custom_scale idx

    if [[ -n "${DETECTED_SCALE}" ]]; then
        unique_options+=("${DETECTED_SCALE}")
    fi

    for entry in "1" "1.25" "1.5" "1.75" "2"; do
        local duplicate=0 existing
        for existing in "${unique_options[@]}"; do
            if [[ "${existing}" == "${entry}" ]]; then
                duplicate=1
                break
            fi
        done
        (( duplicate )) || unique_options+=("${entry}")
    done

    print_section "0단계: 가상 모니터 스케일 선택"
    if [[ -n "${DETECTED_SCALE}" ]]; then
        echo "-> 감지된 실제 모니터 scale: ${DETECTED_SCALE}"
    fi

    while true; do
        idx=1
        for entry in "${unique_options[@]}"; do
            echo "  ${idx}) ${entry}"
            ((idx++))
        done
        echo "  ${idx}) 직접 입력"

        read -rp "스케일 선택 [1-${idx}, Enter=1]: " selection
        selection="${selection:-1}"

        if ! [[ "${selection}" =~ ^[0-9]+$ ]] || (( selection < 1 || selection > idx )); then
            echo "올바른 번호를 입력해 주세요."
            continue
        fi

        if (( selection == idx )); then
            while true; do
                read -rp "스케일 입력 (예: 1.25): " custom_scale
                if [[ "${custom_scale}" =~ ^[0-9]+([.][0-9]+)?$ ]] && [[ "${custom_scale}" != "0" ]]; then
                    VIRTUAL_SCALE="${custom_scale}"
                    return 0
                fi
                echo "스케일 형식이 올바르지 않습니다."
            done
        fi

        VIRTUAL_SCALE="${unique_options[selection-1]}"
        return 0
    done
}

select_gpu_vendor
print_section "선택된 GPU: ${GPU_LABEL}"
load_detected_physical_mode
select_virtual_resolution
select_virtual_scale
echo "-> 선택된 가상 모니터: ${VIRTUAL_WIDTH}x${VIRTUAL_HEIGHT}@${VIRTUAL_REFRESH}, scale ${VIRTUAL_SCALE}"

# --------------------------------------------------
# 1단계: 최소 필수 패키지 설치 및 권한 부여
# --------------------------------------------------
print_section "1단계: 최소 필수 패키지 설치 및 권한 부여"

echo "-> ${GPU_LABEL}용 필수 패키지 설치 확인 및 진행... (${GPU_PACKAGES[*]})"
ensure_packages_installed "${GPU_PACKAGES[@]}"

echo "-> 현재 사용자(${USER_NAME})를 video, render 그룹에 추가..."
sudo usermod -aG video,render "${USER_NAME}"

if [[ "${GPU_VENDOR}" == "intel" ]]; then
    if grep -q "^${LIBVA_ENV_LINE}$" /etc/environment 2>/dev/null; then
        echo "-> ${LIBVA_ENV_LINE} 이미 등록되어 있습니다."
    else
        echo "-> 인텔 전용 드라이버 전역 환경변수 등록..."
        echo "${LIBVA_ENV_LINE}" | sudo tee -a /etc/environment >/dev/null
    fi
else
    echo "-> NVIDIA 선택: 추가 전역 환경변수 등록은 건너뜁니다."
fi

# --------------------------------------------------
# 2단계: Sunshine systemd 유저 서비스 작성
# --------------------------------------------------
print_section "2단계: Sunshine systemd 유저 서비스 작성"

mkdir -p "${HOME}/.config/systemd/user"

cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Sunshine Gamestream Server
After=graphical-session.target
Wants=graphical-session.target

[Service]
ExecStartPre=-%h/.local/usr/bin/virtual-monitor.sh
ExecStart=/usr/bin/sunshine
ExecStopPost=-%h/.local/usr/bin/virtual-monitor.sh --stop
Restart=on-failure
RestartSec=5
Environment="WAYLAND_DISPLAY=wayland-0"
Environment="XDG_RUNTIME_DIR=${USER_RUNTIME_DIR}"
Environment="DISPLAY=:0"

[Install]
WantedBy=graphical-session.target
EOF

echo "-> 서비스 파일 작성 완료: ${SERVICE_FILE}"

# --------------------------------------------------
# 3단계: 가상 디스플레이 통합 스크립트 작성
# --------------------------------------------------
print_section "3단계: 가상 디스플레이 통합 스크립트 작성"

mkdir -p "${HOME}/.local/usr/bin"

cat > "${VMON_SCRIPT}" <<EOF
#!/usr/bin/env bash
set -euo pipefail

PIDFILE="/tmp/sunshine-vmon.pid"
NAME="sunshine-vmon"
VIRTUAL_OUTPUT="Virtual-\${NAME}"
WIDTH=${VIRTUAL_WIDTH}
HEIGHT=${VIRTUAL_HEIGHT}
REFRESH="${VIRTUAL_REFRESH}"
SCALE="${VIRTUAL_SCALE}"
RES="\${WIDTH}x\${HEIGHT}"

virtual_output_exists() {
    kscreen-doctor -o 2>/dev/null | sed -E 's/\x1B\[[0-9;]*[[:alpha:]]//g' | grep -q "Output: .* \${VIRTUAL_OUTPUT} "
}

wait_for_virtual_output() {
    local attempt

    for attempt in {1..10}; do
        if virtual_output_exists; then
            return 0
        fi
        sleep 1
    done

    return 1
}

apply_virtual_mode() {
    local refresh_mhz

    refresh_mhz="\$(awk -v rate="\${REFRESH}" 'BEGIN { printf "%d", rate * 1000 }')"
    kscreen-doctor \
        "output.\${VIRTUAL_OUTPUT}.addCustomMode.\${WIDTH}.\${HEIGHT}.\${refresh_mhz}.full" \
        "output.\${VIRTUAL_OUTPUT}.mode.\${WIDTH}x\${HEIGHT}@\${REFRESH}" \
        "output.\${VIRTUAL_OUTPUT}.scale.\${SCALE}" &>/dev/null || true
}

echo "Configured virtual mode: \${WIDTH}x\${HEIGHT}@\${REFRESH} scale \${SCALE}"

# --- Stop mode ---
if [[ "\${1:-}" == "--stop" ]]; then
    if [[ -f "\$PIDFILE" ]]; then
        pid="\$(<"\$PIDFILE")"
        if kill "\$pid" 2>/dev/null; then
            echo "Stopped virtual monitor (PID: \$pid)"
        fi
        rm -f "\$PIDFILE"
    else
        pkill -f "krfb-virtualmonitor.*\$NAME" || true
    fi
    exit 0
fi

# --- Start mode ---
if [[ -f "\$PIDFILE" ]]; then
    pid="\$(<"\$PIDFILE")"
    if kill -0 "\$pid" 2>/dev/null; then
        echo "Virtual monitor already running (PID: \$pid)"
        exit 0
    fi
    rm -f "\$PIDFILE"
fi

# 가상 디스플레이 생성
krfb-virtualmonitor --resolution "\$RES" --name "\$NAME" --password "sunshinepass" --port 5905 &
pid=\$!
echo "\$pid" > "\$PIDFILE"
echo "Started virtual monitor (PID: \$pid) at \$RES"

# KDE 시스템에 모니터 정보가 온전히 반영될 때까지 대기
sleep 3

if wait_for_virtual_output; then
    apply_virtual_mode
    echo "Applied virtual mode: \${WIDTH}x\${HEIGHT}@\${REFRESH} scale \${SCALE}"
fi
EOF

chmod +x "${VMON_SCRIPT}"
echo "-> 통합 스크립트 작성 및 실행 권한 부여 완료: ${VMON_SCRIPT}"

# --------------------------------------------------
# 4단계: Sunshine 글로벌 설정 변경 (sunshine.conf)
# --------------------------------------------------
print_section "4단계: Sunshine 글로벌 설정 변경 (sunshine.conf)"

mkdir -p "$(dirname "${SUNSHINE_CONF}")"

if [[ -f "${SUNSHINE_CONF}" ]]; then
    BACKUP_CONF="${SUNSHINE_CONF}.bak"
    echo "-> 기존 sunshine.conf 발견. 백업 진행: ${BACKUP_CONF}"
    cp "${SUNSHINE_CONF}" "${BACKUP_CONF}"
fi

cat > "${SUNSHINE_CONF}" <<EOF
capture = kwin
encoder = ${SUNSHINE_ENCODER}
output_name = Virtual-sunshine-vmon
EOF

echo "-> 설정 파일 작성 완료: ${SUNSHINE_CONF}"

# --------------------------------------------------
# 5단계: 서비스 갱신 및 정상 구동 테스트
# --------------------------------------------------
print_section "5단계: 서비스 갱신 및 활성화"

echo "-> systemd 유저 데몬 재로드..."
run_systemctl_user daemon-reload

echo "-> Sunshine 유저 서비스 등록 및 즉시 시작..."
run_systemctl_user enable --now sunshine.service

print_section "설정 완료"
echo "Sunshine 가상 디스플레이 통합 구축이 완료되었습니다."
echo ""
echo "[중요] 환경변수 및 그룹 권한 변경을 완료하려면 시스템 재부팅이 권장됩니다."
echo "   재부팅 후: XDG_RUNTIME_DIR=${USER_RUNTIME_DIR} DBUS_SESSION_BUS_ADDRESS=unix:path=${USER_RUNTIME_DIR}/bus systemctl --user status sunshine.service"
echo ""
echo "Moonlight 클라이언트에서 스트리밍 테스트를 진행해 주세요."
