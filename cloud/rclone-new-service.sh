#!/bin/bash

# ==============================================================================
# rclone systemd 서비스 자동 생성 스크립트
# ==============================================================================
# 기능:
# 1. 사용자로부터 rclone 설정 정보 입력 받기
# 2. 입력된 정보를 바탕으로 systemd 서비스 파일 자동 생성
# 3. 생성된 서비스를 시스템에 등록, 활성화 및 시작
# ==============================================================================

# 스크립트가 root 권한으로 실행되었는지 확인
if [ "$(id -u)" -ne 0 ]; then
  echo "이 스크립트는 반드시 sudo 또는 root 권한으로 실행해야 합니다."
  echo "USAGE: sudo ./rclone_systemd_setup.sh"
  exit 1
fi

# 색상 코드 정의
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=====================================================${NC}"
echo -e "${GREEN}  rclone systemd 서비스 자동 생성 스크립트를 시작합니다.${NC}"
echo -e "${GREEN}=====================================================${NC}"
echo

# --- 1. 사용자 정보 입력 받기 ---

# rclone 명령어 경로 확인
RCLONE_PATH=$(which rclone)
if [ -z "$RCLONE_PATH" ]; then
    echo -e "${RED}오류: rclone이 설치되어 있지 않거나 PATH에 없습니다.${NC}"
    echo "먼저 rclone을 설치해주세요. (https://rclone.org/install/)"
    exit 1
fi
echo -e "rclone 실행 경로 확인: ${GREEN}$RCLONE_PATH${NC}"
echo

# rclone 리모트 이름
read -p "rclone 리모트 이름을 입력하세요 (예: onedrive): " RCLONE_REMOTE
if [ -z "$RCLONE_REMOTE" ]; then
    echo -e "${RED}오류: 리모트 이름은 필수입니다.${NC}"
    exit 1
fi

# 로컬 마운트 경로
read -p "마운트할 로컬 디렉토리 경로를 입력하세요 (예: $HOME/OneDrive): " MOUNT_DIR
if [ -z "$MOUNT_DIR" ]; then
    echo -e "${RED}오류: 마운트 디렉토리 경로는 필수입니다.${NC}"
    exit 1
fi

# 마운트할 디렉토리가 없으면 생성
if [ ! -d "$MOUNT_DIR" ]; then
    echo -e "${YELLOW}'$MOUNT_DIR' 디렉토리가 존재하지 않습니다.${NC}"
    read -p "지금 생성하시겠습니까? (y/n): " create_dir
    if [[ "$create_dir" == "y" || "$create_dir" == "Y" ]]; then
        mkdir -p "$MOUNT_DIR"
        echo -e "${GREEN}'$MOUNT_DIR' 디렉토리를 생성했습니다.${NC}"
    else
        echo -e "${RED}작업을 취소합니다.${NC}"
        exit 1
    fi
fi

# 서비스를 실행할 사용자 및 그룹
read -p "이 서비스를 실행할 사용자 이름을 입력하세요 (예: $USER): " RUN_USER
if ! id "$RUN_USER" &>/dev/null; then
    echo -e "${RED}오류: '$RUN_USER' 사용자가 시스템에 존재하지 않습니다.${NC}"
    exit 1
fi
RUN_GROUP=$(id -gn "$RUN_USER")
echo -e "서비스는 ${GREEN}${RUN_USER}:${RUN_GROUP}${NC} 권한으로 실행됩니다."
echo

# VFS 캐시 최대 크기
read -p "캐시 최대 크기를 입력하세요 (예: 100G): " VFS_CACHE_SIZE
if [ -z "$VFS_CACHE_SIZE" ]; then
    VFS_CACHE_SIZE="100G" # 기본값
    echo -e "${YELLOW}입력값이 없어 기본값인 100G로 설정합니다.${NC}"
fi
echo

# --- 2. systemd 서비스 파일 생성 ---

SERVICE_NAME="rclone-mount-${RUN_USER}-${RCLONE_REMOTE}.service"
SERVICE_FILE_PATH="/etc/systemd/system/${SERVICE_NAME}"

echo -e "${YELLOW}다음 내용으로 systemd 서비스 파일을 생성합니다...${NC}"
echo "-----------------------------------------------------"
echo -e "  ${GREEN}서비스 파일 경로:${NC} $SERVICE_FILE_PATH"
echo -e "  ${GREEN}실행할 명령어:${NC}"
echo -e "  $RCLONE_PATH mount ${RCLONE_REMOTE}: ${MOUNT_DIR}"
echo "-----------------------------------------------------"
echo


# Heredoc을 사용하여 서비스 파일 내용 구성
read -r -d '' SERVICE_CONTENT << EOM
[Unit]
Description=Rclone Mount for ${RCLONE_REMOTE} (${RUN_USER})
AssertPathIsDirectory=${MOUNT_DIR}
After=network-online.target

[Service]
Type=notify
ExecStart=${RCLONE_PATH} mount ${RCLONE_REMOTE}: ${MOUNT_DIR} \\
    --vfs-cache-mode full \\
    --vfs-cache-max-size ${VFS_CACHE_SIZE} \\
    --vfs-cache-max-age 72h \
    --dir-cache-time 24h \
    --poll-interval 1m \
    --exclude "개인 중요 보관소/**"
ExecStop=/bin/fusermount -u ${MOUNT_DIR}
Restart=on-failure
RestartSec=5
User=${RUN_USER}
Group=${RUN_GROUP}

[Install]
WantedBy=default.target
EOM

# 서비스 파일 쓰기
echo "$SERVICE_CONTENT" > "$SERVICE_FILE_PATH"

# --- 3. 서비스 등록 및 시작 ---

echo -e "${GREEN}systemd 데몬을 리로드합니다...${NC}"
systemctl daemon-reload

echo -e "${GREEN}생성된 서비스를 활성화합니다 (부팅 시 자동 시작)...${NC}"
systemctl enable "$SERVICE_NAME"

echo -e "${GREEN}지금 서비스를 시작합니다...${NC}"
systemctl start "$SERVICE_NAME"

# 잠시 대기 후 상태 확인
echo -e "${YELLOW}서비스 시작 후 5초간 대기합니다...${NC}"
sleep 5

# --- 4. 최종 확인 ---

echo "====================================================="
echo -e "${GREEN}최종 서비스 상태를 확인합니다.${NC}"
echo "====================================================="
systemctl status "$SERVICE_NAME" --no-pager
echo "-----------------------------------------------------"

# 마운트 상태 확인
if mount | grep -q "$MOUNT_DIR"; then
    echo -e "${GREEN}성공: '$MOUNT_DIR'에 성공적으로 마운트되었습니다.${NC}"
    df -h | grep -E "Filesystem|${MOUNT_DIR}"
else
    echo -e "${RED}오류: 마운트를 확인하지 못했습니다.${NC}"
    echo -e "${YELLOW}서비스 로그를 확인하여 원인을 파악하세요:${NC}"
    echo "journalctl -u ${SERVICE_NAME} -b"
fi

echo
echo -e "${GREEN}모든 작업이 완료되었습니다.${NC}"
