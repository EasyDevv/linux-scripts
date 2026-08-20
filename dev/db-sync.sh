#!/usr/bin/env bash
set -euo pipefail

readonly project_dir="${HOME}/.local/share/scripts/dev/db-sync"
readonly binary="${project_dir}/target/release/db-sync"

cargo build --quiet --release --manifest-path "$project_dir/Cargo.toml"
exec "$binary" "$@"
