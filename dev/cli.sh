#!/usr/bin/env bash
set -euo pipefail

readonly project_dir="${HOME}/.local/share/scripts/dev/cli"
readonly binary="${project_dir}/bin/cli"

go build -C "$project_dir" -o bin/cli .
export CLI_ROOT="$project_dir"
exec "$binary" "$@"
