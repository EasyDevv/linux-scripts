#!/usr/bin/env bash
set -euo pipefail

ROOT=/home/easydev/dev/sandbox/sandbox-01
cd "$ROOT"

echo "=== Options: --rm-src ==="
atree new --no-prompt --branch feat/rm-src 1 2>&1 | grep -q "✓ Created" || { echo "FAIL: create 1"; exit 1; }
echo "throwaway" >.worktree/1/x.ts && git -C .worktree/1 add x.ts && git -C .worktree/1 commit -m "x" -q

atree merge 1 --rm-src 2>&1 | grep -q "✓ Branch feat/rm-src deleted" || { echo "FAIL: branch not deleted"; exit 1; }
[ ! -f .worktree/1/x.ts ] && [ ! -d .worktree/1 ] || { echo "FAIL: worktree still exists"; exit 1; }
if git branch | grep -q "feat/rm-src"; then echo "FAIL: branch still exists"; exit 1; fi
echo "PASS: --rm-src (worktree+branch removed)"

echo "=== Options: --rst-src ==="
atree new --no-prompt --branch feat/rst-src 2 2>&1 | grep -q "✓ Created" || { echo "FAIL: create 2"; exit 1; }
echo "keep" >.worktree/2/y.ts && git -C .worktree/2 add y.ts && git -C .worktree/2 commit -m "y" -q

main_head=$(git rev-parse HEAD)
atree merge 2 --rst-src 2>&1 | grep -q "✓ Slot synced to main" || { echo "FAIL: slot not reset"; exit 1; }
[ -d .worktree/2 ] || { echo "FAIL: worktree should remain"; exit 1; }
slot_head=$(git -C .worktree/2 rev-parse HEAD)
[ "$slot_head" = "$(git rev-parse HEAD)" ] || { echo "FAIL: slot does not match main"; exit 1; }
echo "PASS: --rst-src (worktree preserved, slot HEAD = main HEAD)"

echo "=== Merge options DONE ==="
