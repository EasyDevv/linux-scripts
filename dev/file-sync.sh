#!/usr/bin/env bash
set -euo pipefail

readonly project_dir="/home/easydev/dev/public/file-sync"
readonly binary="$project_dir/target/release/file-sync"

cargo build --quiet --release --manifest-path "$project_dir/Cargo.toml"
exec "$binary" "$@"
