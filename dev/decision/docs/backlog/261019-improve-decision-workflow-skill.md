# improve-decision-workflow 스킬 개선 백로그

## 결론

| # | 개선 | 방법 | 우선 |
|---|---|---|---|
| 1 | **최근 점검 직후 재점검 경고** | `review-log.py`가 점검 기록을 남기고, 1단계(Scope)에서 겹치는 기간이면 경고 + "지난 점검 이후만" 선택지 | **P1** |
| 2 | **불필요한 컨텍스트 차단** | 스크립트가 요약만 출력(≤60줄), 원문은 scratchpad JSON, 인용 줄만 `show-line.py`로 열기 | **P1** |
| 3 | **일회성 스크립트 → 스킬 스크립트** | 이번 세션의 `toolerr.py`·`replay.ts` 등 6개를 `scripts/`로 정식화, SKILL.md는 호출 순서만 | **P2** |
| — | **다음 행동** | 1·2·3을 `improve-skill`로 한 번에 적용, `--since` 재실행으로 검증 | — |

대상 스킬: `~/.agents/skills/improve-decision-workflow/` (`~/.claude/skills/`는 심볼릭 링크).

## 2. 정기 점검과 중복 경고

같은 7일 창을 다시 훑으면 집계·분류·재생 비용을 그대로 다시 낸다. 지금은 점검 기록이 어디에도 남지 않아 "방금 했다"를 알 방법이 없다.

```text
/improve-decision-workflow
  -> review-log.py status --since 7d
       겹침 없음   -> 정상 진행
       겹침 ≥50%   -> ⚠ 경고 + AskUserQuestion
                      1) 지난 점검 이후만 (Recommended)
                      2) 그래도 7일 전체
                      3) 중단
  -> (보고 직후) review-log.py record --period … --sessions N --findings …
```

| 항목 | 내용 |
|---|---|
| 기록 위치 | `~/.local/state/decision/reviews.jsonl` (리포 밖, 추적 안 함) |
| 한 줄 | `{ts, since, until, harness, sessions, calls, errors, findings[], doc?}` |
| 경고 기준 | 요청 창과 지난 점검 창이 50% 이상 겹치고 지난 점검이 3일 이내 |
| 델타 모드 | `--since last` = 지난 점검의 `until` 이후 세션만 |
| 정기 검토 항목 | 도구 실패율 추이, guard 규칙별 발동 수(`log-*.jsonl` `feature: guard`), decision이 **필요한 곳 / 필요 없는 곳**(아래 표) |

decision 필요 여부는 점검마다 같은 질문으로 판정해 기록한다.

| 질문 | 필요 | 불필요 |
|---|---|---|
| 실패가 결정적(같은 입력 → 같은 실패)인가 | 코드 규칙(guard) | — |
| 문장을 읽어야 판단되는가 | Jev 질의(loop runaway 등) | 코드로 되면 Jev 금지 |
| 재발했는가 | 2회 이상 또는 직접 원인 추적 | 1회성 → `No write` |
| 시스템 프롬프트를 바꾸는가 | 세션 시작 시 고정분만 | 세션 중 변경(캐시 파손) |

그래서: 정기 점검이 쌓일수록 델타만 보게 되고, "decision이 불필요한 곳"도 기록으로 남아 과잉 개입을 걷어낼 근거가 된다.

## 3. 이번 세션에서 불필요했던 컨텍스트

이번 점검(세션 `e971503a`)에서 결론에 쓰이지 않았는데 컨텍스트에 들어온 것들이다.

| 무엇 | 규모 | 원인 | 대책 |
|---|---|---|---|
| `prettier a b \| diff b -` 실수로 `decision.ts` 전문 출력 | ~460줄 | 파이프 대상 파일 착오 | 포맷 확인은 `--list-different`만, diff는 파일 하나씩 |
| 재생 결과 전체 출력 | 33.5KB(잘림 저장) | 표본 행을 무제한 출력 | 스크립트가 집계 + 상위 N, 나머지는 JSON 파일 |
| 스키마 파악용 JSONL 샘플 덤프 | 수십 줄 × 2 | 하네스 형식을 매번 재발견 | 형식은 스크립트에 내장(`sessions.py`) |
| `register.ts`·`index.ts` 큰 구간 통째 읽기 | 수백 줄 | 훅 위치를 찾으려고 | `grep -n` 후 `offset/limit` |
| 5단계 `decision-digest.py` 미사용 | — | 질문이 "도구 실패율"이라 digest(라우팅 중심)와 맞지 않음 | 요청 유형별 진입점 분기(아래) |
| `find /` 타임아웃 2분, zsh 글롭 오류 3회 | 턴 낭비 | 바로 그 실패 패턴 | 이제 guard가 차단·수정(재발 시 규칙 확인) |

요청 유형에 따라 필요한 단계만 부르게 분기한다.

```text
요청 유형                       부를 것                         안 부를 것
───────────────────────────────────────────────────────────────────────────
라우팅 누락(find_skill/tool)    decision-digest.py, replay      tool-errors, guard-replay
도구 호출 실패/낭비             tool-errors.py, waste.py,       digest 전 세션 덤프
                                guard-replay.ts
tier 불일치                     decision audit, decision route  tool-errors
```

그래서: SKILL.md 2단계를 "유형 판정 → 해당 스크립트만"으로 바꾸고, 모든 스크립트는 기본 출력이 요약이며 `--json <path>`로만 전체를 쓴다.

## 4. 스크립트화 대상

이번 세션에서 손으로 짠 것 중 다음 점검에서 그대로 다시 쓸 것들이다.

| 스크립트 | 출처(scratchpad) | 입력 → 출력 | 비고 |
|---|---|---|---|
| `sessions.py` | 각 스크립트의 반복 코드 | `--since 7d --harness all` → 세션 경로 목록 | pi `session.timestamp`, Claude mtime+`timestamp` 필터 공용 |
| `tool-errors.py` | `toolerr.py` | 세션 → 하네스·도구별 실패율, 오류 유형 상위 N, `file:line` 인용 | bash 분류(144, 글롭, 타임아웃, 무해 exit 1) 포함 |
| `silent-errors.py` | 즉석 python | 오류로 표시 안 된 실패(zsh `no matches found` 200건 중 13건만 is_error) | 숨은 낭비 탐지 |
| `waste.py` | 즉석 python | 실패 다음 턴의 cache read/write·output 토큰, 동일 인자 재시도 | "의미 없는 낭비" 정량화 |
| `bash-corpus.py` + `guard-replay.ts` | `cmds.json`, `replay.ts`, `dbg.ts` | 실제 bash 명령 → guard 적용 결과, 실패 대비 적중/누락, 오탐 표본 | guard 규칙 변경 시 회귀 검사 |
| `show-line.py` | — | `file:line[±n]` → 해당 JSONL 줄 요약 | 원문 열람을 인용 줄로 제한 |
| `review-log.py` | — | `status` / `record` | §2 |

```text
sessions.py -> tool-errors.py -> silent-errors.py -> waste.py -> 요약 ≤60줄 + JSON
sessions.py -> bash-corpus.py -> guard-replay.ts               -> 요약 ≤60줄 + JSON
모든 단계 끝 -> review-log.py record
```

그래서: 다음 점검은 스크립트 4–5회 호출 + 인용 줄 확인만으로 이번 세션의 §1–§2 보고를 재현한다.

## Backlog

| 가정 / 질문 | 확인 방법 |
|---|---|
| 겹침 50%·3일 기준이 적절한가 | 첫 두 번의 정기 점검 후 경고 발생/무시 비율 확인 |
| 요약 ≤60줄로 판단에 충분한가 | 다음 점검에서 원문을 추가로 연 횟수 세기(목표 ≤5회) |
| `guard-replay.ts`가 guard 소스 경로에 묶여도 되는가 | 데몬 `features/guard.ts` 경로 변경 시 깨짐 → `decision eval --feature guard --all`로 대체 가능한지 검토 |
| `silent-errors.py` 패턴이 zsh 외에도 있는가 | pi(bash) 결과에서 오류 문자열 + `isError:false` 조합 표본 조사 |
| 정기 실행을 `schedule`로 돌릴지 | 사람 확인(AskUserQuestion)이 필요한 단계가 있어 지금은 수동 유지 |

- 다음: `improve-skill`로 §2–§4를 적용 → `sessions.py --since last`로 델타 점검 1회 → `review-log.py status`가 경고를 내는지 확인.
- 이번 점검 결과와 적용 내역은 세션 `e971503a` 보고 참고(guard 4규칙, CLAUDE.md Read 규칙, 플러그인 0.2.0).

## Sources

- 세션 `e971503a-5082-4822-9c5e-1b36a0168065` (Claude Code, 2026-10-19) — 7일 점검, guard 구현·재생
- `~/.agents/skills/improve-decision-workflow/SKILL.md`, `scripts/decision-digest.py`, `references/signals.md`
- `CONTRACTS.md` › `POST /v1/guard`, `features/guard.ts`, `evals/guard.jsonl`
