#!/usr/bin/env bash
# droid wrapper: rebuild bin/droid only when a Go source, go.mod or an embedded dex is newer,
# because a run calls droid hundreds of times (dev/cli.sh builds on every call instead).
set -euo pipefail

readonly project_dir="${HOME}/.local/share/scripts/dev/droid"
readonly binary="${project_dir}/bin/droid"

stale() {
  [[ -x "$binary" ]] || return 0
  [[ -n "$(find "$project_dir" -maxdepth 2 \( -name '*.go' -o -name go.mod -o -name '*.dex' \) \
    -not -name '*_test.go' -newer "$binary" -print -quit)" ]]
}

if stale; then
  go build -C "$project_dir" -o bin/droid . >&2
fi
exec "$binary" "$@"
