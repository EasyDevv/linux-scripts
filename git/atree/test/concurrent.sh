#!/usr/bin/env bash
set -euo pipefail

ROOT=/home/easydev/dev/sandbox/sandbox-01

if ! command -v opencode &>/dev/null; then
	echo "SKIP: opencode CLI not available"
	exit 0
fi

cd "$ROOT"

run_opencode() {
	local title="$1" cmds="$2" outfile="$3"
	opencode run -m opencode-go/deepseek-v4-flash \
		--dir "$ROOT" \
		--title "$title" \
		--dangerously-skip-permissions \
		"Execute these commands in $ROOT: $cmds Write all output to $outfile via tee. Report the file contents when done." \
		>/dev/null 2>&1
}

# S06: same slot race
echo "=== Concurrent: 3 agents → same slot 1 ==="
rm -f /tmp/agent-{1,2,3}.txt /tmp/agent-{a,b}.txt /tmp/merge-{a,b}.txt
run_opencode "c1" "cd $ROOT && atree new --no-prompt --branch feat/race-1 1 2>&1 | tee /tmp/agent-1.txt" "/tmp/agent-1.txt" &
P1=$!
run_opencode "c2" "cd $ROOT && atree new --no-prompt --branch feat/race-2 1 2>&1 | tee /tmp/agent-2.txt" "/tmp/agent-2.txt" &
P2=$!
run_opencode "c3" "cd $ROOT && atree new --no-prompt --branch feat/race-3 1 2>&1 | tee /tmp/agent-3.txt" "/tmp/agent-3.txt" &
P3=$!
wait $P1 $P2 $P3

success=$(grep -c "✓ Created" /tmp/agent-[123].txt 2>/dev/null | awk -F: '{s+=$2}END{print s}')
denied=$(grep -c "lock refused" /tmp/agent-[123].txt 2>/dev/null | awk -F: '{s+=$2}END{print s}')
[ "$success" -eq 1 ] || { echo "FAIL: expected 1 success, got $success"; exit 1; }
[ "$denied" -eq 2 ] || { echo "FAIL: expected 2 denials, got $denied"; exit 1; }
echo "PASS: 1 created, 2 denied ($success/$denied)"

rm -rf .worktree && git worktree prune 2>/dev/null || true
git branch | grep "feat/race" | xargs -r git branch -D 2>/dev/null || true

# S07: different slots parallel
echo "=== Concurrent: 2 agents → different slots ==="
rm -f /tmp/agent-{a,b}.txt
run_opencode "d1" "cd $ROOT && atree new --no-prompt --branch feat/par-a 1 2>&1 | tee /tmp/agent-a.txt" "/tmp/agent-a.txt" &
P1=$!
run_opencode "d2" "cd $ROOT && atree new --no-prompt --branch feat/par-b 2 2>&1 | tee /tmp/agent-b.txt" "/tmp/agent-b.txt" &
P2=$!
wait $P1 $P2

[ -f .worktree/1/.git ] || { echo "FAIL: slot 1 not created"; exit 1; }
[ -f .worktree/2/.git ] || { echo "FAIL: slot 2 not created"; exit 1; }
echo "PASS: both slots created"

rm -rf .worktree && git worktree prune 2>/dev/null || true
git branch | grep "feat/par" | xargs -r git branch -D 2>/dev/null || true

# S08: concurrent merge + conflict
echo "=== Concurrent: 2 agents merge conflicting slots ==="
echo "baseline" >cfg.txt && git add cfg.txt && git commit -m "cfg" -q
atree new --no-prompt --branch feat/merge-a 1 2>&1 | grep -q "✓ Created" || exit 1
atree new --no-prompt --branch feat/merge-b 2 2>&1 | grep -q "✓ Created" || exit 1
echo "a" >.worktree/1/cfg.txt && git -C .worktree/1 commit -am "a" -q
echo "b" >.worktree/2/cfg.txt && git -C .worktree/2 commit -am "b" -q

rm -f /tmp/merge-{a,b}.txt
run_opencode "ma" "cd $ROOT && atree merge 1 2>&1 | tee /tmp/merge-a.txt" "/tmp/merge-a.txt" &
P1=$!
run_opencode "mb" "cd $ROOT && atree merge 2 2>&1 | tee /tmp/merge-b.txt" "/tmp/merge-b.txt" &
P2=$!
wait $P1 $P2

merged=$(grep -c "✓ Merged" /tmp/merge-*.txt 2>/dev/null | awk -F: '{s+=$2}END{print s}')
conflicts=$(grep -c "Conflict" /tmp/merge-*.txt 2>/dev/null | awk -F: '{s+=$2}END{print s}')
[ "$merged" -ge 1 ] || { echo "FAIL: expected at least 1 merge"; exit 1; }
[ "$conflicts" -ge 1 ] || { echo "FAIL: expected at least 1 conflict"; exit 1; }
echo "PASS: $merged merged, $conflicts conflicts"

locks=$(cat .worktree/sessions.json 2>/dev/null || echo '{"locks":{}}')
echo "$locks" | grep -q '"locks": {}' || { echo "FAIL: locks not released"; exit 1; }
echo "PASS: all locks released"

echo "=== Concurrent DONE ==="
