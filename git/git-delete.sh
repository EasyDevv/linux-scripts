#!/bin/bash

# Git 히스토리에서 파일을 완전히 제거하는 스크립트
# 사용법: ./git-delete.sh '파일경로/파일명'

set -e  # 오류 발생 시 스크립트 중단

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 함수: 색상 출력
print_color() {
    local color=$1
    local message=$2
    printf "${color}${message}${NC}\n"
}

# 도움말 출력
show_help() {
    cat << EOF
Git 히스토리에서 파일 완전 제거 도구

사용법:
    $0 <파일경로>

예시:
    $0 "config/secrets.txt"
    $0 "docs/private.pdf"
    $0 "*.log"

주의사항:
- 실행 전 반드시 저장소를 백업하세요
- 협업 중인 경우 팀원들과 조율 후 실행하세요
- 실행 후 강제 푸시가 필요합니다
- 로컬 파일은 기본적으로 유지되며, 마지막에 삭제 여부를 묻습니다

옵션:
    -h, --help     이 도움말을 표시합니다
EOF
}

# 인수 확인
if [ $# -eq 0 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
    exit 0
fi

FILE_PATH="$1"

print_color $BLUE "=== Git 히스토리에서 파일 제거 도구 ==="
echo

# Git 저장소 확인
if [ ! -d ".git" ]; then
    print_color $RED "오류: 현재 디렉토리는 Git 저장소가 아닙니다."
    exit 1
fi

# 파일 경로 출력
print_color $YELLOW "제거할 파일: $FILE_PATH"
echo

# 확인 메시지
print_color $YELLOW "⚠️  경고: 이 작업은 Git 히스토리를 영구적으로 변경합니다!"
print_color $YELLOW "⚠️  진행하기 전에 저장소를 백업하는 것을 강력히 권장합니다."
echo

printf "계속하시겠습니까? (y/N): "
read -r response

# 응답 확인 (bash와 fish 호환)
if [ "$response" != "y" ] && [ "$response" != "Y" ] && [ "$response" != "yes" ] && [ "$response" != "YES" ]; then
    print_color $RED "작업이 취소되었습니다."
    exit 0
fi

echo
print_color $GREEN "작업을 시작합니다..."

# 현재 상태 저장 (복구용)
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || git rev-parse --abbrev-ref HEAD)
print_color $BLUE "현재 브랜치: $CURRENT_BRANCH"

# Working directory가 깨끗한지 확인
if ! git diff --quiet || ! git diff --cached --quiet; then
    print_color $RED "오류: Working directory에 커밋되지 않은 변경사항이 있습니다."
    print_color $RED "먼저 변경사항을 커밋하거나 stash하세요."
    exit 1
fi

# git filter-branch 실행
print_color $BLUE "Git filter-branch를 실행합니다..."
echo

# 안전한 방식으로 git filter-branch 실행
if git filter-branch --force --index-filter \
    "git rm --cached --ignore-unmatch '$FILE_PATH'" \
    --prune-empty --tag-name-filter cat -- --all; then

    print_color $GREEN "✓ 파일이 모든 커밋에서 성공적으로 제거되었습니다."
    echo

    # refs/original 정리
    print_color $BLUE "백업 참조를 정리합니다..."
    if [ -d ".git/refs/original" ]; then
        rm -rf .git/refs/original
        print_color $GREEN "✓ 백업 참조가 정리되었습니다."
    fi

    # reflog 정리
    print_color $BLUE "Reflog를 정리합니다..."
    git reflog expire --expire=now --all
    git gc --prune=now --aggressive
    print_color $GREEN "✓ Reflog와 가비지가 정리되었습니다."

    echo
    print_color $GREEN "🎉 작업이 완료되었습니다!"
    echo
    print_color $YELLOW "다음 단계:"
    print_color $YELLOW "1. 변경사항을 원격 저장소에 강제 푸시:"
    print_color $BLUE "   git push --force origin --all"
    print_color $BLUE "   git push --force origin --tags"
    echo
    print_color $YELLOW "2. 협업자들에게 알림:"
    print_color $BLUE "   팀원들은 기존 클론을 삭제하고 새로 클론해야 합니다."

else
    print_color $RED "✗ 오류가 발생했습니다."
    print_color $RED "Git 히스토리 수정에 실패했습니다."
    exit 1
fi
