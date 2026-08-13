#!/bin/bash

# Job Control을 활성화하여 각 백그라운드 프로세스가 자신의 프로세스 그룹을 갖도록 합니다.
set -m

# 설정 파일 경로를 첫 번째 인자로부터 받습니다.
if [ -z "$1" ]; then
    echo "오류: 설정 파일 경로를 첫 번째 인자로 제공해야 합니다." >&2
    exit 1
fi
CONFIG_FILE="$1"

pids=() # 모든 자식 프로세스의 PID를 저장할 배열

# jq 설치 여부 확인
if ! command -v jq &> /dev/null; then
    echo "오류: 이 스크립트를 실행하려면 jq가 필요합니다." >&2
    exit 1
fi

# 설정 파일 존재 여부 확인
if [ ! -f "$CONFIG_FILE" ]; then
    echo "오류: 설정 파일($CONFIG_FILE)을 찾을 수 없습니다." >&2
    exit 1
fi

# 프로세스 정리 함수
cleanup() {
    echo "종료 신호 수신. systemd가 CGroup의 모든 프로세스를 정리합니다."
    # 실제 kill 로직은 systemd가 담당하므로 스크립트의 trap은 보조적인 역할만 합니다.
    # 그대로 두어도 문제는 없습니다.
    if [ ${#pids[@]} -gt 0 ]; then
        kill "${pids[@]}" 2>/dev/null
    fi
    echo "스크립트 종료."
    exit 0
}

trap cleanup SIGINT SIGTERM

# 프로젝트 목록을 배열로 읽어옵니다.
readarray -t projects < <(jq -c '.[]' "$CONFIG_FILE")

for project_json in "${projects[@]}"; do
    name=$(echo "$project_json" | jq -r '.name // "Unnamed Project"')
    workdir=$(echo "$project_json" | jq -r '.directory')
    workdir=${workdir/\%h/$HOME}

    echo "--- [프로젝트: $name] 설정 로드 ---"

    if [ ! -d "$workdir" ]; then
        echo "경고: 작업 디렉토리 '$workdir'를 찾을 수 없습니다. 이 프로젝트를 건너뜁니다."
        continue
    fi

    # 명령어 목록을 배열로 읽어옵니다.
    readarray -t commands < <(echo "$project_json" | jq -r '.commands[]')

    for cmd in "${commands[@]}"; do
        if [ -z "$cmd" ]; then continue; fi
        echo "[$name] 실행: $cmd (경로: $workdir)"
        (cd "$workdir" && eval "$cmd") &
        pids+=($!)
    done
done

if [ ${#pids[@]} -eq 0 ]; then
    echo "시작된 서비스가 없습니다. 스크립트를 종료합니다."
    exit 0
fi

echo "--- 모든 서비스 시작 완료 ---"
echo "관리 중인 메인 프로세스 PID: ${pids[*]}"

wait
exit $?