# atree — Git worktree manager

병렬 브랜치 작업을 git worktree로 관리하는 CLI. 프로젝트 루트에서 `atree` 하나로
worktree 생성, 설정, 변경 조회, main 통합까지 처리한다.

## 설치

```bash
cmd-links apply atree
cmd-links doctor atree
```

셸 통합(선택):

```bash
eval "$(atree sh)"    # ~/.bashrc / ~/.zshrc 에 추가
```

## 명령어

| 명령 | 설명 |
|---|---|
| `atree new [slot]` | worktree 생성 (기본값: 빈 슬롯 자동 할당) |
| `atree ls` | worktree 목록 (slot, branch, 경로) |
| `atree apply [slot]` | `.worktree/config.json` 설정 재적용 |
| `atree diff [slot]` | 변경 파일 요약 (+/- 라인, hunk 범위) |
| `atree merge <slot>` | worktree branch → main 통합 |
| `atree root` | 메인 repo 루트 출력 |
| `atree sh` | 셸 통합 코드 출력 |

### 옵션

**new / apply 공통**
- `--symlink <path>` 심볼릭 링크 경로 (반복 가능)
- `--copy <path>` 복사 경로 (반복 가능)
- `--branch <name>` 브랜치명 override
- `--force` 덮어쓰기 허용
- `--dry-run` 미리보기
- `--no-prompt` 비대화형

**diff**
- `--patch` full diff 출력
- `--json` JSON 형식 출력

**merge**
- `--squash` squash merge
- `--rst-src` merge 후 source worktree를 main HEAD로 reset
- `--rm-src` merge 후 source worktree + branch 삭제

## 설정

`.worktree/config.json`:

```json
{
  "version": 1,
  "symlinks": [".user-data/", "node_modules/"],
  "copies": [".env.local", ".tasks/"]
}
```

최초 interactive 실행에서는 symlink/copy 경로를 먼저 모두 입력한 뒤 `config.json`을 만들고 worktree를 생성한다.

### symlink vs copy

- **symlink** — 공유해야 할 자원. source worktree에서 참조만 하고, 내용 변경은 원본에 반영됨.
- **copy** — 충돌이 예상되는 작업 파일. worktree 생성 시점에 원본을 복제해 독립적으로 사용.

## merge 후 worktree 정책

기본값은 **worktree 유지** (merge commit만 생성). 이유:

- merge 직후 검증/비교/추가 수정이 자주 필요함
- 자동 삭제는 파괴적이고 실수 위험이 큼

선택 옵션:

| 플래그 | 결과 | 적합한 상황 |
|---|---|---|
| *(기본)* | merge commit + worktree 유지 | 일반적인 통합 |
| `--rst-src` | merge + source를 main HEAD로 reset | 같은 슬롯 재사용 |
| `--rm-src` | merge + worktree 제거 + branch 삭제 | 완전히 끝난 feature |

## 실습 예제

```bash
cd ~/dev/sandbox/sandbox-01

# 1. 작업 공간 2개 생성
atree new 1
atree new 2

# 2. 각각 파일 수정 후 커밋
cd .worktree/1
echo "change" >> src/routes/+page.svelte
git add -A && git commit -m "feat: hero section"

cd ../2
echo "another" >> src/routes/+page.svelte
git add -A && git commit -m "feat: CTA section"

# 3. 변경 내역 확인
cd ../..
atree diff                     # 전체 통합 뷰
atree diff --patch 1           # slot 1 패치 전체
atree diff --json              # JSON 출력

# 4. main에 통합
atree merge 1                  # 단순 merge
atree merge --rst-src 2        # merge + source reset
atree merge --rm-src 3         # merge + source 삭제
```

## 문제 해결

- **"Main repository has uncommitted changes"** — `git status` 확인 후 commit/stash
- **"Slot has uncommitted changes"** — `atree merge --force <slot>` (또는 미리 commit)
- **prunable worktree** — `atree ls`가 `git worktree prune`을 자동 실행함
- **copy 충돌 (tracked path)** — tracked 파일은 copy보다 symlink가 적합
