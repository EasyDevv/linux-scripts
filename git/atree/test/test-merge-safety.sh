#!/usr/bin/env bash
set -euo pipefail

ROOT=/home/easydev/dev/sandbox/sandbox-01
cd "$ROOT"

echo "=== Safety: baseline file ==="
echo "baseline" >shared.txt
git add shared.txt && git commit -m "baseline" -q

atree new --no-prompt 1 2>&1 | grep -q "✓ Created" || { echo "FAIL: create 1"; exit 1; }
atree new --no-prompt 2 2>&1 | grep -q "✓ Created" || { echo "FAIL: create 2"; exit 1; }

echo "slot 1" >.worktree/1/shared.txt && git -C .worktree/1 commit -am "s1" -q
echo "slot 2" >.worktree/2/shared.txt && git -C .worktree/2 commit -am "s2" -q

echo "=== Safety: main dirty + auto-stash ==="
echo "notes" >notes.tmp
out=$(atree merge 1 2>&1)
echo "$out" | grep -q "auto-stashing" || { echo "FAIL: no auto-stash"; exit 1; }
echo "$out" | grep -q "✓ Merged" || { echo "FAIL: merge 1"; exit 1; }
echo "$out" | grep -q "✓ Stash restored" || { echo "FAIL: stash not restored"; exit 1; }
[ -f notes.tmp ] || { echo "FAIL: notes.tmp lost"; exit 1; }
echo "PASS: merge 1 with auto-stash"

echo "=== Safety: conflict + stash preservation ==="
out=$(atree merge 2 2>&1 || true)
echo "$out" | grep -q "Conflict detected" || { echo "FAIL: no conflict on merge 2"; exit 1; }

grep -q "<<<<<<< HEAD" shared.txt || { echo "FAIL: missing conflict markers"; exit 1; }
echo "PASS: conflict markers present"

git stash list | grep -q "atree-autostash" || { echo "FAIL: stash not preserved"; exit 1; }
echo "PASS: stash preserved"

locks=$(cat .worktree/sessions.json 2>/dev/null || echo '{"locks":{}}')
echo "$locks" | grep -q '"locks": {}' || { echo "FAIL: lock not released"; exit 1; }
echo "PASS: lock released"

echo "=== Merge safety DONE ==="
