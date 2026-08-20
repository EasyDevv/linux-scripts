#!/usr/bin/env bash
# Compatibility entry for init-vps. New runs should call init-vps.
set -Eeuo pipefail
script_dir=$(dirname "$(readlink -f "$0")")
exec python3 "$script_dir/init-vps.py" "$@"
