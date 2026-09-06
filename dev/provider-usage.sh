#!/usr/bin/env bash
set -euo pipefail

readonly project_dir="${HOME}/.local/share/scripts/dev/provider-usage"
readonly binary="${project_dir}/target/release/provider-usage"

if [[ ! -x "$binary" ]] || find "$project_dir/src" "$project_dir/Cargo.toml" -newer "$binary" -print -quit | grep -q .; then
	cargo build --quiet --release --manifest-path "$project_dir/Cargo.toml"
fi
exec "$binary" "$@"
