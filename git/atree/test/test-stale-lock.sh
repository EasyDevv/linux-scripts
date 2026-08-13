#!/usr/bin/env bash
set -euo pipefail

ROOT=/home/easydev/dev/sandbox/sandbox-01
cd "$ROOT"

echo "=== Stale lock: inject dead PID ==="
mkdir -p .worktree/1
cat >.worktree/sessions.json <<'JSON'
{
  "version": 1,
  "locks": {
    "1": {
      "pid": 999999,
      "command": "merge",
      "branch": "stale/branch",
      "startedAt": "2026-06-28T13:00:00+09:00"
    }
  }
}
JSON

echo "=== Stale lock: atree status (cleans stale) ==="
atree status 2>&1

locks=$(cat .worktree/sessions.json 2>/dev/null || echo '{"locks":{}}')
echo "$locks" | grep -q '"locks": {}' || { echo "FAIL: stale lock not cleaned"; exit 1; }
echo "PASS: stale lock auto-cleaned"

echo "=== Stale lock DONE ==="
