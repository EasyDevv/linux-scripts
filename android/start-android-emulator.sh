#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$HOME/.local/share/scripts/dev/wxt"
exec node "$SCRIPT_ROOT/android-emu.mjs" "$@"
