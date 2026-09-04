#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT_BIN="$ROOT/port.sh"
fail() { echo "FAIL: $*" >&2; exit 1; }

[[ -x "$PORT_BIN" ]] || chmod +x "$PORT_BIN"

help_out="$("$PORT_BIN" help)"
[[ "$help_out" == *"port sweep"* ]] || fail "help should mention sweep"
[[ "$help_out" == *"port status"* ]] || fail "help should mention status"

resolved="$("$PORT_BIN" resolve 55111)"
[[ "$resolved" =~ ^[0-9]+$ ]] || fail "resolve should print a port"
((resolved >= 55111 && resolved <= 65535)) || fail "resolve should prefer 55111 or the next free port"

kill_out="$("$PORT_BIN" kill --yes 59999)"
[[ "$kill_out" == *"No processes found"* ]] || fail "kill on unused port should be a no-op"

"$PORT_BIN" status >/tmp/port-status.out
[[ -s /tmp/port-status.out ]] || fail "status should print a table"
grep -q '^PORT ' /tmp/port-status.out || fail "status should have a header"

sweep_out="$("$PORT_BIN" sweep </dev/null)"
[[ "$sweep_out" == *"No leftover dev servers."* || "$sweep_out" == *$'
4321'* || "$sweep_out" == *"orphan"* ]] || fail "sweep plan should classify or report none"
[[ "$sweep_out" == *"SIGTERM"* ]] && fail "sweep without --yes must not send SIGTERM"
[[ "$sweep_out" == *"Plan only."* || "$sweep_out" == *"No leftover dev servers."* ]] || fail "non-TTY sweep must stay plan-only"

echo "OK"
