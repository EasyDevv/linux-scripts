#!/bin/bash

# YouTube 영상/재생목록 → ~/.yt-dlp/<채널>/<YYMMDD>-<ID>/meta.json + dialogue.txt
# dialogue.txt는 타임스탬프 없는 대사만, meta.json에 출처(다운로드/STT)+화자프로필 표기.
# 자막 우선, 없으면 음성만 받아 STT (onnx sensevoice 우선, 없으면 whisper turbo).
# 채널 화자성향은 <채널>/channel.json에 solo|multi|unknown으로 유지, 이후 영상에 승계.

set -euo pipefail

BASE_DIR="$HOME/.yt-dlp"
ONNX_BIN="$HOME/.local/lib/voxtype/voxtype-onnx"
PLAYLIST=0
ITEMS=""
SPEAKERS=""
URLS=()

usage() {
    echo "사용법: $(basename "$0") [--playlist] [--items SPEC] [--speakers solo|multi] URL [URL...]"
    echo "  --playlist   재생목록 전체 처리 (기본: 단일 영상만)"
    echo "  --items SPEC yt-dlp --playlist-items 값 전달 (예: 1-10)"
    echo "  --speakers   채널 화자성향 지정 후 channel.json에 저장 (생략 시 기존값 승계)"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --playlist) PLAYLIST=1; shift ;;
        --items) ITEMS="$2"; shift 2 ;;
        --speakers)
            [[ "$2" == "solo" || "$2" == "multi" ]] || { echo "오류: --speakers solo|multi"; exit 1; }
            SPEAKERS="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) URLS+=("$1"); shift ;;
    esac
done

if [[ ${#URLS[@]} -eq 0 ]]; then
    usage; exit 1
fi

for cmd in yt-dlp ffmpeg voxtype; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "오류: '$cmd' 명령이 없습니다."; exit 1
    fi
done

# 채널명 파일시스템 안전화
sanitize() {
    echo "$1" | tr '/:*?"<>|' '_' | sed 's/^ *//;s/ *$//'
}

# STT 모델 확인 및 자동 다운로드 (onnx sensevoice 우선, 없으면 whisper turbo)
ensure_stt_models() {
    if [[ -x "$ONNX_BIN" ]]; then
        if [[ ! -d "$HOME/.local/share/voxtype/models/sensevoice-small" ]]; then
            echo ">> sensevoice-small 모델 설치 중..."
            "$ONNX_BIN" setup --download --model sensevoice-small
        fi
    elif [[ ! -f "$HOME/.local/share/voxtype/models/ggml-large-v3-turbo.bin" ]]; then
        echo ">> whisper large-v3-turbo 모델 설치 중... (약 1.6GB)"
        voxtype setup --download --model large-v3-turbo
    fi
}

# STT용 임시 설정 (사용자 설정은 건드리지 않음: 모델 turbo + 언어 자동 + sensevoice 섹션)
make_stt_config() { # $1=출력경로
    cp "$HOME/.config/voxtype/config.toml" "$1"
    sed -i '/^\[whisper\]/,/^\[/ s/^model = .*/model = "large-v3-turbo"/' "$1"
    sed -i '/^\[whisper\]/,/^\[/ s/^language = .*/language = "auto"/' "$1"
    grep -q '^\[sensevoice\]' "$1" || printf '\n[sensevoice]\nmodel = "sensevoice-small"\nlanguage = "auto"\nuse_itn = true\n' >> "$1"
}

# 채널 화자프로필 기록 (同 프로필이면 기존 speaker_names 유지)
write_channel_json() { # $1=파일 $2=채널명 $3=solo|multi|unknown
    python3 - "$1" "$2" "$3" <<'EOF'
import json, sys, datetime
cfile, cname, prof = sys.argv[1:4]
names, note = [], ""
try:
    old = json.load(open(cfile, encoding="utf-8"))
    if old.get("speakers") == prof:
        names = old.get("speaker_names", [])
        note = old.get("note", "")
except Exception:
    pass
with open(cfile, "w", encoding="utf-8") as f:
    json.dump({"channel": cname, "speakers": prof, "speaker_names": names,
               "updated": datetime.date.today().isoformat(), "note": note},
              f, ensure_ascii=False, indent=2)
    f.write("\n")
EOF
}

# SRT → 타임스탬프 없는 대사 (큐번호·타임라인·HTML태그·연속중복 제거)
srt_to_text() {
    sed -e 's/<[^>]*>//g' "$1" \
        | grep -v -E '^[0-9]+$|^[0-9]{2}:[0-9]{2}:[0-9]{2},' \
        | sed '/^$/d' | awk 'prev!=$0{print} {prev=$0}'
}

write_meta() { # $1=OUT $2=제목 $3=URL $4=ID $5=날짜 $6=출처 $7=프로필 $8=channel.json
    python3 - "$1/meta.json" "$2" "$3" "$4" "$5" "$6" "$7" "$8" <<'EOF'
import json, sys
out, title, url, vid, date, source, prof, cfile = sys.argv[1:9]
try:
    names = json.load(open(cfile, encoding="utf-8")).get("speaker_names", [])
except Exception:
    names = []
speakers = {"profile": prof, "count": 1 if prof == "solo" else None,
            "names": names, "attribution": "none"}
with open(out, "w", encoding="utf-8") as f:
    json.dump({"title": title, "url": url, "video_id": vid,
               "date": date, "source": source, "speakers": speakers},
              f, ensure_ascii=False, indent=2)
    f.write("\n")
EOF
}

OK_LIST=()
FAIL_LIST=()

# 단일 영상 처리. 성공 시 0, 실패 시 0이 아님.
process_video() { # $1=영상URL
    local meta channel up_date vid title
    meta=$(yt-dlp --skip-download --no-playlist --quiet --no-warnings \
        --print "%(channel)s|%(upload_date)s|%(id)s|%(title)s" "$1") || return 1
    IFS='|' read -r channel up_date vid title <<< "$meta"
    [[ -z "$vid" || "$vid" == "NA" ]] && return 1

    local yymmdd="${up_date:2:6}"
    local chan_dir="$BASE_DIR/$(sanitize "$channel")"
    local out="$chan_dir/$yymmdd-$vid"
    mkdir -p "$out"
    # 채널 화자프로필: 플래그 > 기존 channel.json > 신규 unknown
    if [[ -n "$SPEAKERS" ]]; then
        write_channel_json "$chan_dir/channel.json" "$channel" "$SPEAKERS"
    elif [[ ! -f "$chan_dir/channel.json" ]]; then
        write_channel_json "$chan_dir/channel.json" "$channel" "unknown"
    fi
    local profile
    profile=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('speakers','unknown'))" "$chan_dir/channel.json")
    local watch_url="https://www.youtube.com/watch?v=$vid"
    local date_fmt="${up_date:0:4}-${up_date:4:2}-${up_date:6:2}"

    # 1. 자막 우선
    yt-dlp --skip-download --no-playlist --quiet --no-warnings \
        --write-subs --write-auto-subs --sub-langs "ko,en.*" \
        --sub-format "srt/best" -o "$out/%(id)s.%(ext)s" "$1" || true

    local srt=""
    for cand in "$out/$vid.ko.srt" "$out/$vid.en.srt" "$out"/"$vid".*.srt; do
        if [[ -f "$cand" ]]; then srt="$cand"; break; fi
    done

    if [[ -n "$srt" ]]; then
        local base="${srt%.srt}"; local lang="${base##*.}"
        srt_to_text "$srt" > "$out/dialogue.txt"
        write_meta "$out" "$title" "$watch_url" "$vid" "$date_fmt" \
            "다운로드 자막 (youtube-subs-$lang)" "$profile" "$chan_dir/channel.json"
        echo "자막완료: $out/meta.json"
        return 0
    fi

    # 2. 자막 없음 → 음성만 다운로드 후 STT
    ensure_stt_models
    yt-dlp -x --audio-format wav --no-playlist --quiet --no-warnings \
        -o "$out/audio.%(ext)s" "$1" || return 1
    ffmpeg -y -loglevel error -i "$out/audio.wav" -ar 16000 -ac 1 "$out/vox.wav" || return 1
    make_stt_config "$out/stt-config.toml"
    local stt_bin="voxtype" stt_engine="whisper"
    local stt_source="STT 전사 (whisper-large-v3-turbo)"
    if [[ -x "$ONNX_BIN" ]]; then
        stt_bin="$ONNX_BIN"; stt_engine="sensevoice"
        stt_source="STT 전사 (sensevoice)"
    fi
    "$stt_bin" -c "$out/stt-config.toml" transcribe --engine "$stt_engine" \
        "$out/vox.wav" > "$out/stt.log" 2>&1 || return 1

    local text
    text=$(sed -n 's/.*Transcription completed in .*:[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' \
        "$out/stt.log" | tail -n 1)
    if [[ -z "$text" ]]; then
        echo "경고: 전사문 추출 실패 ($vid, $out/stt.log 확인)"
        return 1
    fi
    echo "$text" > "$out/dialogue.txt"
    write_meta "$out" "$title" "$watch_url" "$vid" "$date_fmt" \
        "$stt_source" "$profile" "$chan_dir/channel.json"
    echo "STT완료: $out/meta.json"
    return 0
}

for url in "${URLS[@]}"; do
    if [[ $PLAYLIST -eq 1 ]]; then
        # 재생목록: 영상 ID 나열 후 개별 처리
        item_args=()
        [[ -n "$ITEMS" ]] && item_args=(--playlist-items "$ITEMS")
        ids=$(yt-dlp --flat-playlist --quiet --no-warnings --print "%(id)s" \
            "${item_args[@]}" "$url") || { FAIL_LIST+=("$url (목록조회실패)"); continue; }
        while IFS= read -r vid; do
            [[ -z "$vid" ]] && continue
            if process_video "https://www.youtube.com/watch?v=$vid"; then
                OK_LIST+=("$vid")
            else
                FAIL_LIST+=("$vid")
            fi
        done <<< "$ids"
    else
        if process_video "$url"; then
            OK_LIST+=("$url")
        else
            FAIL_LIST+=("$url")
        fi
    fi
done

echo ""
echo "--- 결과: 성공 ${#OK_LIST[@]} / 실패 ${#FAIL_LIST[@]} ---"
for f in "${FAIL_LIST[@]}"; do echo "실패: $f"; done
[[ ${#FAIL_LIST[@]} -gt 0 ]] && exit 1
exit 0
