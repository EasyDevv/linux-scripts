#!/usr/bin/env bash
# Launch stash, refreshing the AdGuard media proxy credentials first.
#
# The sync is best effort and only runs at stash start, so it costs nothing
# while stash is idle and nothing per job. `sync-media-proxy.ts` reads the
# AdGuard VPN extension's live proxy_config over CDP and rewrites
# `media_proxy_file` only when the password rotated; a stale password makes the
# proxy answer HTTP 407 and every recordplay.biz/playrecord.biz job fails with
# `media route connection failed`.
#
# stash must start even when Chrome, the extension or bun is unavailable, so a
# failed sync is logged and ignored.
#
# Usage: stash-run.sh [stash args...]
# Env:   STASH_BIN   stash binary (default /var/tmp/stash-cargo-target/release/stash)
#        STASH_BUN   bun binary override
#        STASH_RUN_SYNC_TIMEOUT  seconds for the sync (default 25)
#        STASH_RUN_VERBOSE=1     print the sync summary even when unchanged
set -uo pipefail

here="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
bin="${STASH_BIN:-/var/tmp/stash-cargo-target/release/stash}"
sync_script="$here/sync-media-proxy.ts"
timeout_secs="${STASH_RUN_SYNC_TIMEOUT:-25}"

bun_bin="${STASH_BUN:-}"
if [[ -z "$bun_bin" ]]; then
	if command -v bun >/dev/null 2>&1; then
		bun_bin="$(command -v bun)"
	elif [[ -x "$HOME/.bun/bin/bun" ]]; then
		bun_bin="$HOME/.bun/bin/bun"
	fi
fi

if [[ -f "$sync_script" && -n "$bun_bin" && -x "$bun_bin" ]]; then
	sync_args=(--quiet)
	[[ "${STASH_RUN_VERBOSE:-}" == "1" ]] && sync_args=()
	if ! timeout "$timeout_secs" "$bun_bin" "$sync_script" "${sync_args[@]}"; then
		echo "stash-run: media proxy sync skipped (exit $?)" >&2
	fi
fi

exec "$bin" "$@"
