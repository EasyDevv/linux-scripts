#!/usr/bin/env bash
set -euo pipefail

ROOT=/home/easydev/dev/sandbox/sandbox-01
cd "$ROOT"

for d in .worktree/*/; do
	git worktree remove --force "$d" 2>/dev/null || true
done
rm -rf .worktree
git worktree prune 2>/dev/null || true

git branch | grep -E "atree/|feat/" | xargs -r git branch -D 2>/dev/null || true
git stash drop 2>/dev/null || true

git reset --hard d303b80 >/dev/null 2>&1
rm -rf .serena 2>/dev/null || true
