#!/usr/bin/env bash
set -euo pipefail

script_dir=$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")
bin="$script_dir/target/release/executor"
if [[ ! -x $bin ]]; then
	echo "executor: missing $bin (run cargo build --release)" >&2
	exit 1
fi
exec "$bin" "$@"
