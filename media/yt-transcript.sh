#!/bin/bash

# YouTube 영상/재생목록 → ~/chat/scrape/youtube/<채널>/<YYMMDD>-<ID>/meta.json + dialogue.txt
# dialogue.txt는 타임스탬프 없는 대사만, meta.json에 출처(다운로드/STT)+화자프로필 표기.
# 자막 우선, 없으면 음성만 받아 로컬 GPU STT로 전사 (기본 qwen3_asr_1.7b_ko, --fast는 nemotron 3.5).
# STT 러너는 asr/<모델>.py (uv 인라인 스크립트, wav 인자 → 줄마다 JSON {file,text,sec}).
# 채널 화자성향은 <채널>/channel.json에 solo|multi|unknown으로 유지, 이후 영상에 승계.

set -euo pipefail

BASE_DIR="$HOME/chat/scrape/youtube"
ASR_DIR="$(dirname "$(readlink -f "$0")")/asr"
# 모델 선정 근거: chat/docs/voice/261016-korean-stt-ab-test.md (교체는 evaluate-stt-models 스킬)
STT_RUNNER="qwen_ko"; STT_SOURCE="STT 전사 (TeamUNIVA/qwen3_asr_1.7b_ko)"
FORCE_STT=0
PLAYLIST=0
ITEMS=""
SPEAKERS=""
USE_VPN=1
URLS=()

usage() {
    echo "사용법: $(basename "$0") [--playlist] [--items SPEC] [--speakers solo|multi] [--fast] [--stt] [--no-vpn] URL [URL...]"
    echo "  --playlist   재생목록 전체 처리 (기본: 단일 영상만)"
    echo "  --items SPEC yt-dlp --playlist-items 값 전달 (예: 1-10)"
    echo "  --speakers   채널 화자성향 지정 후 channel.json에 저장 (생략 시 기존값 승계)"
    echo "  --fast       고속 전사: nemotron-3.5-asr-streaming-0.6b (기본 qwen3_asr_1.7b_ko 대비 ~5배 빠름, 정확도 약간 낮음)"
    echo "  --stt        자막이 있어도 무시하고 STT로 전사"
    echo "  --no-vpn     AdGuard VPN SOCKS 프록시 없이 직접 접속 (기본: VPN 경유, YT_PROXY로 주소 지정 가능)"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --playlist) PLAYLIST=1; shift ;;
        --no-vpn) USE_VPN=0; shift ;;
        --fast) STT_RUNNER="nemotron"; STT_SOURCE="STT 전사 (nvidia/nemotron-3.5-asr-streaming-0.6b)"; shift ;;
        --stt) FORCE_STT=1; shift ;;
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

for cmd in yt-dlp ffmpeg uv; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "오류: '$cmd' 명령이 없습니다."; exit 1
    fi
done
[[ -f "$ASR_DIR/$STT_RUNNER.py" ]] || { echo "오류: STT 러너 없음 ($ASR_DIR/$STT_RUNNER.py)."; exit 1; }

# yt-dlp 공통 옵션: YouTube 봇 차단("Sign in to confirm you're not a bot") 회피용 AdGuard VPN SOCKS
# 프록시와 JS 런타임(deno 없으면 bun). VPN이 끊겨 있으면 연결한다(SOCKS 모드라 시스템 라우팅 불변).
YTDLP_ARGS=()
VPN_AUTO=0
# 출구 IP가 봇 차단(또는 403)되면 이 순서로 위치를 바꿔 재시도 (adguardvpn-cli list-locations)
VPN_ROTATE=(Tokyo Seoul Singapore "Hong Kong" Taipei)
if [[ $USE_VPN -eq 1 ]]; then
    if [[ -z "${YT_PROXY:-}" ]]; then
        VPN_AUTO=1
        command -v adguardvpn-cli >/dev/null 2>&1 \
            || { echo "오류: adguardvpn-cli가 없습니다 (--no-vpn 또는 YT_PROXY 지정)."; exit 1; }
        if ! adguardvpn-cli status 2>/dev/null | grep -q 'SOCKS'; then
            adguardvpn-cli connect >/dev/null 2>&1 || true
        fi
        hostport=$(adguardvpn-cli status 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' \
            | grep -oE 'listening on [0-9.]+:[0-9]+' | awk '{print $3}')
        [[ -n "$hostport" ]] || { echo "오류: AdGuard VPN SOCKS 연결 실패 (adguardvpn-cli config set-mode socks 확인)."; exit 1; }
        YT_PROXY="socks5://$hostport"
    fi
    YTDLP_ARGS+=(--proxy "$YT_PROXY")
fi
if ! command -v deno >/dev/null 2>&1 && command -v bun >/dev/null 2>&1; then
    YTDLP_ARGS+=(--js-runtimes bun)
fi
# 봇 차단/403 → 다음 VPN 위치로 재연결, 프록시 끊김(재연결 중) → 5초 뒤 연결 확인 후 같은 위치로 재시도.
ytdlp() {
    local err rc i=0 tries=0
    err=$(mktemp)
    while :; do
        rc=0; yt-dlp "${YTDLP_ARGS[@]}" "$@" 2> "$err" || rc=$?
        if [[ $rc -eq 0 || $VPN_AUTO -eq 0 ]]; then break; fi
        if grep -qE 'not a bot|HTTP Error 403' "$err" && [[ $i -lt ${#VPN_ROTATE[@]} ]]; then
            echo "YouTube 차단 → VPN 위치 변경: ${VPN_ROTATE[$i]}" >&2
            adguardvpn-cli connect -l "${VPN_ROTATE[$i]}" < /dev/null > /dev/null 2>&1 || true
            i=$((i + 1))
        elif grep -qiE 'connection refused|proxy' "$err" && [[ $tries -lt 3 ]]; then
            sleep 5; tries=$((tries + 1))
            adguardvpn-cli status 2>/dev/null | grep -q 'SOCKS' \
                || adguardvpn-cli connect < /dev/null > /dev/null 2>&1 || true
        else
            break
        fi
    done
    cat "$err" >&2; rm -f "$err"; return $rc
}

# 채널명 파일시스템 안전화
sanitize() {
    echo "$1" | tr '/:*?"<>|' '_' | sed 's/^ *//;s/ *$//'
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

# STT 청크 길이(초). 긴 입력을 한 번에 넣으면 컨텍스트 윈도우를 넘기고 VRAM/처리시간이 늘어나므로,
# 무음 구간에서 잘라 한 번의 모델 로드로 순차 처리한다. A/B 판정도 같은 청크 규칙으로 했다.
CHUNK_MIN=30
CHUNK_MAX=60

# vox.wav → 청크 경계 "시작 끝" 목록. 청크마다 [MIN,MAX] 안의 가장 긴 무음 중앙에서 자르고,
# 무음이 없으면 MAX에서 자른다.
plan_chunks() { # $1=wav
    ffmpeg -nostats -i "$1" -af silencedetect=noise=-35dB:d=0.3 -f null - 2>&1 \
        | python3 -c '
import re, sys
cmin, cmax = float(sys.argv[1]), float(sys.argv[2])
sil, start, total = [], None, 0.0
for line in sys.stdin:
    if m := re.search(r"silence_start: ([\d.]+)", line):
        start = float(m[1])
    elif (m := re.search(r"silence_end: ([\d.]+) \| silence_duration: ([\d.]+)", line)) and start is not None:
        sil.append(((start + float(m[1])) / 2, float(m[2]))); start = None
    if m := re.search(r"time=(\d+):(\d+):([\d.]+)", line):
        total = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
pos = 0.0
while total - pos > cmax:
    cand = [s for s in sil if pos + cmin < s[0] <= pos + cmax]
    cut = max(cand, key=lambda s: s[1])[0] if cand else pos + cmax
    print(f"{pos:.3f} {cut:.3f}"); pos = cut
print(f"{pos:.3f} {total:.3f}")
' "$CHUNK_MIN" "$CHUNK_MAX"
}

# 청크를 모두 자른 뒤 러너 한 번(모델 1회 로드)으로 전사, 대사를 청크당 한 줄씩 stdout.
# 러너 출력(JSONL)과 stderr는 $1/stt.log. 실패 시 0이 아님.
transcribe_chunks() { # $1=OUT
    local out="$1" dir="$1/chunks" s e i=0 wavs=()
    rm -rf "$dir"; mkdir -p "$dir"
    while read -r s e; do
        wavs+=("$dir/$(printf '%03d' $i).wav"); i=$((i + 1))
        ffmpeg -nostdin -y -loglevel error -ss "$s" -to "$e" -i "$out/vox.wav" -c copy "${wavs[-1]}" || return 1
    done < <(plan_chunks "$out/vox.wav")
    uv run --quiet "$ASR_DIR/$STT_RUNNER.py" "${wavs[@]}" \
        < /dev/null > "$out/stt.jsonl" 2> "$out/stt.log" || { cat "$out/stt.jsonl" >> "$out/stt.log"; return 1; }
    python3 -c 'import json, sys
for line in sys.stdin:
    if line.strip(): print(json.loads(line)["text"].strip())' < "$out/stt.jsonl"
    rm -rf "$dir"
}

OK_LIST=()
FAIL_LIST=()

# 단일 영상 처리. 성공 시 0, 실패 시 0이 아님.
process_video() { # $1=영상URL
    local meta channel up_date vid title
    meta=$(ytdlp --skip-download --no-playlist --quiet --no-warnings \
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
    ytdlp --skip-download --no-playlist --quiet --no-warnings \
        --write-subs --write-auto-subs --sub-langs "ko,en.*" \
        --sub-format "srt/best" -o "$out/%(id)s.%(ext)s" "$1" || true

    local srt=""
    for cand in "$out/$vid.ko.srt" "$out/$vid.en.srt" "$out"/"$vid".*.srt; do
        if [[ -f "$cand" ]]; then srt="$cand"; break; fi
    done

    if [[ -n "$srt" && $FORCE_STT -eq 0 ]]; then
        local base="${srt%.srt}"; local lang="${base##*.}"
        srt_to_text "$srt" > "$out/dialogue.txt"
        write_meta "$out" "$title" "$watch_url" "$vid" "$date_fmt" \
            "다운로드 자막 (youtube-subs-$lang)" "$profile" "$chan_dir/channel.json"
        echo "자막완료: $out/meta.json"
        return 0
    fi

    # 2. 자막 없음(또는 --stt) → 음성만 다운로드 후 로컬 STT
    ytdlp -x --audio-format wav --no-playlist --quiet --no-warnings \
        -o "$out/audio.%(ext)s" "$1" || return 1
    ffmpeg -y -loglevel error -i "$out/audio.wav" -ar 16000 -ac 1 "$out/vox.wav" || return 1
    transcribe_chunks "$out" > "$out/dialogue.txt" || return 1
    if [[ ! -s "$out/dialogue.txt" ]]; then
        echo "경고: 전사문 추출 실패 ($vid, $out/stt.log 확인)"
        return 1
    fi
    write_meta "$out" "$title" "$watch_url" "$vid" "$date_fmt" \
        "$STT_SOURCE" "$profile" "$chan_dir/channel.json"
    echo "STT완료: $out/meta.json"
    return 0
}

for url in "${URLS[@]}"; do
    if [[ $PLAYLIST -eq 1 ]]; then
        # 재생목록: 영상 ID 나열 후 개별 처리
        item_args=()
        [[ -n "$ITEMS" ]] && item_args=(--playlist-items "$ITEMS")
        ids=$(ytdlp --flat-playlist --quiet --no-warnings --print "%(id)s" \
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
