#!/usr/bin/env bash
# dev-all.sh - 범용 dev 서버 러너
# .dev-all 파일 기반: 포트 해결 → 서비스 병렬 실행
#
# Usage:
#   dev-all.sh [project_root]              서비스 시작 (이미 실행중이면 재시작)
#   dev-all.sh -s|--status                 모든 프로젝트 포트/상태 표시
#   dev-all.sh -k|--stop  [target]         프로젝트 종료
#   dev-all.sh --instance <id> <root>      인스턴스별 포트 고정 모드 (systemd용)
#   dev-all.sh --ports                     인스턴스별 캐시된 포트 표시
#   dev-all.sh --clear-ports <id>          인스턴스 포트 캐시 초기화
#   dev-all.sh -h|--help                   도움말
set -uo pipefail

PORT_CMD="${PORT_BIN:-${RESOLVE_PORT_BIN:-$(command -v port 2>/dev/null || echo "$HOME/.local/share/scripts/ports/port.sh")}}"
DEV_SEARCH_DIRS="${DEV_SEARCH_DIRS:-$HOME/dev}"
PORT_CACHE_DIR="${XDG_RUNTIME_DIR:-/tmp}/dev-all-ports"

# ── 유틸 ─────────────────────────────────────────────────
find_root() {
  local d="$1"
  while [ "$d" != "/" ]; do
    [ -f "$d/.dev-all" ] && echo "$d" && return
    d="$(dirname "$d")"
  done
  return 1
}

find_all_devports() {
  find "$DEV_SEARCH_DIRS" -maxdepth 3 -name '.dev-all' \
    -not -path '*/node_modules/*' -not -path '*/volume/*' 2>/dev/null
}

project_label() {
  local name branch
  name="$(basename "$1")"
  branch="$(git -C "$1" rev-parse --abbrev-ref HEAD 2>/dev/null)" && name="$name:$branch"
  echo "$name"
}

# config → holder PID (flock on fd9, ~30ms)
find_holder_pid() {
  local pid
  for pid in $(pgrep -f 'dev-all\.sh' 2>/dev/null); do
    [ "$(readlink "/proc/$pid/fd/9" 2>/dev/null)" = "$1" ] && echo "$pid" && return
  done
  return 1
}

# PID → systemd unit name (실제 사용자 서비스만, ~1ms)
get_systemd_unit() {
  local u
  u="$(grep -oP '[^/]+\.service$' "/proc/$1/cgroup" 2>/dev/null)" || return 1
  [[ "$u" == app-* ]] && return 1  # transient scope 제외
  echo "$u"
}

# config 파일의 [ports] 섹션만 파싱 (name=default 형식)
parse_ports() {
  local sec=""
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"; line="${line%"${line##*[![:space:]]}"}"; line="${line#"${line%%[![:space:]]*}"}"
    [ -z "$line" ] && continue
    [[ "$line" == "["*"]" ]] && sec="${line//[\[\]]/}" && continue
    [ "$sec" = "ports" ] && echo "$line"
  done < "$1"
}

# ── 포트 캐시 ────────────────────────────────────────────
# config 경로 → 캐시 파일 (인스턴스 ID 또는 프로젝트명 기반)
cache_file_for() {
  local id="$1"
  echo "$PORT_CACHE_DIR/$id.env"
}

load_cached_ports() {
  local file="$1"
  [ -f "$file" ] || return 1
  cat "$file"
}

save_cached_ports() {
  local file="$1"; shift
  mkdir -p "$PORT_CACHE_DIR"
  printf '%s\n' "$@" > "$file"
}

port_free() {
  ! ss -tlnH "sport = :$1" 2>/dev/null | grep -q .
}

port_usable() {
  local port="$1" reserved="$2"
  IFS=',' read -ra arr <<< "$reserved"
  for r in "${arr[@]}"; do [ "$r" = "$port" ] && return 1; done
  port_free "$port"
}

# 프로세스 종료: systemd면 systemctl, 아니면 kill + 포트 정리
kill_project() {
  local config="$1" dir="$2" label="$3" holder_pid unit
  holder_pid="$(find_holder_pid "$config")" || true
  [ -n "$holder_pid" ] && unit="$(get_systemd_unit "$holder_pid")" || unit=""

  if [ -n "$unit" ]; then
    systemctl --user stop "$unit" 2>/dev/null
    echo "$label | stopped ($unit)"
  elif [ -n "$holder_pid" ]; then
    kill -- -"$holder_pid" 2>/dev/null || kill "$holder_pid" 2>/dev/null || true
    sleep 0.2
    kill -0 "$holder_pid" 2>/dev/null && kill -9 "$holder_pid" 2>/dev/null || true
    while IFS='=' read -r _ port; do
      ss -tlnH "sport = :$port" 2>/dev/null | grep -q . && fuser -k "$port/tcp" >/dev/null 2>&1 || true
    done < <(parse_ports "$config")
    echo "$label | stopped (pid $holder_pid)"
  else
    echo "$label | not running"
  fi
}

# target → config 파일 목록
resolve_targets() {
  if [ -z "$1" ] || [ "$1" = "all" ]; then
    find_all_devports
  elif [ -d "$1" ]; then
    local d; d="$(cd "$1" && pwd)"
    [ -f "$d/.dev-all" ] && echo "$d/.dev-all"
  else
    while IFS= read -r f; do
      [ "$(basename "$(dirname "$f")")" = "$1" ] && echo "$f" && return
    done < <(find_all_devports)
  fi
}

# config → 캐시 ID 탐색 (프로젝트 경로로 매칭)
find_cache_id_for_dir() {
  local dir="$1"
  [ -d "$PORT_CACHE_DIR" ] || return 1
  for f in "$PORT_CACHE_DIR"/*.env; do
    [ -f "$f" ] || continue
    local id; id="$(basename "$f" .env)"
    # 캐시 파일의 _PROJECT_DIR 행으로 매칭
    local cached_dir; cached_dir="$(grep '^_PROJECT_DIR=' "$f" 2>/dev/null | cut -d= -f2-)"
    [ "$cached_dir" = "$dir" ] && echo "$id" && return
  done
  return 1
}

# ── --status ─────────────────────────────────────────────
cmd_status() {
  local found=0
  while IFS= read -r config; do
    local dir label pid="" unit="" cache_id=""
    dir="$(dirname "$config")"
    label="$(project_label "$dir")"

    if ! (flock -n 9 || exit 1) 9<"$config" 2>/dev/null; then
      pid="$(find_holder_pid "$config")" || true
      [ -n "$pid" ] && unit="$(get_systemd_unit "$pid")" || true
    fi

    # 캐시에서 실제 런타임 포트 로드
    cache_id="$(find_cache_id_for_dir "$dir")" || true
    declare -A runtime_ports=()
    if [ -n "$cache_id" ]; then
      while IFS='=' read -r cname cval; do
        [[ "$cname" == _* ]] && continue
        [ -n "$cname" ] && [ -n "$cval" ] && runtime_ports["$cname"]="$cval"
      done < "$(cache_file_for "$cache_id")"
    fi

    printf "\n─── %s (%s) ───\n" "$label" "$dir"
    if [ -n "$pid" ]; then
      local mgr; [ -n "$unit" ] && mgr="systemd ($unit)" || mgr="manual"
      [ -n "$cache_id" ] && mgr="$mgr, instance=$cache_id"
      printf "  status: 🟢 running  [%s]\n" "$mgr"
    else
      printf "  status: ⚪ stopped\n"
    fi

    while IFS='=' read -r name default; do
      local actual="${runtime_ports[$name]:-$default}"
      local listen_status
      listen_status="$(ss -tlnH "sport = :$actual" 2>/dev/null | grep -q . && echo LISTEN || echo free)"
      if [ "$actual" != "$default" ]; then
        printf "  %-16s %s → %s  [%s]\n" "$name" "$default" "$actual" "$listen_status"
      else
        printf "  %-16s %s  [%s]\n" "$name" "$actual" "$listen_status"
      fi
    done < <(parse_ports "$config")
    unset runtime_ports
    found=1
  done < <(find_all_devports)
  [ "$found" = 0 ] && echo "No .dev-all files found in $DEV_SEARCH_DIRS"
  return 0
}

# ── --ports ──────────────────────────────────────────────
cmd_ports() {
  [ -d "$PORT_CACHE_DIR" ] || { echo "no cached instances"; return; }
  local found=0
  for f in "$PORT_CACHE_DIR"/*.env; do
    [ -f "$f" ] || continue
    local id; id="$(basename "$f" .env)"
    printf "%-20s " "$id"
    grep -v '^_' "$f" | tr '\n' ' '
    echo
    found=1
  done
  [ "$found" = 0 ] && echo "no cached instances"
}

# ── --stop ───────────────────────────────────────────────
cmd_stop() {
  while IFS= read -r config; do
    kill_project "$config" "$(dirname "$config")" "$(project_label "$(dirname "$config")")"
  done < <(resolve_targets "${1:-}")
}

# ── 커맨드 디스패치 ──────────────────────────────────────
case "${1:-}" in
  -s|--status) cmd_status; exit ;;
  -k|--stop)   cmd_stop "${2:-}"; exit ;;
  --ports)     cmd_ports; exit ;;
  --clear-ports)
    id="${2:?Usage: dev-all.sh --clear-ports <instance_id>}"
    rm -f "$(cache_file_for "$id")"
    echo "cleared: $id"; exit ;;
  --instance)
    # 인스턴스 모드: 포트 캐시 고정 + 서비스 시작
    INSTANCE_ID="${2:?Usage: dev-all.sh --instance <id> <project_root>}"
    shift 2
    ;; # 아래 서비스 시작 로직으로 계속
  -h|--help)
    echo "Usage: dev-all.sh [OPTIONS] [project_root]"
    echo "  (default)                   Start services (replaces existing)"
    echo "  --instance <id> <root>      Start with sticky ports (for systemd)"
    echo "  -s, --status                Show all projects and port status"
    echo "  --ports                     Show cached instance ports"
    echo "  --clear-ports <id>          Clear port cache for instance"
    echo "  -k, --stop [name]           Stop project (name, path, or 'all')"
    exit ;;
esac

# ── 서비스 시작 모드 ─────────────────────────────────────
[ -x "$PORT_CMD" ] || { echo "error: port command not found" >&2; exit 1; }

if [ -n "${1:-}" ] && [ -d "${1:-}" ]; then
  ROOT_DIR="$(cd "$1" && pwd)"
else
  ROOT_DIR="$(find_root "$PWD")" || ROOT_DIR="$(pwd)"
fi

CONFIG="$ROOT_DIR/.dev-all"

# ── .dev-all 자동 생성 ──────────────────────────────────
if [ ! -f "$CONFIG" ]; then
  echo "⚡ .dev-all not found — generating..."
  _gen_ports=() _gen_moon=() _gen_svc=()
  _port=3000

  # moon 프로젝트 탐색: dev 태스크가 있는 프로젝트 찾기
  if command -v moon &>/dev/null && [ -f "$ROOT_DIR/.moon/workspace.yml" ]; then
    while IFS= read -r pdir; do
      [ -f "$pdir/moon.yml" ] || continue
      pname="$(grep -m1 '^\s*name:' "$pdir/moon.yml" 2>/dev/null | sed "s/.*name:\s*['\"]*//" | sed "s/['\"].*$//")"
      [ -z "$pname" ] && pname="$(basename "$pdir")"
      if grep -qE '^\s+dev:' "$pdir/moon.yml" 2>/dev/null; then
        _uname="$(echo "$pname" | tr '[:lower:]-' '[:upper:]_')_PORT"
        _gen_ports+=("$_uname=$_port")
        _gen_moon+=("$pname:dev")
        _port=$((_port + 1))
      fi
    done < <(find "$ROOT_DIR/apps" "$ROOT_DIR/services" "$ROOT_DIR/packages" -maxdepth 1 -mindepth 1 -type d 2>/dev/null)
  fi

  # moon 태스크가 없으면 package.json scripts 탐색
  if [ "${#_gen_moon[@]}" -eq 0 ]; then
    while IFS= read -r pjson; do
      pdir="$(dirname "$pjson")"
      [ "$pdir" = "$ROOT_DIR" ] && continue
      pname="$(basename "$pdir")"
      if grep -qE '"dev"' "$pjson" 2>/dev/null; then
        _uname="$(echo "$pname" | tr '[:lower:]-' '[:upper:]_')_PORT"
        _gen_ports+=("$_uname=$_port")
        _gen_svc+=("$pname: bun run dev")
        _port=$((_port + 1))
      fi
    done < <(find "$ROOT_DIR" -maxdepth 3 -name 'package.json' -not -path '*/node_modules/*' 2>/dev/null)
  fi

  if [ "${#_gen_ports[@]}" -eq 0 ]; then
    echo "error: no dev tasks found to generate .dev-all" >&2; exit 1
  fi

  {
    echo "# Auto-generated by dev-all.sh"
    echo "[ports]"
    printf '%s\n' "${_gen_ports[@]}"
    if [ "${#_gen_moon[@]}" -gt 0 ]; then
      echo ""
      echo "[moon]"
      printf '%s\n' "${_gen_moon[@]}"
    fi
    if [ "${#_gen_svc[@]}" -gt 0 ]; then
      echo ""
      echo "[services]"
      printf '%s\n' "${_gen_svc[@]}"
    fi
  } > "$CONFIG"
  echo "✅ Generated $CONFIG:"
  cat "$CONFIG"
  echo ""
fi
PROJECT_NAME="$(project_label "$ROOT_DIR")"

# ── 이미 실행중이면 종료 후 교체 ────────────────────────
exec 9<"$CONFIG"
if ! flock -n 9; then
  local_pid="$(find_holder_pid "$CONFIG")" || true
  local_unit=""
  [ -n "$local_pid" ] && local_unit="$(get_systemd_unit "$local_pid")" || true

  if [ -n "$local_unit" ]; then
    echo "$PROJECT_NAME | already running via $local_unit, restarting..."
    systemctl --user restart "$local_unit" 2>/dev/null
    exit 0
  fi
  echo "$PROJECT_NAME | replacing previous instance (pid $local_pid)..."
  kill -- -"$local_pid" 2>/dev/null || kill "$local_pid" 2>/dev/null || true
  sleep 0.3
  kill -0 "$local_pid" 2>/dev/null && kill -9 "$local_pid" 2>/dev/null || true
  while IFS='=' read -r _ port; do
    ss -tlnH "sport = :$port" 2>/dev/null | grep -q . && fuser -k "$port/tcp" >/dev/null 2>&1 || true
  done < <(parse_ports "$CONFIG")
  exec 9<"$CONFIG"
  retries=0
  while ! flock -n 9; do
    retries=$((retries + 1))
    [ "$retries" -ge 20 ] && { echo "$PROJECT_NAME | error: lock not released" >&2; exit 1; }
    sleep 0.2
  done
fi

# ── 설정 파싱 ────────────────────────────────────────────
declare -a PORT_NAMES=() PORT_DEFAULTS=() MOON_TASKS=() SVC_DIRS=() SVC_CMDS=()
section=""
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%#*}"; line="${line%"${line##*[![:space:]]}"}"; line="${line#"${line%%[![:space:]]*}"}"
  [ -z "$line" ] && continue
  [[ "$line" == "["*"]" ]] && section="${line//[\[\]]/}" && continue
  case "$section" in
    ports)    PORT_NAMES+=("${line%%=*}"); PORT_DEFAULTS+=("${line#*=}") ;;
    moon)     MOON_TASKS+=("$line") ;;
    services) d="${line%%:*}"; c="${line#*:}"
              SVC_DIRS+=("${d%"${d##*[![:space:]]}"}"); SVC_CMDS+=("${c#"${c%%[![:space:]]*}"}") ;;
  esac
done < "$CONFIG"

# ── 포트 해결 (인스턴스 모드: 캐시 우선) ─────────────────
declare -A CACHED=()
if [ -n "${INSTANCE_ID:-}" ]; then
  cache_f="$(cache_file_for "$INSTANCE_ID")"
  if [ -f "$cache_f" ]; then
    while IFS='=' read -r cname cval; do
      [[ "$cname" == _* ]] && continue
      [ -n "$cname" ] && [ -n "$cval" ] && CACHED["$cname"]="$cval"
    done < "$cache_f"
  fi
fi

reserved=""
for i in "${!PORT_NAMES[@]}"; do
  name="${PORT_NAMES[$i]}"
  current="${!name:-}"

  # 인스턴스 모드: 캐시 → 기본값 → resolve 순으로 시도
  if [ -z "$current" ] && [ -n "${INSTANCE_ID:-}" ]; then
    cached="${CACHED[$name]:-}"
    if [ -n "$cached" ] && port_usable "$cached" "$reserved"; then
      current="$cached"
    fi
  fi

  [ -z "$current" ] && current="$("$PORT_CMD" resolve "${PORT_DEFAULTS[$i]}" "$reserved")"
  export "$name=$current"
  reserved="${reserved:+$reserved,}$current"
done
[ "${#PORT_NAMES[@]}" -gt 0 ] && export PORT="${!PORT_NAMES[0]}"

# 인스턴스 모드: 캐시 저장
if [ -n "${INSTANCE_ID:-}" ]; then
  cache_lines=("_PROJECT_DIR=$ROOT_DIR")
  for name in "${PORT_NAMES[@]}"; do cache_lines+=("$name=${!name}"); done
  save_cached_ports "$(cache_file_for "$INSTANCE_ID")" "${cache_lines[@]}"
fi

summary=""
for name in "${PORT_NAMES[@]}"; do summary="${summary:+$summary }$name:${!name}"; done
echo "$PROJECT_NAME | ports => $summary"
[ "${DEV_ALL_DRY_RUN:-0}" = "1" ] && exit 0

# ── 서비스 시작 ──────────────────────────────────────────
declare -a PIDS=()
cleanup() {
  trap '' EXIT INT TERM HUP PIPE
  for pid in "${PIDS[@]}"; do kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup EXIT INT TERM HUP

if [ "${#MOON_TASKS[@]}" -gt 0 ]; then
  MOON_BIN="${MOON_BIN:-$(command -v moon 2>/dev/null || echo "$HOME/.proto/shims/moon")}"
  cd "$ROOT_DIR"
  for task in "${MOON_TASKS[@]}"; do
    echo "$PROJECT_NAME | starting: $task"
    "$MOON_BIN" run "$task" 9>&- 2>&1 | sed -u "s/^/$PROJECT_NAME | $task | /" 9>&- &
    PIDS+=($!)
  done
elif [ "${#SVC_CMDS[@]}" -gt 0 ]; then
  for i in "${!SVC_CMDS[@]}"; do
    echo "$PROJECT_NAME | starting: ${SVC_DIRS[$i]}"
    (cd "$ROOT_DIR/${SVC_DIRS[$i]}" && eval "$(eval echo "${SVC_CMDS[$i]}")") 9>&- 2>&1 \
      | sed -u "s/^/$PROJECT_NAME | ${SVC_DIRS[$i]} | /" 9>&- &
    PIDS+=($!)
  done
else
  echo "error: no [moon] or [services] in .dev-all" >&2; exit 1
fi

# 자식 프로세스 감시
while true; do
  alive=false
  for pid in "${PIDS[@]}"; do kill -0 "$pid" 2>/dev/null && alive=true && break; done
  $alive || break
  sleep 1
done
