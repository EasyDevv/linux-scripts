#!/usr/bin/env bash

keyword="${1:-fnm}"  # 첫 번째 인자가 있으면 사용, 없으면 기본값 fnm

# 기본 검색 경로 정의
search_paths="$HOME/.config/fish/config.fish \
$HOME/.config/fish/functions \
$HOME/.bashrc \
$HOME/.zshrc \
$HOME/.profile \
$HOME/.bash_profile \
$HOME/.config"

echo "🔍 [$keyword] 관련 설정을 검색 중..."
echo "--------------------------------------"

# 파일별로 grep 결과를 출력 (파일명과 줄번호까지 표시)
matches=$(grep -R --color=never -n "$keyword" $search_paths 2>/dev/null)

if [[ -z "$matches" ]]; then
    echo "✅ '$keyword' 관련 설정을 찾지 못했습니다."
else
    echo "⚠️ '$keyword' 관련 설정 발견:"
    echo "$matches" | while IFS= read -r line; do
        file=$(echo "$line" | cut -d: -f1)
        lineno=$(echo "$line" | cut -d: -f2)
        content=$(echo "$line" | cut -d: -f3-)
        echo "📄 파일: $file (줄 $lineno)"
        echo "    → $content"
    done
fi

echo "--------------------------------------"
echo ""
echo "현재 PATH에서 '$keyword' 관련 경로:"
echo "$PATH" | tr ':' '\n' | grep "$keyword" || echo "없음"

echo ""
read -p "'$keyword' 관련 설정을 제거하시겠습니까? [y/N] " confirm

if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
    echo "🧹 '$keyword' 관련 설정 삭제 중..."

    # 1. Fish config에서 키워드 제거
    if [[ -f "$HOME/.config/fish/config.fish" ]]; then
        sed -i "/$keyword/d" "$HOME/.config/fish/config.fish"
    fi

    # 2. Fish 함수 디렉토리 내부 전체 검색 후 삭제
    find "$HOME/.config/fish/functions" -type f -name '*.fish' 2>/dev/null | while read -r f; do
        sed -i "/$keyword/d" "$f"
    done

    # 3. 주요 초기화 스크립트에서 삭제
    for f in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile" "$HOME/.bash_profile"; do
        if [[ -f "$f" ]]; then
            sed -i "/$keyword/d" "$f"
        fi
    done

    # 4. /run/user/1000/* 캐시 삭제
    cache_dir="/run/user/1000/${keyword}_multishells"
    if [[ -d "$cache_dir" ]]; then
        echo "🧹 $cache_dir 캐시 삭제 중..."
        rm -rf "$cache_dir"
    fi

    echo ""
    echo "✅ '$keyword' 관련 설정 삭제 완료"
    echo "♻️ 세션을 갱신하려면 아래 명령을 실행하세요:"
    echo "    exec \$SHELL -l"
else
    echo "작업을 취소했습니다."
fi
