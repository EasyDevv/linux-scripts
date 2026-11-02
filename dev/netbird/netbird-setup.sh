#!/usr/bin/env bash
set -euo pipefail

readonly project_dir="${HOME}/.local/share/scripts/dev/netbird/go"
readonly binary="${project_dir}/bin/netbird-setup"

go build -C "$project_dir" -o bin/netbird-setup .
export NETBIRD_SETUP_ROOT="${HOME}/.local/share/scripts/dev/netbird"
exec "$binary" "$@"
