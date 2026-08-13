#!/usr/bin/env bash
set -euo pipefail

cd /home/easydev/dev/sandbox/sandbox-01

echo "=== Lifecycle: create 3 worktrees ==="
atree new --no-prompt --branch feat/life-a 1 2>&1 | grep -q "✓ Created" || { echo "FAIL: create 1"; exit 1; }
atree new --no-prompt --branch feat/life-b 2 2>&1 | grep -q "✓ Created" || { echo "FAIL: create 2"; exit 1; }
atree new --no-prompt --branch feat/life-c 3 2>&1 | grep -q "✓ Created" || { echo "FAIL: create 3"; exit 1; }

echo "=== Lifecycle: commit in each ==="
echo "a" >.worktree/1/a.ts && git -C .worktree/1 add a.ts && git -C .worktree/1 commit -m "feat a" -q
echo "b" >.worktree/2/b.ts && git -C .worktree/2 add b.ts && git -C .worktree/2 commit -m "feat b" -q
echo "c" >.worktree/3/c.ts && git -C .worktree/3 add c.ts && git -C .worktree/3 commit -m "feat c" -q

echo "=== Lifecycle: diff ==="
diff_out=$(atree diff 2>&1)
rows=$(echo "$diff_out" | grep -cE '^[0-9]')
[ "$rows" -eq 3 ] || { echo "FAIL: expected 3 diff rows, got $rows"; exit 1; }
echo "PASS: diff shows 3 slots"

echo "=== Lifecycle: merge all ==="
echo "$diff_out" | grep -q "feat/life" || { echo "FAIL: branch names missing in diff"; exit 1; }

atree merge 3 2>&1 | grep -q "✓ Merged" || { echo "FAIL: merge 3"; exit 1; }
atree merge 2 2>&1 | grep -q "✓ Merged" || { echo "FAIL: merge 2"; exit 1; }
atree merge 1 2>&1 | grep -q "✓ Merged" || { echo "FAIL: merge 1"; exit 1; }

merge_count=$(git log --oneline | grep -c "Merge branch")
[ "$merge_count" -ge 3 ] || { echo "FAIL: expected 3 merge commits, got $merge_count"; exit 1; }
echo "PASS: all 3 merged (total $merge_count)"

echo "=== Lifecycle DONE ==="
