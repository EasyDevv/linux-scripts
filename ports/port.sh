#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  port kill [--yes] <port> [port...]
  port resolve <preferred_port> [reserved_csv]
  port help

Subcommands:
  kill      Stop processes bound to one or more TCP ports.
  resolve   Print a free TCP port, preferring the requested port first.
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
  (( port >= 1 && port <= 65535 )) || die "Port must be in the range 1-65535: $port"
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || die "Required command not found: $command_name"
}

list_port_pids() {
  local port="$1"
  lsof -ti :"$port" 2>/dev/null | awk 'NF' | sort -u
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

cmd_kill() {
  local assume_yes=0
  local current=""
  local -a raw_ports=()
  local -a ports=()
  local -a active_ports=()
  local -a pid_list=()
  local -a remaining=()
  local -a busy_ports=()
  local confirm=""
  local pids=""
  local port=""
  local pid=""

  while (($#)); do
    current="$1"
    shift

    case "$current" in
      -y|--yes)
        assume_yes=1
        ;;
      -h|--help)
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

  if [ "${#raw_ports[@]}" -eq 0 ]; then
    kill_usage >&2
    return 1
  fi

  require_command "lsof"

  declare -A seen_ports=()
  declare -A seen_pids=()

  for port in "${raw_ports[@]}"; do
    validate_port "$port"
    if [ -z "${seen_ports[$port]+x}" ]; then
      seen_ports[$port]=1
      ports+=("$port")
    fi
  done

  for port in "${ports[@]}"; do
    pids="$(list_port_pids "$port")"
    if [ -n "$pids" ]; then
      active_ports+=("$port")
      while IFS= read -r pid; do
        [ -n "$pid" ] || continue
        seen_pids[$pid]=1
      done <<< "$pids"
    fi
  done

  if [ "${#active_ports[@]}" -eq 0 ]; then
    echo "No processes found on requested ports: ${ports[*]}"
    return 0
  fi

  echo "Processes using the requested ports:"
  for port in "${active_ports[@]}"; do
    echo
    echo "[$port]"
    show_port_usage "$port"
  done

  if [ "$assume_yes" -ne 1 ]; then
    if [ ! -t 0 ]; then
      die "Confirmation required in non-interactive mode. Re-run with --yes."
    fi

    printf "\nKill the processes above? [y/N]: "
    read -r confirm
    case "$confirm" in
      [yY]|[yY][eE][sS])
        ;;
      *)
        echo "Cancelled."
        return 0
        ;;
    esac
  fi

  mapfile -t pid_list < <(printf '%s\n' "${!seen_pids[@]}" | sort -n)

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

  if [ "${#remaining[@]}" -gt 0 ]; then
    echo "Some processes are still running. Sending SIGKILL..."
    for pid in "${remaining[@]}"; do
      send_signal_if_running "KILL" "$pid"
    done
    sleep 1
  fi

  for port in "${active_ports[@]}"; do
    if lsof -ti :"$port" >/dev/null 2>&1; then
      busy_ports+=("$port")
    fi
  done

  if [ "${#busy_ports[@]}" -eq 0 ]; then
    echo "Cleared ports: ${active_ports[*]}"
    return 0
  fi

  echo "Failed to clear ports: ${busy_ports[*]}" >&2
  return 1
}

declare -a RESERVED_PORTS=()

parse_reserved_csv() {
  local csv="$1"
  local item=""

  RESERVED_PORTS=()
  [ -n "$csv" ] || return 0

  declare -A seen_reserved=()
  IFS=',' read -r -a raw_reserved <<< "$csv"
  for item in "${raw_reserved[@]}"; do
    [ -n "$item" ] || continue
    validate_port "$item"
    if [ -z "${seen_reserved[$item]+x}" ]; then
      seen_reserved[$item]=1
      RESERVED_PORTS+=("$item")
    fi
  done
}

is_reserved() {
  local candidate="$1"
  local reserved=""

  for reserved in "${RESERVED_PORTS[@]}"; do
    if [ "$reserved" = "$candidate" ]; then
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

  if [ "$#" -eq 0 ] || [ "$#" -gt 2 ]; then
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

main() {
  local subcommand="${1-}"

  case "$subcommand" in
    ""|help|-h|--help)
      usage
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
