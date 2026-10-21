# 파일 터치에 짝 스킬 힌트 싣기

## 결론

| 질문 | 답 |
|---|---|
| 왜 안 불렸나 | **글롭 불일치** — 보고서를 `motion-table-research/리서치-결과.md`에 써서 `docs/**`가 안 맞음 |
| docs/ 안이었다면 | **rule만** 왔음 — 터치 응답이 skill 매치를 버리고 rule의 `skills:`도 안 따라감 |
| 고친 것 | 터치가 매치된 rule의 `skills:`와 글롭 매치 skill을 **힌트**(`p: 1`, 본문 없음)로 돌려줌, 두 클라이언트가 tool result에 붙임 |
| 남은 것 | docs/ 밖 `.md` → `docs-archive`를 always-on `rules/`로 이동해 해결 |
| 다음 | `decision audit --since 7d --harness all`로 터치 힌트 뒤 `used`가 붙는지 확인 |

## 증거

| 항목 | 값 |
|---|---|
| 세션 | pi `01a15df3-63ca-76b5-ad0e-3ab53079baf1` (cwd `~/chat`) |
| 프롬프트 판정 | JSONL 7행: `2 skills, 0 rules (asked 3 of 55)` — browser, browse-site |
| 문서 작성 | JSONL 68행: `write motion-table-research/리서치-결과.md` |
| 재현 (수정 전) | docs 경로 터치 → `1 rules by path`, skills `[]` |
| 재현 (수정 후) | docs 경로 터치 → `1 rules, 1 skills by path`, `write-doc` p 1 |

프롬프트는 "리스트업 + 이미지 수집"뿐이라 Jev가 문서 작성을 볼 수 없었습니다. 문서 규칙이 걸릴 기회는 파일 터치 하나였습니다.

## 원인

```text
write x.md ──► tool_result ──► find_skill(paths=[x.md], prompt="")
                                 │
                                 ├─ rule 글롭  docs/**      ✗ (docs/ 밖)
                                 └─ touchOnly → skills: []  ✗ (짝 스킬 버림)
```

`compose()`의 rule↔skill 연결은 "skill이 뽑히면 rule이 따라온다" 한 방향뿐이었습니다. 터치처럼 rule이 먼저 확정되는 경로에서는 skill이 오지 않았습니다.

## 바꾼 파일

| 파일 | 변경 |
|---|---|
| `CONTRACTS.md` | 터치 응답 계약: rule + 짝 skill 힌트 |
| `features/find-skill.ts` | `skillHits` = 글롭 skill ∪ 매치 rule의 `skills:`; `pathOnly`가 힌트로 반환; 프롬프트 경로에서도 shortlist 밖 질의 |
| `features/find-skill.test.ts` | 짝 스킬 힌트 테스트, 기존 터치 테스트 기대값 |
| `~/.pi/agent/extensions/decision/{skills,index}.ts` | `formatTouchMessage` (rule → skill 힌트) |
| `~/.agents/plugins/decision/hooks/{decision,register}.ts` | `assembleTouch`가 skill 힌트와 `skillNames` 보고; 0.3.1 |
| `~/.agents/skills/learn/references/routing.md` | 짝 skill 지정 방법, 전 홈 깨진 링크 점검 |

같은 작업에서 깨진 링크 정리: orchestration 5, find-skills 3, copilot gstack 4, llm-docs instructions 4, `~/chat` 3개 스킬 → `.agents/skills-routed`, `~/chat/.claude/rules` → `../.agents/rules`.

## 검증

| 체크 | 결과 |
|---|---|
| 데몬 `bun test` / `tsc` | 151 pass / 0 |
| pi decision `bun test` | 50 pass |
| `claude plugin test` | 61 pass |
| 실호출 (재시작 후) | `docs/research/x.md` → docs-archive + write-doc |
| 깨진 링크 스캔 | 0건 |

## Backlog

- **docs/ 밖 `.md`** — `docs-archive`를 always-on `~/.agents/rules/`로 옮겼습니다(본문에 `write-doc` 지시 추가). 이제 데몬 판정 없이 매 세션 규칙이 보입니다. 확인: 다음 리서치 세션에서 보고서가 `docs/<subcat>/`에 생기고 `write-doc` SKILL.md를 Read 하는지 봅니다.
- **Claude 플러그인 반영** — `claude plugin update decision@agents-local` 후 새 세션에서 적용됩니다(미실행).
- **pi `bun run check`** — decision의 `_body` 미사용 변수와 config/loop 포맷 차이는 이번 변경 전부터 있었습니다.
