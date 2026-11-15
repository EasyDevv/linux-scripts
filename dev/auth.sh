#!/usr/bin/env bash
set -euo pipefail

readonly project_dir="${HOME}/.local/share/scripts/dev/auth"

go build -C "$project_dir" -o bin/auth .
exec "${project_dir}/bin/auth" "$@"
