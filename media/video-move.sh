#!/bin/bash

# --- 설정 변수 ---
SOURCE_DIR="/mnt/lily/downloads/torrent/" # 원본 폴더 경로 (예: /home/user/videos)
DEST_DIR="/mnt/lily/downloads/recent/" # 도착지 폴더 경로 (예: /home/user/moved_videos)
MIN_FILE_SIZE_MB=200 # 이동할 파일의 최소 용량 (MB)
MAX_FOLDER_SIZE_MB=500 # 삭제할 폴더의 최대 용량 (MB)
# 탐색할 영상 파일 확장자 (소문자로 작성, 대소문자 구분 없이 탐색합니다)
# 필요에 따라 확장자를 추가하거나 제거할 수 있습니다. (예: ts, webm 등)
VIDEO_EXTENSIONS="mp4|mkv|avi|mov|flv|wmv"

# --- 스크립트 설정 ---
set -euo pipefail # 오류 발생 시 즉시 종료, 정의되지 않은 변수 사용 금지, 파이프라인 오류 처리

# --- 함수 정의 ---

# 디렉토리가 존재하는지 확인하는 함수
check_dir_exists() {
    if [[ ! -d "$1" ]]; then
        echo "오류: '$1' 디렉토리가 존재하지 않습니다."
        exit 1
    fi
}

# --- 스크립트 시작 ---
echo "--- 영상 파일 이동 및 폴더 정리 스크립트 시작 ---"

# 1. 필수 디렉토리 확인 및 생성
check_dir_exists "$SOURCE_DIR"
mkdir -p "$DEST_DIR" # 목적지 폴더가 없으면 생성
echo "원본 폴더: $SOURCE_DIR"
echo "도착지 폴더: $DEST_DIR"
echo "이동 최소 파일 용량: ${MIN_FILE_SIZE_MB}MB"
echo "삭제 최대 폴더 용량: ${MAX_FOLDER_SIZE_MB}MB"
echo "탐색할 영상 확장자: .$VIDEO_EXTENSIONS"
echo ""

# 2. 영상 파일 탐색 및 이동
echo ">> ${MIN_FILE_SIZE_MB}MB 이상 영상 파일들을 '$SOURCE_DIR' 에서 '$DEST_DIR' 으로 이동 중..."
echo "(동일한 이름의 파일이 목적지에 있으면 이동하지 않고 건너뜁니다.)"

find "$SOURCE_DIR" -type f \
    -iregex ".*\.\(${VIDEO_EXTENSIONS//|/\\|}\)$" \
    -size "+${MIN_FILE_SIZE_MB}M" \
    -print0 | while IFS= read -r -d $'\0' file; do
    
    filename=$(basename "$file") # 파일 이름만 추출
    
    # 목적지 폴더에 동일한 이름의 파일이 이미 있는지 확인
    if [[ -f "$DEST_DIR/$filename" ]]; then
        echo "경고: '$filename' 파일이 이미 도착지 폴더에 존재합니다. 이동을 건너뜁니다."
    else
        echo "이동: '$file' -> '$DEST_DIR/$filename'"
        mv "$file" "$DEST_DIR/" # 파일 이동
    fi
done
echo ">> 영상 파일 이동 작업 완료."
echo ""

# 3. 용량 미만의 직계 자식 폴더 삭제
echo ">> '$SOURCE_DIR' 의 직계 자식 폴더 중 ${MAX_FOLDER_SIZE_MB}MB 미만 폴더를 삭제 중..."
echo "(원본 폴더 자체는 삭제 대상에서 제외되며, 그 하위 폴더는 삭제 대상이 아닙니다.)"

# find 명령으로 디렉토리 탐색
# -mindepth 1: 원본 폴더 자체(SOURCE_DIR)는 제외하고 그 하위 디렉토리부터 탐색
# -maxdepth 1: 탐색 깊이를 1로 제한하여 SOURCE_DIR의 직계 자식 폴더만 찾음
# -type d: 디렉토리만 찾기
# -print0: 파일 이름을 널 문자로 구분하여 출력 (공백이나 특수 문자가 포함된 파일 이름 처리 안전)
find "$SOURCE_DIR" -mindepth 1 -maxdepth 1 -type d -print0 | while IFS= read -r -d $'\0' dir; do
    # du -sm: 디렉토리 용량을 MB 단위로 출력 (총 용량)
    # 2>/dev/null: 권한 없음 등의 오류 메시지 무시
    SIZE_MB=$(du -sm "$dir" 2>/dev/null | awk '{print $1}')

    # du가 아무것도 반환하지 않거나 오류가 발생한 경우 (예: 이미 삭제된 디렉토리) 건너뛰기
    if [[ -z "$SIZE_MB" ]]; then
        continue
    fi

    # --- 변경된 부분: bc 대신 Bash의 정수 비교 사용 ---
    if (( SIZE_MB < MAX_FOLDER_SIZE_MB )); then
        echo "삭제: '$dir' (용량: ${SIZE_MB}MB)"
        rm -rf "$dir" # 폴더 및 내용물 강제 삭제
    else
        echo "유지: '$dir' (용량: ${SIZE_MB}MB)"
    fi
done
echo ">> 직계 자식 폴더 정리 작업 완료."
echo ""

echo "--- 스크립트 종료 ---"
