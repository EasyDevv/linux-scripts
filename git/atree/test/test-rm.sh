#!/usr/bin/env bash
set -euo pipefail

cd /home/easydev/dev/sandbox/sandbox-01

# Setup
atree new --no-prompt 1
atree new --no-prompt 2
echo "wip" >.worktree/1/wip.txt  # uncommitted in slot 1
echo "ok" >.worktree/2/done.ts && git -C .worktree/2 add done.ts && git -C .worktree/2 commit -m "done" -q
atree merge 2 2>&1 | grep -q "✓ Merged" || { echo "FAIL: setup merge"; exit 1; }

# T1: uncommitted without --force → refuse
out=$(atree rm 1 2>&1 || true)
echo "$out" | grep -q "uncommitted changes" || { echo "FAIL: T1 no refuse message"; exit 1; }
[ -d .worktree/1 ] || { echo "FAIL: T1 slot was deleted"; exit 1; }
echo "PASS: T1 uncommitted refused"

# T2: uncommitted with --force --no-prompt → delete
out=$(atree rm 1 --force --no-prompt 2>&1)
echo "$out" | grep -q "✓ Worktree removed" || { echo "FAIL: T2 no removed msg"; exit 1; }
[ ! -d .worktree/1 ] || { echo "FAIL: T2 slot still exists"; exit 1; }
if git branch | grep -q "atree/1"; then echo "FAIL: T2 branch not deleted"; exit 1; fi
echo "PASS: T2 uncommitted+force deleted"

# T3: unmerged branch without --force → refuse
atree new --no-prompt --branch feat/unmerged 3 2>&1 | grep -q "✓ Created" || { echo "FAIL: create 3"; exit 1; }
echo "x" >.worktree/3/x.ts && git -C .worktree/3 add x.ts && git -C .worktree/3 commit -m "x" -q
out=$(atree rm 3 2>&1 || true)
echo "$out" | grep -q "not merged" || { echo "FAIL: T3 no refuse"; exit 1; }
[ -d .worktree/3 ] || { echo "FAIL: T3 slot was deleted"; exit 1; }
echo "PASS: T3 unmerged branch refused"

# T4: confirm "n" → cancelled, slot preserved
atree merge 3 2>&1 | grep -q "✓ Merged" || { echo "FAIL: T4 merge 3"; exit 1; }
out=$(echo "n" | atree rm 3 2>&1)
echo "$out" | grep -q "Cancelled" || { echo "FAIL: T4 no cancel msg"; exit 1; }
[ -d .worktree/3 ] || { echo "FAIL: T4 slot was deleted"; exit 1; }
echo "PASS: T4 cancel preserved slot"

# T5: confirm "y" → delete, branch gone
out=$(echo "y" | atree rm 3 2>&1)
echo "$out" | grep -q "✓ Worktree removed" || { echo "FAIL: T5 no removed msg"; exit 1; }
echo "$out" | grep -q "Branch feat/unmerged deleted" || { echo "FAIL: T5 no branch deleted msg"; exit 1; }
[ ! -d .worktree/3 ] || { echo "FAIL: T5 slot still exists"; exit 1; }
if git branch | grep -q "feat/unmerged"; then echo "FAIL: T5 branch still exists"; exit 1; fi
echo "PASS: T5 confirm deleted"

# T6: --keep-branch → worktree removed, branch kept
atree new --no-prompt --branch feat/keep-me 4 2>&1 | grep -q "✓ Created" || { echo "FAIL: create 4"; exit 1; }
echo "y" >.worktree/4/y.ts && git -C .worktree/4 add y.ts && git -C .worktree/4 commit -m "y" -q
atree merge 4 2>&1 | grep -q "✓ Merged" || { echo "FAIL: T6 merge 4"; exit 1; }
out=$(echo "y" | atree rm 4 --keep-branch 2>&1)
echo "$out" | grep -q "kept" || { echo "FAIL: T6 no kept msg"; exit 1; }
[ ! -d .worktree/4 ] || { echo "FAIL: T6 worktree not removed"; exit 1; }
git branch | grep -q "feat/keep-me" || { echo "FAIL: T6 branch deleted"; exit 1; }
echo "PASS: T6 --keep-branch"

# T7: --dry-run → no actual change
atree new --no-prompt 5 2>&1 | grep -q "✓ Created" || { echo "FAIL: create 5"; exit 1; }
out=$(echo "y" | atree rm 5 --dry-run 2>&1)
echo "$out" | grep -q "dry-run" || { echo "FAIL: T7 no dry-run msg"; exit 1; }
[ -d .worktree/5 ] || { echo "FAIL: T7 dry-run deleted slot"; exit 1; }
echo "PASS: T7 dry-run preserved"

# T8: flag validation → atree new --squash should error
out=$(atree new --no-prompt --squash 6 2>&1 || true)
echo "$out" | grep -q "only valid with: merge" || { echo "FAIL: T8 no validation msg"; exit 1; }
echo "PASS: T8 flag validation"

# T9: atree diff --keep-branch should error
out=$(atree diff --keep-branch 2>&1 || true)
echo "$out" | grep -q "only valid with: rm" || { echo "FAIL: T9 no validation msg"; exit 1; }
echo "PASS: T9 flag validation (diff + --keep-branch)"

echo "=== test-rm DONE ==="
