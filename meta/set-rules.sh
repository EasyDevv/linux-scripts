#!/usr/bin/env bash
set -euo pipefail

readonly project_dir="${HOME}/.local/share/scripts/meta/set-rules"
readonly binary="${project_dir}/bin/set-rules"

go build -C "$project_dir" -o bin/set-rules .
export SET_RULES_ROOT="$project_dir"
exec "$binary" "$@"
