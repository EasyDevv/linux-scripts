#!/usr/bin/env bash

set -euo pipefail

SERVICE_PREFIX="executor@"
UNIT_TEMPLATE_PATH="$HOME/.config/systemd/user/executor@.service"
CONFIG_PATH="$HOME/.config/systemd/user/executor.json"
DEFAULT_LOG_LINES=50

usage() {
  cat <<EOF
Usage:
  server start [--dry-run] <instance>
  server stop [--dry-run] <instance>
  server restart [--dry-run] <instance>
  server status [--dry-run] <instance>
  server logs [--lines <count>] [--since <expr>] [--dry-run] <instance>
  server watch [--lines <count>] [--since <expr>] [--dry-run] <instance>
  server list
  server help [command]

Notes:
  - Targets executor@<instance> user services.

Examples:
  server restart realestate
  server logs sns-publisher --lines 100
  server watch sns-publisher --since "10 minutes ago"
  server list
EOF
}

usage_lifecycle() {
  local action="$1"
  cat <<EOF
Usage: server $action [--dry-run] <instance>

Options:
  --dry-run   Print the commands without executing them
EOF
}

usage_status() {
  cat <<'EOF'
Usage: server status [--dry-run] <instance>

Options:
  --dry-run   Print the command without executing it
EOF
}

usage_logs() {
  cat <<'EOF'
Usage: server logs [--lines <count>] [--since <expr>] [--dry-run] <instance>

Options:
  --lines <n>    Number of recent lines to show when --since is not set (default: 50)
  --since <expr> Pass a journalctl --since expression such as "10 minutes ago"
  --dry-run      Print the command without executing it
EOF
}

usage_watch() {
  cat <<'EOF'
Usage: server watch [--lines <count>] [--since <expr>] [--dry-run] <instance>

Options:
  --lines <n>    Number of recent lines to show before following (default: 50)
  --since <expr> Pass a journalctl --since expression such as "10 minutes ago"
  --dry-run      Print the command without executing it
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

print_command() {
  printf '+'
  for arg in "$@"; do
    printf ' %q' "$arg"
  done
  printf '\n'
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || die "required command not found: $command_name"
}

validate_positive_integer() {
  local value="$1"
  [[ "$value" =~ ^[0-9]+$ ]] || die "expected a positive integer, got: $value"
  (( value > 0 )) || die "expected a positive integer, got: $value"
}

normalize_instance() {
  local raw="$1"
  raw="${raw#${SERVICE_PREFIX}}"
  raw="${raw%.service}"
  [ -n "$raw" ] || die "instance is required"
  printf '%s\n' "$raw"
}

unit_for_instance() {
  local instance="$1"
  printf '%s%s\n' "$SERVICE_PREFIX" "$instance"
}

ensure_base_layout() {
  require_command jq
  [ -f "$UNIT_TEMPLATE_PATH" ] || die "unit template not found: $UNIT_TEMPLATE_PATH"
  [ -f "$CONFIG_PATH" ] || die "config file not found: $CONFIG_PATH"
}

config_has_instance() {
  local instance="$1"
  jq -e --arg instance "$instance" 'has($instance)' "$CONFIG_PATH" >/dev/null
}

list_instances() {
  jq -r 'keys[]' "$CONFIG_PATH"
}

ensure_instance_layout() {
  local instance="$1"
  ensure_base_layout
  config_has_instance "$instance" || die "instance not found in config: $instance ($CONFIG_PATH)"
}

print_context() {
  local instance="$1"
  local unit="$2"
  local config_path="$3"

  echo "# instance: $instance"
  echo "# unit: $unit"
  echo "# config: $config_path"
}

lifecycle_dry_run=0
lifecycle_instance=""

parse_lifecycle_args() {
  local action="$1"
  shift

  lifecycle_dry_run=0
  lifecycle_instance=""

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dry-run)
        lifecycle_dry_run=1
        shift
        ;;
      -h|--help)
        usage_lifecycle "$action"
        exit 0
        ;;
      --)
        shift
        break
        ;;
      -*)
        die "unknown option for server $action: $1"
        ;;
      *)
        if [ -n "$lifecycle_instance" ]; then
          die "expected exactly one instance for server $action"
        fi
        lifecycle_instance="$1"
        shift
        ;;
    esac
  done

  if [ -z "$lifecycle_instance" ] && [ "$#" -gt 0 ]; then
    lifecycle_instance="$1"
    shift
  fi

  [ -n "$lifecycle_instance" ] || {
    usage_lifecycle "$action" >&2
    exit 1
  }

  [ "$#" -eq 0 ] || die "unexpected arguments for server $action: $*"
}

journal_dry_run=0
journal_lines="$DEFAULT_LOG_LINES"
journal_since=""
journal_instance=""
journal_cmd=()

parse_journal_args() {
  local action="$1"
  shift

  journal_dry_run=0
  journal_lines="$DEFAULT_LOG_LINES"
  journal_since=""
  journal_instance=""

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --lines|-n)
        [ "$#" -ge 2 ] || die "--lines requires a value"
        journal_lines="$2"
        validate_positive_integer "$journal_lines"
        shift 2
        ;;
      --since)
        [ "$#" -ge 2 ] || die "--since requires a value"
        journal_since="$2"
        shift 2
        ;;
      --dry-run)
        journal_dry_run=1
        shift
        ;;
      -h|--help)
        case "$action" in
          logs)
            usage_logs
            ;;
          watch)
            usage_watch
            ;;
          *)
            die "unknown journal action: $action"
            ;;
        esac
        exit 0
        ;;
      --)
        shift
        break
        ;;
      -*)
        die "unknown option for server $action: $1"
        ;;
      *)
        if [ -n "$journal_instance" ]; then
          die "expected exactly one instance for server $action"
        fi
        journal_instance="$1"
        shift
        ;;
    esac
  done

  if [ -z "$journal_instance" ] && [ "$#" -gt 0 ]; then
    journal_instance="$1"
    shift
  fi

  [ -n "$journal_instance" ] || {
    case "$action" in
      logs)
        usage_logs >&2
        ;;
      watch)
        usage_watch >&2
        ;;
      *)
        die "unknown journal action: $action"
        ;;
    esac
    exit 1
  }

  [ "$#" -eq 0 ] || die "unexpected arguments for server $action: $*"
}

build_journal_command() {
  local unit="$1"
  local follow="$2"

  journal_cmd=(journalctl --user --no-pager -u "$unit" -o cat)

  if [ -n "$journal_since" ]; then
    journal_cmd+=(--since "$journal_since")
  else
    journal_cmd+=(-n "$journal_lines")
  fi

  if [ "$follow" -eq 1 ]; then
    journal_cmd+=(-f)
  fi
}

cmd_lifecycle() {
  local action="$1"
  shift

  require_command systemctl
  parse_lifecycle_args "$action" "$@"

  local instance
  instance="$(normalize_instance "$lifecycle_instance")"
  ensure_instance_layout "$instance"

  local unit
  unit="$(unit_for_instance "$instance")"
  local lifecycle_cmd=(systemctl --user "$action" "$unit")

  print_context "$instance" "$unit" "$CONFIG_PATH"
  print_command "${lifecycle_cmd[@]}"

  if [ "$lifecycle_dry_run" -eq 1 ]; then
    return 0
  fi

  "${lifecycle_cmd[@]}"
}

cmd_status() {
  require_command systemctl
  parse_status_args "$@"

  local instance
  instance="$(normalize_instance "$status_instance")"
  ensure_instance_layout "$instance"

  local unit
  unit="$(unit_for_instance "$instance")"
  local status_cmd=(systemctl --user --no-pager --full status "$unit")

  print_context "$instance" "$unit" "$CONFIG_PATH"
  print_command "${status_cmd[@]}"

  if [ "$status_dry_run" -eq 1 ]; then
    return 0
  fi

  "${status_cmd[@]}"
}

cmd_logs() {
  require_command journalctl
  parse_journal_args logs "$@"

  local instance
  instance="$(normalize_instance "$journal_instance")"
  ensure_instance_layout "$instance"

  local unit
  unit="$(unit_for_instance "$instance")"
  build_journal_command "$unit" 0

  print_context "$instance" "$unit" "$CONFIG_PATH"
  print_command "${journal_cmd[@]}"

  if [ "$journal_dry_run" -eq 1 ]; then
    return 0
  fi

  "${journal_cmd[@]}"
}

cmd_watch() {
  require_command journalctl
  parse_journal_args watch "$@"

  local instance
  instance="$(normalize_instance "$journal_instance")"
  ensure_instance_layout "$instance"

  local unit
  unit="$(unit_for_instance "$instance")"
  build_journal_command "$unit" 1

  print_context "$instance" "$unit" "$CONFIG_PATH"
  print_command "${journal_cmd[@]}"

  if [ "$journal_dry_run" -eq 1 ]; then
    return 0
  fi

  exec "${journal_cmd[@]}"
}

cmd_list() {
  require_command systemctl
  ensure_base_layout

  local instance=""
  local unit=""
  local active_state=""
  local enabled_state=""

  mapfile -t instances < <(list_instances)

  if [ "${#instances[@]}" -eq 0 ]; then
    echo "No executor instances found in $CONFIG_PATH"
    return 0
  fi

  echo "# config: $CONFIG_PATH"
  printf '%-20s %-12s %-12s\n' "INSTANCE" "ACTIVE" "ENABLED"
  for instance in "${instances[@]}"; do
    unit="$(unit_for_instance "$instance")"
    active_state="$(systemctl --user is-active "$unit" 2>/dev/null || true)"
    enabled_state="$(systemctl --user is-enabled "$unit" 2>/dev/null || true)"
    [ -n "$active_state" ] || active_state="unknown"
    [ -n "$enabled_state" ] || enabled_state="unknown"
    printf '%-20s %-12s %-12s\n' "$instance" "$active_state" "$enabled_state"
  done
}

cmd_help() {
  local topic="${1-}"
  case "$topic" in
    ""|-h|--help)
      usage
      ;;
    start|stop|restart)
      usage_lifecycle "$topic"
      ;;
    status)
      usage_status
      ;;
    logs)
      usage_logs
      ;;
    watch)
      usage_watch
      ;;
    list)
      echo "Usage: server list"
      ;;
    *)
      die "unknown help topic: $topic"
      ;;
  esac
}

main() {
  local subcommand="${1-}"

  case "$subcommand" in
    ""|-h|--help)
      usage
      ;;
    help)
      shift
      cmd_help "$@"
      ;;
    start|stop|restart)
      shift
      cmd_lifecycle "$subcommand" "$@"
      ;;
    status)
      shift
      cmd_status "$@"
      ;;
    logs)
      shift
      cmd_logs "$@"
      ;;
    watch)
      shift
      cmd_watch "$@"
      ;;
    list)
      shift
      [ "$#" -eq 0 ] || die "server list does not take arguments"
      cmd_list
      ;;
    *)
      die "unknown subcommand: $subcommand"
      ;;
  esac
}

status_dry_run=0
status_instance=""

parse_status_args() {
  status_dry_run=0
  status_instance=""

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dry-run)
        status_dry_run=1
        shift
        ;;
      -h|--help)
        usage_status
        exit 0
        ;;
      --)
        shift
        break
        ;;
      -*)
        die "unknown option for server status: $1"
        ;;
      *)
        if [ -n "$status_instance" ]; then
          die "expected exactly one instance for server status"
        fi
        status_instance="$1"
        shift
        ;;
    esac
  done

  if [ -z "$status_instance" ] && [ "$#" -gt 0 ]; then
    status_instance="$1"
    shift
  fi

  [ -n "$status_instance" ] || {
    usage_status >&2
    exit 1
  }

  [ "$#" -eq 0 ] || die "unexpected arguments for server status: $*"
}

main "$@"
