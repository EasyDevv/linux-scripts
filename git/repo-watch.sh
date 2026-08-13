#!/usr/bin/env bash
set -euo pipefail

readonly project_dir="/home/easydev/dev/repo-watch"
readonly binary="$project_dir/target/release/repo-watch"

cargo build --quiet --release --manifest-path "$project_dir/Cargo.toml"
exec "$binary" "$@"
