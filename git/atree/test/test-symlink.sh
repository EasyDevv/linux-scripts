#!/usr/bin/env bash
set -euo pipefail

ROOT=/home/easydev/dev/sandbox/sandbox-01
cd "$ROOT"

echo "=== Symlink: setup share directory ==="
mkdir -p share && echo "data" >share/data.txt
git add share/ && git commit -m "share baseline" -q

# S10: symlink conflict detection
echo "=== Symlink: create slot with --symlink share --force ==="
atree new --no-prompt --symlink share --force 1 2>&1 | grep -q "✓ Symlinked share" || { echo "FAIL: init symlink"; exit 1; }

curr=$(readlink .worktree/1/share)
exp="$ROOT/share"
[ "$curr" = "$exp" ] || { echo "FAIL: wrong symlink target: $curr (expected $exp)"; exit 1; }
echo "PASS: symlink to correct target"

echo "=== Symlink: corrupt to different target ==="
mkdir -p /tmp/elsewhere && echo "corrupt" >/tmp/elsewhere/data.txt
rm .worktree/1/share && ln -s /tmp/elsewhere .worktree/1/share

out=$(atree apply 1 2>&1 || true)
echo "$out" | grep -q "conflict: existing symlink" || { echo "FAIL: should detect conflict"; exit 1; }
echo "PASS: conflict detected"

echo "=== Symlink: --force restore ==="
out=$(atree apply 1 --force 2>&1)
echo "$out" | grep -q "✓ Symlinked share" || { echo "FAIL: force apply"; exit 1; }
content=$(cat .worktree/1/share/data.txt)
[ "$content" = "data" ] || { echo "FAIL: wrong content after restore: $content"; exit 1; }
echo "PASS: force restore"

# S11: copy merge conflict
echo "=== Copy: two slots modify same file ==="
echo "cfg baseline" >cfg.txt
git add cfg.txt && git commit -m "cfg" -q

atree new --no-prompt 2 2>&1 | grep -q "✓ Created" || { echo "FAIL: create 2"; exit 1; }
atree new --no-prompt 3 2>&1 | grep -q "✓ Created" || { echo "FAIL: create 3"; exit 1; }

echo "cfg slot 2" >.worktree/2/cfg.txt && git -C .worktree/2 commit -am "s2" -q
echo "cfg slot 3" >.worktree/3/cfg.txt && git -C .worktree/3 commit -am "s3" -q

echo "=== Copy: merge slot 2 (succeeds) ==="
atree merge 2 2>&1 | grep -q "✓ Merged" || { echo "FAIL: merge 2"; exit 1; }
echo "PASS: first merge"

echo "=== Copy: merge slot 3 (conflict) ==="
out=$(atree merge 3 2>&1 || true)
echo "$out" | grep -qi "conflict" || { echo "FAIL: no conflict"; exit 1; }
grep -q "<<<<<<< HEAD" cfg.txt || { echo "FAIL: missing conflict markers"; exit 1; }
echo "PASS: conflict on second merge"

locks=$(cat .worktree/sessions.json 2>/dev/null || echo '{"locks":{}}')
echo "$locks" | grep -q '"locks": {}' || { echo "FAIL: lock not released after conflict"; exit 1; }
echo "PASS: lock released after conflict"

echo "=== Symlink/Copy DONE ==="
