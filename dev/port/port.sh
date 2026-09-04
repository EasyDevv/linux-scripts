#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  port status
  port sweep [--yes]
  port kill [--yes] <port> [port...]
  port resolve <preferred_port> [reserved_csv]
  port help

Subcommands:
  status    Classify this user's TCP listeners (managed/active/orphan/keep).
  sweep     Plan leftover dev-server orphans; kill them only with --yes.
  kill      Stop processes bound to one or more TCP ports.
  resolve   Print a free TCP port, preferring the requested port first.
EOF
}

status_usage() {
  cat <<'EOF'
Usage: port status

Print this user's TCP LISTEN sockets with class, pid, unit, and cwd.
Classes:
  managed  executor.service / executor.json dir / dev-all holder
  active   live agent ancestor or live app-<agent>-<pid>.scope leader
  orphan   leftover dev server (sweep target)
  keep     everything else (browsers, daemons, interactive ttys)
EOF
}

sweep_usage() {
  cat <<'EOF'
Usage: port sweep [--yes]

Options:
  -y, --yes   Kill classified orphans. Default is plan-only.

Non-TTY without --yes prints the plan and exits 0.
EOF
}

kill_usage() {
  cat <<'EOF'
Usage: port kill [--yes] <port> [port...]

Options:
  -y, --yes   Skip the confirmation prompt.
EOF
}

resolve_usage() {
  cat <<'EOF'
Usage: port resolve <preferred_port> [reserved_csv]
EOF
}

die() {
  echo "Error: $*" >&2
  exit 1
}

validate_port() {
  local port="${1-}"

  [[ -n "$port" ]] || die "Port is required."
  [[ "$port" =~ ^[0-9]+$ ]] || die "Invalid port: $port"
  ((port >= 1 && port <= 65535)) || die "Port must be in the range 1-65535: $port"
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || die "Required command not found: $command_name"
}

color_enabled() {
  [[ -t 1 && -z "${NO_COLOR:-}" ]]
}

paint() {
  local text="$1"
  local code="${2-}"
  if color_enabled && [[ -n "$code" ]]; then
    printf '\033[%sm%s\033[0m' "$code" "$text"
  else
    printf '%s' "$text"
  fi
}

class_color() {
  case "$1" in
    managed) printf '36' ;;
    active) printf '32' ;;
    orphan) printf '31' ;;
    keep) printf '2' ;;
    *) printf '' ;;
  esac
}

list_port_pids() {
  local port="$1"
  local out=""
  out="$(lsof -ti :"$port" 2>/dev/null || true)"
  awk 'NF' <<<"$out" | sort -u
}

show_port_usage() {
  local port="$1"
  lsof -i :"$port" 2>/dev/null || true
}

send_signal_if_running() {
  local signal="$1"
  local pid="$2"

  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  echo "SIG${signal} -> PID $pid"
  if kill "-$signal" "$pid" 2>/dev/null; then
    return 0
  fi

  if kill -0 "$pid" 2>/dev/null; then
    echo "Failed to send SIG${signal} to PID $pid." >&2
    return 1
  fi

  return 0
}

term_then_kill_pids() {
  local -a pid_list=("$@")
  local -a remaining=()
  local pid=""

  ((${#pid_list[@]} > 0)) || return 0

  echo
  echo "Sending SIGTERM to matching processes..."
  for pid in "${pid_list[@]}"; do
    send_signal_if_running "TERM" "$pid"
  done

  sleep 2

  for pid in "${pid_list[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      remaining+=("$pid")
    fi
  done

  if ((${#remaining[@]} > 0)); then
    echo "Some processes are still running. Sending SIGKILL..."
    for pid in "${remaining[@]}"; do
      send_signal_if_running "KILL" "$pid"
    done
    sleep 1
  fi
}

verify_ports_cleared() {
  local -a ports=("$@")
  local -a busy_ports=()
  local port=""

  for port in "${ports[@]}"; do
    if lsof -ti :"$port" >/dev/null 2>&1; then
      busy_ports+=("$port")
    fi
  done

  if ((${#busy_ports[@]} == 0)); then
    echo "Cleared ports: ${ports[*]}"
    return 0
  fi

  echo "Failed to clear ports: ${busy_ports[*]}" >&2
  return 1
}

confirm_kill() {
  local assume_yes="$1"
  local confirm=""

  if [[ "$assume_yes" -eq 1 ]]; then
    return 0
  fi

  if [[ ! -t 0 ]]; then
    die "Confirmation required in non-interactive mode. Re-run with --yes."
  fi

  printf "\nKill the processes above? [y/N]: "
  read -r confirm
  case "$confirm" in
    [yY] | [yY][eE][sS]) return 0 ;;
    *)
      echo "Cancelled."
      return 1
      ;;
  esac
}

cmd_kill() {
  local assume_yes=0
  local current=""
  local -a raw_ports=()
  local -a ports=()
  local -a active_ports=()
  local -a pid_list=()
  local pids=""
  local port=""
  local pid=""

  while (($#)); do
    current="$1"
    shift

    case "$current" in
      -y | --yes)
        assume_yes=1
        ;;
      -h | --help)
        kill_usage
        return 0
        ;;
      --)
        raw_ports+=("$@")
        break
        ;;
      -*)
        die "Unknown option for 'port kill': $current"
        ;;
      *)
        raw_ports+=("$current")
        ;;
    esac
  done

  if ((${#raw_ports[@]} == 0)); then
    kill_usage >&2
    return 1
  fi

  require_command "lsof"

  declare -A seen_ports=()
  declare -A seen_pids=()

  for port in "${raw_ports[@]}"; do
    validate_port "$port"
    if [[ -z "${seen_ports[$port]+x}" ]]; then
      seen_ports[$port]=1
      ports+=("$port")
    fi
  done

  for port in "${ports[@]}"; do
    pids="$(list_port_pids "$port")"
    if [[ -n "$pids" ]]; then
      active_ports+=("$port")
      while IFS= read -r pid; do
        [[ -n "$pid" ]] || continue
        seen_pids[$pid]=1
      done <<<"$pids"
    fi
  done

  if ((${#active_ports[@]} == 0)); then
    echo "No processes found on requested ports: ${ports[*]}"
    return 0
  fi

  echo "Processes using the requested ports:"
  for port in "${active_ports[@]}"; do
    echo
    echo "[$port]"
    show_port_usage "$port"
  done

  confirm_kill "$assume_yes" || return 0

  mapfile -t pid_list < <(printf '%s\n' "${!seen_pids[@]}" | sort -n)
  term_then_kill_pids "${pid_list[@]}"
  verify_ports_cleared "${active_ports[@]}"
}

declare -a RESERVED_PORTS=()

parse_reserved_csv() {
  local csv="$1"
  local item=""

  RESERVED_PORTS=()
  [[ -n "$csv" ]] || return 0

  declare -A seen_reserved=()
  IFS=',' read -r -a raw_reserved <<<"$csv"
  for item in "${raw_reserved[@]}"; do
    [[ -n "$item" ]] || continue
    validate_port "$item"
    if [[ -z "${seen_reserved[$item]+x}" ]]; then
      seen_reserved[$item]=1
      RESERVED_PORTS+=("$item")
    fi
  done
}

is_reserved() {
  local candidate="$1"
  local reserved=""

  for reserved in "${RESERVED_PORTS[@]}"; do
    if [[ "$reserved" == "$candidate" ]]; then
      return 0
    fi
  done

  return 1
}

port_free() {
  local candidate="$1"
  ! ss -tlnH "sport = :$candidate" 2>/dev/null | grep -q .
}

cmd_resolve() {
  local preferred="${1-}"
  local reserved_csv="${2-}"
  local candidate=0

  if [[ "$#" -eq 0 || "$#" -gt 2 ]]; then
    resolve_usage >&2
    return 1
  fi

  validate_port "$preferred"
  require_command "ss"
  require_command "shuf"
  parse_reserved_csv "$reserved_csv"

  if ! is_reserved "$preferred" && port_free "$preferred"; then
    echo "$preferred"
    return 0
  fi

  for ((candidate = preferred + 1; candidate <= preferred + 100 && candidate <= 65535; candidate++)); do
    if ! is_reserved "$candidate" && port_free "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done

  while IFS= read -r candidate; do
    if ! is_reserved "$candidate" && port_free "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done < <(shuf -i 49152-65535 -n 128)

  echo "Failed to find a free port" >&2
  return 1
}

local_port_from_addr() {
  local addr="$1"
  printf '%s\n' "${addr##*:}"
}

proc_field() {
  local pid="$1"
  local spec="$2"
  ps -o "$spec=" -p "$pid" 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

proc_alive() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] && ((pid > 1)) && kill -0 "$pid" 2>/dev/null
}

cgroup_unit() {
  local pid="$1"
  local raw=""
  raw="$(awk -F: 'NF{print $NF}' "/proc/$pid/cgroup" 2>/dev/null | tail -n 1)"
  [[ -n "$raw" ]] || return 0
  basename "$raw"
}

proc_cwd() {
  readlink "/proc/$1/cwd" 2>/dev/null || true
}

is_agent_comm() {
  case "$1" in
    pi | orca | orca-ide | claude | gemini | codex | cursor | cursor-agent)
      return 0
      ;;
  esac
  return 1
}

walk_ancestors() {
  local pid="$1"
  local seen=""
  while proc_alive "$pid"; do
    printf '%s\n' "$pid"
    case " $seen " in
      *" $pid "*) break ;;
    esac
    seen+=" $pid"
    pid="$(proc_field "$pid" ppid)"
    [[ "$pid" =~ ^[0-9]+$ ]] || break
    ((pid > 1)) || break
  done
}

has_devall_ancestor() {
  local pid="$1"
  local cur args
  while IFS= read -r cur; do
    args="$(proc_field "$cur" args)"
    if [[ "$args" == *dev-all.sh* ]]; then
      return 0
    fi
  done < <(walk_ancestors "$pid")
  return 1
}

has_live_agent_ancestor() {
  local pid="$1"
  local cur comm args
  while IFS= read -r cur; do
    comm="$(proc_field "$cur" comm)"
    comm="${comm%% *}"
    args="$(proc_field "$cur" args)"
    if is_agent_comm "$comm"; then
      return 0
    fi
    if [[ "$args" == */pi\ * || "$args" == */orca* || "$args" == *orca-ide* ]]; then
      return 0
    fi
  done < <(walk_ancestors "$pid")
  return 1
}

scope_leader_pid() {
  local unit="$1"
  if [[ "$unit" =~ ^app-(orca|pi|claude|gemini|codex|cursor)-([0-9]+)\.scope$ ]]; then
    printf '%s\n' "${BASH_REMATCH[2]}"
  fi
}

has_live_tty() {
  local pid="$1"
  local tty=""
  tty="$(proc_field "$pid" tty)"
  [[ -n "$tty" && "$tty" != "?" ]] || return 1
  [[ -e "/dev/$tty" || -e "/dev/pts/${tty#pts/}" ]]
}

is_dev_server() {
  local comm="$1"
  local args="$2"
  local base="${comm%% *}"

  case "$base" in
    node | node-MainThread | bun | deno | vite | next-server | next | wrangler)
      return 0
      ;;
  esac

  if [[ "$base" == python || "$base" == python3 || "$base" == uv ]]; then
    [[ "$args" == *http.server* || "$args" == *uvicorn* || "$args" == *gunicorn* ||
      "$args" == *hypercorn* || "$args" == *granian* || "$args" == *fastapi* ||
      "$args" == *flask* || "$args" == *"django"* ]] && return 0
  fi

  [[ "$args" == *vite\ * || "$args" == *" next dev"* || "$args" == *webpack* ||
    "$args" == *"astro dev"* || "$args" == *svelte-kit* || "$args" == *"nuxt "* ||
    "$args" == *"cargo run"* ]] && return 0

  return 1
}

classify_pid() {
  local pid="$1"
  local unit="$2"
  local cwd="$3"
  local comm="$4"
  local args="$5"
  local leader=""

  if [[ "$unit" == executor.service || "$unit" == executor@* ]]; then
    printf 'managed\n'
    return 0
  fi
  if has_devall_ancestor "$pid"; then
    printf 'managed\n'
    return 0
  fi
  if has_live_agent_ancestor "$pid"; then
    printf 'active\n'
    return 0
  fi
  leader="$(scope_leader_pid "$unit")"
  if [[ -n "$leader" ]] && proc_alive "$leader"; then
    printf 'active\n'
    return 0
  fi
  if has_live_tty "$pid"; then
    printf 'keep\n'
    return 0
  fi
  if is_dev_server "$comm" "$args"; then
    printf 'orphan\n'
    return 0
  fi
  printf 'keep\n'
}

# Records are tab-separated: port pid comm class unit cwd
collect_listeners() {
  local line addr port pid comm unit cwd args class
  local -A seen=()

  require_command "ss"

  while IFS= read -r line; do
    [[ "$line" == *'users:(('* ]] || continue
    addr="$(awk '{print $4}' <<<"$line")"
    port="$(local_port_from_addr "$addr")"
    [[ "$port" =~ ^[0-9]+$ ]] || continue

    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      proc_alive "$pid" || continue
      [[ -z "${seen[$port:$pid]+x}" ]] || continue
      seen[$port:$pid]=1

      comm="$(proc_field "$pid" comm)"
      comm="${comm:-unknown}"
      args="$(proc_field "$pid" args)"
      unit="$(cgroup_unit "$pid")"
      unit="${unit:-}"
      cwd="$(proc_cwd "$pid")"
      class="$(classify_pid "$pid" "$unit" "$cwd" "$comm" "$args")"
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$port" "$pid" "$comm" "$class" "$unit" "$cwd"
    done < <(grep -oE 'pid=[0-9]+' <<<"$line" | cut -d= -f2 | sort -u)
  done < <(ss -H -tlnp 2>/dev/null)
}

print_listener_table() {
  local filter="${1-}"
  local port pid comm class unit cwd
  local count=0

  printf '%-6s %-8s %-8s %-16s %-28s %s\n' "PORT" "CLASS" "PID" "COMM" "UNIT" "CWD"
  while IFS=$'\t' read -r port pid comm class unit cwd; do
    [[ -n "$port" ]] || continue
    if [[ -n "$filter" && "$class" != "$filter" ]]; then
      continue
    fi
    count=$((count + 1))
    printf '%-6s ' "$port"
    paint "$(printf '%-8s' "$class")" "$(class_color "$class")"
    printf ' %-8s %-16s %-28s %s\n' "$pid" "$comm" "$unit" "$cwd"
  done < <(collect_listeners | sort -n -k1,1 -k2,2)

  if ((count == 0)); then
    if [[ -n "$filter" ]]; then
      echo "No $filter listeners."
    else
      echo "No user TCP listeners."
    fi
  fi
  return 0
}

cmd_status() {
  local current="${1-}"
  case "$current" in
    -h | --help)
      status_usage
      return 0
      ;;
    "")
      print_listener_table
      ;;
    *)
      die "Unknown option for 'port status': $current"
      ;;
  esac
}

cmd_sweep() {
  local assume_yes=0
  local current=""
  local -a pid_list=()
  local -a ports=()
  local port pid comm class unit cwd
  local -A seen_pids=()
  local -A seen_ports=()

  while (($#)); do
    current="$1"
    shift
    case "$current" in
      -y | --yes) assume_yes=1 ;;
      -h | --help)
        sweep_usage
        return 0
        ;;
      -*)
        die "Unknown option for 'port sweep': $current"
        ;;
      *)
        die "Unknown argument for 'port sweep': $current"
        ;;
    esac
  done

  require_command "lsof"

  echo "Leftover dev-server orphans:"
  echo
  printf '%-6s %-8s %-8s %-16s %-28s %s\n' "PORT" "CLASS" "PID" "COMM" "UNIT" "CWD"
  while IFS=$'\t' read -r port pid comm class unit cwd; do
    [[ "$class" == orphan ]] || continue
    ((port >= 1024)) || continue
    seen_pids[$pid]=1
    if [[ -z "${seen_ports[$port]+x}" ]]; then
      seen_ports[$port]=1
      ports+=("$port")
    fi
    printf '%-6s ' "$port"
    paint "$(printf '%-8s' "$class")" "$(class_color "$class")"
    printf ' %-8s %-16s %-28s %s\n' "$pid" "$comm" "$unit" "$cwd"
  done < <(collect_listeners | sort -n -k1,1 -k2,2)

  if ((${#seen_pids[@]} == 0)); then
    echo "No leftover dev servers."
    return 0
  fi

  if [[ "$assume_yes" -ne 1 ]]; then
    if [[ ! -t 0 ]]; then
      echo
      echo "Plan only. Re-run with --yes to kill the orphans above."
      return 0
    fi
    confirm_kill 0 || return 0
  fi

  mapfile -t pid_list < <(printf '%s\n' "${!seen_pids[@]}" | sort -n)
  term_then_kill_pids "${pid_list[@]}"
  verify_ports_cleared "${ports[@]}"
}

main() {
  local subcommand="${1-}"

  case "$subcommand" in
    "" | help | -h | --help)
      usage
      ;;
    status | list)
      shift
      cmd_status "$@"
      ;;
    sweep)
      shift
      cmd_sweep "$@"
      ;;
    kill)
      shift
      cmd_kill "$@"
      ;;
    resolve)
      shift
      cmd_resolve "$@"
      ;;
    *)
      echo "Unknown subcommand: $subcommand" >&2
      usage >&2
      return 1
      ;;
  esac
}

main "$@"
