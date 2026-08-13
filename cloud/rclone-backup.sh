#!/bin/bash
# TODO : json onedrive 명칭을 remote로, 범용사용 가능하게. 또한 인자들 키값을 더 짧게 합니다. recursive는 subfolder로 수정

# 에러 발생 시 스크립트 실행 중단
set -e

# --- 스크립트 설정 ---
readonly CONFIG_FILE="/home/easydev/rclone-backup.json"

# [개선됨] sudo로 실행 시 실제 사용자의 홈 디렉터리를 감지
if [[ -n "$SUDO_USER" ]]; then
    # sudo로 실행된 경우, 원래 사용자의 홈 디렉터리를 가져옴
    TARGET_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
    # 직접 실행된 경우, 현재 사용자의 홈 디렉터리를 사용
    TARGET_HOME=$HOME
fi

# rclone 설정 파일의 절대 경로를 동적으로 지정
readonly RCLONE_CONFIG_FILE="${TARGET_HOME}/.config/rclone/rclone.conf"

# --- 사전 요구사항 확인 ---
if ! command -v rclone &> /dev/null; then
    echo "오류: 'rclone'이 설치되어 있지 않습니다." >&2
    exit 1
fi
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "오류: 설정 파일 '$CONFIG_FILE'을 찾을 수 없습니다." >&2
    exit 1
fi
if [[ ! -f "$RCLONE_CONFIG_FILE" ]]; then
    echo "오류: rclone 설정 파일 '$RCLONE_CONFIG_FILE'을 찾을 수 없습니다." >&2
    exit 1
fi

# --- 설정 파일 파싱 (의존성 없음, 안정성 향상) ---
parse_value() {
    local string=$1
    local key=$2
    # 따옴표로 묶인 키와 값을 정확히 파싱하도록 정규식 수정
    echo "$string" | grep -o "\"${key}\"\s*:\s*\"[^\"]*\"" | sed -r "s/\"${key}\"\s*:\s*\"(.*)\"/\1/"
}

ONEDRIVE_REMOTE=$(grep '"onedrive_remote"' "$CONFIG_FILE" | sed -r 's/.*: *"([^"]*)".*/\1/')
ONEDRIVE_BASE_PATH=$(grep '"onedrive_base_path"' "$CONFIG_FILE" | sed -r 's/.*: *"([^"]*)".*/\1/')

job_content=$(sed -n '/"jobs": \[/,/\]/p' "$CONFIG_FILE" | sed '1s/.*"jobs": \[//;$s/\].*//')
job_list=$(echo "$job_content" | tr -d '\n\r ' | sed 's/},{/}\n{/g')

# --- 백업 실행 로직 ---
job_count=$(echo "$job_list" | grep -c '{')
current_job_num=0

echo "총 ${job_count}개의 백업 Job을 시작합니다. (설정: ${CONFIG_FILE})"
echo "========================================"

while IFS= read -r job_str; do
    [[ -z "$job_str" ]] && continue
    current_job_num=$((current_job_num + 1))

    local_src_raw=$(parse_value "$job_str" "source")
    dest_subpath=$(parse_value "$job_str" "destination")
    include_pattern=$(parse_value "$job_str" "include_pattern")

    # [개선됨] 'eval' 대신 안전한 방식으로 홈 디렉터리(~) 확장
    local_src="${local_src_raw/#\~/$TARGET_HOME}"
    dest_path="${ONEDRIVE_REMOTE}:${ONEDRIVE_BASE_PATH}/${dest_subpath}"

    echo "Job [ ${current_job_num} / ${job_count} ]"
    echo "  - 소스: '${local_src}'"
    echo "  - 목적지: '${dest_path}'"

    # [수정됨] --create-empty-src-dirs 플래그를 조건부로 추가하기 위해 초기 명령어에서 제외
    rclone_cmd=("sudo" "rclone" "sync" "$local_src" "$dest_path" "--config=${RCLONE_CONFIG_FILE}" "--progress")

    if [[ -n "$include_pattern" ]]; then
        echo "  - 적용 필터: ${include_pattern}"
        rclone_cmd+=("--include=${include_pattern}")
    else
        echo "  - 모든 파일 백업"
    fi

    # [수정됨] 재귀/비재귀 여부에 따라 옵션을 다르게 설정
    # JSON에서 "recursive":false 문자열을 찾아 비재귀 모드 설정
    if echo "$job_str" | grep -q '"recursive":false'; then
        echo "  - 비재귀 모드 (최대 깊이: 1)"
        rclone_cmd+=("--max-depth=1")
    else
        echo "  - 재귀 모드 (기본값)"
        # 재귀 모드일 때만 빈 폴더 생성 옵션 추가
        rclone_cmd+=("--create-empty-src-dirs")
    fi

    "${rclone_cmd[@]}"

    echo "완료."
    echo "----------------------------------------"
done <<< "$job_list"

echo "모든 백업 Job이 성공적으로 완료되었습니다."
