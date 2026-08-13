#!/usr/bin/env bash
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
pass=0
fail=0

run_test() {
	local name="$1" script="$2"
	echo ""
	echo "=========================================="
	echo "  $name"
	echo "=========================================="
	bash "$DIR/setup.sh" 2>/dev/null || true
	if bash "$DIR/$script"; then
		((pass++))
	else
		((fail++))
	fi
}

run_test "Lifecycle (S01)" "test-lifecycle.sh"
run_test "Merge safety (S02+S03)" "test-merge-safety.sh"
run_test "Merge options (S04+S05)" "test-merge-options.sh"
run_test "Stale lock (S09)" "test-stale-lock.sh"
run_test "Symlink/Copy (S10+S11)" "test-symlink.sh"
run_test "rm (T1~T9)" "test-rm.sh"

if command -v opencode &>/dev/null; then
	run_test "Concurrency (S06+S07+S08)" "concurrent.sh"
else
	echo ""
	echo "=============================="
	echo "  SKIP: opencode not available"
	echo "=============================="
fi

echo ""
echo "=============================="
echo "  $pass passed, $fail failed"
echo "=============================="
exit $fail
