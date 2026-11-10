#!/usr/bin/env bash
set -euo pipefail

readonly project_dir="${HOME}/.local/share/scripts/dev/pk"

go build -C "$project_dir" -o bin/pk .
exec "${project_dir}/bin/pk" "$@"
