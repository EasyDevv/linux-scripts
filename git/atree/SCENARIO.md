# atree scenarios

atree의 동적 시나리오를 **재실행 가능한 워크플로우**로 정리한 문서.
각 시나리오는 setup → execute → verify → cleanup의 4단계로 구성되어 복사·붙여넣기로 바로 실행할 수 있다.

정적 검증은 `atree/test/` 아래의 bash 스크립트로 자동화되어 있으며 본 문서 맨 아래 "Static tests" 섹션에서 참조한다.

## 환경

- **테스트 repo**: `/home/easydev/dev/sandbox/sandbox-01` (SvelteKit, `d303b80` Initial commit 기준)
- **모델**: `opencode-go/deepseek-v4-flash` (opencode CLI)
- **공통 setup helper**:

```bash
atree_setup() {
	cd /home/easydev/dev/sandbox/sandbox-01
	for d in .worktree/*/; do git worktree remove --force "$d" 2>/dev/null; done
	rm -rf .worktree .serena
	git worktree prune 2>/dev/null
	git branch | grep -E "atree/|feat/" | xargs -r git branch -D 2>/dev/null
	git stash drop 2>/dev/null
	git reset --hard d303b80
}

atree_cleanup() {
	for d in .worktree/*/; do git worktree remove --force "$d" 2>/dev/null; done
	rm -rf .worktree
	git worktree prune
}
```

---

## S06 — Same slot race

**목적**: 3 opencode 인스턴스가 같은 slot에 동시 `new` 시도 → lock이 1개만 통과시키고 나머지 거부.

**사전 조건**: `opencode` CLI 사용 가능.

```bash
# Setup
atree_setup
rm -f /tmp/agent-{1,2,3}.txt

# Execute (3 opencode background spawn, 같은 slot 1)
for i in 1 2 3; do
	(opencode run -m opencode-go/deepseek-v4-flash \
		--dir "$PWD" \
		--dangerously-skip-permissions \
		"cd $PWD && atree new --no-prompt --branch feat/race-$i 1 2>&1 | tee /tmp/agent-$i.txt" \
		>/dev/null 2>&1) &
done
wait

# Verify
success=$(grep -c "✓ Created" /tmp/agent-*.txt | awk -F: '{s+=$2}END{print s}')
denied=$(grep -c "lock refused" /tmp/agent-*.txt | awk -F: '{s+=$2}END{print s}')
echo "success=$success denied=$denied"  # expected: success=1 denied=2
[ "$success" = "1" ] && [ "$denied" = "2" ] && echo "PASS" || echo "FAIL"

# Cleanup
atree_cleanup
git branch | grep "feat/race" | xargs -r git branch -D 2>/dev/null
```

**검증 포인트**:
- `success=1`: 단 1개의 인스턴스만 `✓ Created` 출력
- `denied=2`: 나머지 2개는 `Slot 1 already exists ... lock refused`
- `git worktree list`에 `.worktree/1` 정확히 1개

---

## S07 — Different slot parallel

**목적**: 2 opencode 인스턴스가 다른 slot에 동시 `new` → lock 없이 병렬 성공 (lock이 slot 단위임을 증명).

```bash
# Setup
atree_setup
rm -f /tmp/agent-{a,b}.txt

# Execute (2 opencode background spawn, 다른 slot)
(opencode run -m opencode-go/deepseek-v4-flash \
	--dir "$PWD" --dangerously-skip-permissions \
	"cd $PWD && atree new --no-prompt --branch feat/par-a 1 2>&1 | tee /tmp/agent-a.txt" \
	>/dev/null 2>&1) &
(opencode run -m opencode-go/deepseek-v4-flash \
	--dir "$PWD" --dangerously-skip-permissions \
	"cd $PWD && atree new --no-prompt --branch feat/par-b 2 2>&1 | tee /tmp/agent-b.txt" \
	>/dev/null 2>&1) &
wait

# Verify
[ -f .worktree/1/.git ] && [ -f .worktree/2/.git ] && echo "PASS" || echo "FAIL"
grep -q "✓ Created" /tmp/agent-a.txt && grep -q "✓ Created" /tmp/agent-b.txt && echo "both created" || echo "FAIL"

# Cleanup
atree_cleanup
git branch | grep "feat/par" | xargs -r git branch -D 2>/dev/null
```

**검증 포인트**:
- `.worktree/1`과 `.worktree/2` 모두 존재
- 두 파일 모두 `✓ Created` 포함
- S06과 대비: 같은 slot이면 lock 충돌, 다른 slot이면 병렬 성공

---

## S08 — Concurrent merge + conflict

**목적**: 2 opencode 인스턴스가 동시에 머지 시도 → lock이 sequential 처리, 한쪽은 충돌, OPT-1 stash 보존, ExitError → lock release.

```bash
# Setup
atree_setup
echo "baseline" >cfg.txt
git add cfg.txt && git commit -m "cfg baseline" -q

# 두 slot 생성 + 같은 파일 다르게 수정
atree new --no-prompt --branch feat/merge-a 1
atree new --no-prompt --branch feat/merge-b 2
echo "version a" >.worktree/1/cfg.txt && git -C .worktree/1 commit -am "a" -q
echo "version b" >.worktree/2/cfg.txt && git -C .worktree/2 commit -am "b" -q

# Execute (2 opencode 동시 머지)
rm -f /tmp/merge-{a,b}.txt
(opencode run -m opencode-go/deepseek-v4-flash \
	--dir "$PWD" --dangerously-skip-permissions \
	"cd $PWD && atree merge 1 2>&1 | tee /tmp/merge-a.txt" \
	>/dev/null 2>&1) &
(opencode run -m opencode-go/deepseek-v4-flash \
	--dir "$PWD" --dangerously-skip-permissions \
	"cd $PWD && atree merge 2 2>&1 | tee /tmp/merge-b.txt" \
	>/dev/null 2>&1) &
wait

# Verify
merged=$(grep -c "✓ Merged" /tmp/merge-*.txt | awk -F: '{s+=$2}END{print s}')
conflicts=$(grep -ci "conflict" /tmp/merge-*.txt | awk -F: '{s+=$2}END{print s}')
echo "merged=$merged conflicts=$conflicts"  # expected: merged≥1, conflicts≥1

grep -q "<<<<<<< HEAD" cfg.txt && echo "PASS: conflict markers" || echo "FAIL"

locks=$(cat .worktree/sessions.json 2>/dev/null || echo '{"locks":{}}')
echo "$locks" | grep -q '"locks": {}' && echo "PASS: locks released" || echo "FAIL"

# Cleanup
git checkout -- cfg.txt
git checkout HEAD -- cfg.txt 2>/dev/null
git reset --hard HEAD 2>/dev/null
atree_cleanup
```

**검증 포인트**:
- `merged≥1`: 한쪽 머지 성공
- `conflicts≥1`: 다른 쪽 `Conflict detected` 또는 `Merge conflict!`
- `cfg.txt`에 conflict marker
- `sessions.json`이 `{"locks": {}}` — ExitError 발생해도 finally에서 release

---

## Static tests

`atree/test/` 아래 bash 스크립트로 자동화. 각 스크립트는 setup → 검증 → cleanup이 자기 안에서 끝나므로 단독 실행 가능.

```bash
# 전체 실행
bash ~/.local/share/scripts/git/atree/test/run.sh

# 개별 실행
bash ~/.local/share/scripts/git/atree/test/test-lifecycle.sh      # S01
bash ~/.local/share/scripts/git/atree/test/test-merge-safety.sh    # S02+S03
bash ~/.local/share/scripts/git/atree/test/test-merge-options.sh   # S04+S05
bash ~/.local/share/scripts/git/atree/test/test-stale-lock.sh      # S09
bash ~/.local/share/scripts/git/atree/test/test-symlink.sh         # S10+S11
bash ~/.local/share/scripts/git/atree/test/test-rm.sh              # T1~T9 (rm)
bash ~/.local/share/scripts/git/atree/test/concurrent.sh           # S06+S07+S08 (opencode 필요)
```

| 스크립트 | 검증 시나리오 | 자동화 |
|---|---|---|
| `test-lifecycle.sh` | S01: 3 worktree 생성·작업·diff·merge | grep 패턴 + git log |
| `test-merge-safety.sh` | S02+S03: main dirty + conflict | grep + stash list + sessions.json |
| `test-merge-options.sh` | S04+S05: --rm-src, --rst-src | worktree/branch 존재, slot HEAD == main HEAD |
| `test-stale-lock.sh` | S09: dead PID sessions.json | sessions.json 자동 청소 |
| `test-symlink.sh` | S10+S11: symlink 충돌, copy git conflict | readlink, conflict marker, lock release |
| `test-rm.sh` | T1~T9: rm (dirty/unmerged/confirm/keep-branch/dry-run/flag-validation) | changes table, branch 삭제, confirm |
| `concurrent.sh` | S06~S08 | opencode background spawn |
| `run.sh` | 5 정적 + concurrent 옵션 | sequential |

각 스크립트는 `set -euo pipefail` (run.sh는 `set -uo pipefail`)로 실패 즉시 중단, `echo "FAIL: ..."` + `exit 1` 패턴.
