#!/usr/bin/env bash
# Build-on-demand wrapper for the usage-stats Rust CLI.
set -euo pipefail

dir="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
bin="$dir/target/release/usage-stats"

if [[ ! -x "$bin" ]] || [[ -n "$(find "$dir/src" "$dir/Cargo.toml" -newer "$bin" -print -quit)" ]]; then
  cargo build --release --quiet --manifest-path "$dir/Cargo.toml"
fi

exec "$bin" "$@"
