#!/usr/bin/env bash
set -euo pipefail

readonly project_dir="${HOME}/.local/share/scripts/git/ship"
readonly binary="${project_dir}/bin/ship"

go build -C "$project_dir" -o bin/ship .
export SHIP_ROOT="$project_dir"
exec "$binary" "$@"
