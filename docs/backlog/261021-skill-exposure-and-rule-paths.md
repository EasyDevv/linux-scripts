# 스킬 노출 정책 이전과 rule frontmatter `paths:` 통일

> 작성일: 2026-10-21 (261021)
> 상태: 구현·검증 완료. 커밋하지 않음.
> 계기: Claude 세션 `00f7dcf3-8fad-48f8-b8f1-7cb3919e2bd0`이 weekly limit으로 중단 → 이어받기 → 후속 2건
> 산출물:
> - `~/.local/share/scripts/dev/decision/skill-flags/` (`core.ts`, `core.test.ts`, `index.ts`, `sync.ts`)
> - `~/.pi/agent/extensions/lib/agent-rules.ts` (`paths:` 파서)
> - `~/.claude/skills/agents-rules/` 1.2.0 (SessionStart 훅)
> - 규칙 파일 4개(`applyTo` 제거), 문서 7곳

## TL;DR

1. 중단된 세션이 `agents-rules` 플러그인을 링크 동기화 전용으로 줄이던 중이었고, `lib.mjs`만 고쳐진 채
   `session-start.mjs`가 삭제된 export를 import해 **SessionStart 훅이 `SyntaxError`로 죽어 있었다.**
   훅 정리, 깨진 링크 14개 정리, 프로젝트 스킬 45/45 플래그 확인으로 마무리.
2. Rule frontmatter를 **`paths:` 하나로 통일**했다. `applyTo:`는 읽기만 하는 레거시 폴백으로 남겼다.
   `paths:`가 비어 있는 rule이 매 세션 상시 주입되던 버그도 함께 고쳤다.
3. `hidden-skills.ts`를 **decision repo의 harness-agnostic 코어**로 옮기고, pi 확장과 Claude SessionStart
   훅이 같은 코어를 쓰게 했다. 관리 범위에 **현재 프로젝트 + 설정된 프로젝트 루트**를 추가했다.

## 0. 이어받은 중단 세션

| 항목 | 내용 |
| --- | --- |
| 중단 원인 | `You've hit your weekly limit · resets 12am (Asia/Seoul)` (transcript 1293행) |
| 중단 시점 | `agents-rules`에서 규칙 주입을 제거하고 훅/플러그인 설명을 정리하던 중 |
| 발견한 상태 | `lib.mjs`는 링크 코드만 남았는데 `session-start.mjs`가 `formatRuleGroups`·`loadAllRules`를 import → 훅 실행 시 `SyntaxError`, 링크 동기화까지 실패 |

완료한 작업:

- `session-start.mjs` → `ensureAgentsLinks`만. `hooks.json` → `SessionStart` 하나. `pre-tool-use.mjs`·`user-prompt-submit.mjs` 삭제.
- 백업: `/tmp/claude-1000/-home-easydev--local-share-scripts/00f7dcf3-.../scratchpad/agents-rules.bak/`
- `~/dev`의 깨진 링크 14개 정리: 은퇴한 `rules-optional/{skill,web-workflow}.md`를 가리키던 링크 8개,
  jegap의 복사 잔재 4개(다른 프로젝트 `gotchii`/`true-index`를 가리킴), quant-ref `.claude/rules` 1개.
- 이전 세션이 놓친 tampermonkey 스킬 2개(`verify-javlibrary`, `verify-stash`)에 플래그 적용.

## 1. Rule frontmatter: `applyTo:` → `paths:`

### 근거

| 소비자 | 읽는 키 |
| --- | --- |
| pi `extensions/lib/agent-rules.ts` | `applyTo` (유일) |
| decision `features/path-trigger.ts` | `paths` |
| Claude Code 네이티브 rules 로더 | `paths` |
| dashboard `template.rs` `rule_link_dir` | `description` 유무만 봄 (키 무관) |

즉 `applyTo`를 읽는 곳은 pi 하나뿐이라 통일 비용이 낮았다. 실제 활성 파일도 4개뿐이었다.

### 변경

- **파서** `extensions/lib/agent-rules.ts`
  - `parsePathList(raw)` 추가: `paths: ["src/**", Cargo.toml]`(따옴표 없는 토큰 포함 인라인 배열),
    `paths: "a/**, b/**"`(콤마 문자열), `paths: []` 모두 처리.
  - `parseRuleDocument`는 `paths` → 없으면 `applyTo` 순으로 읽는다. 반환 필드 `applyTo` → `paths`로 개명.
  - 규칙: **글롭 키가 있는데 값이 비면 "매치 없음"**. 이전에는 `[]`가 `always`로 판정돼 본문이
    모든 세션의 시스템 프롬프트에 들어갔다(`lib.mjs:70`에서 지적된 그 버그).
  - 글롭 키가 아예 없는 파일은 기존과 같이 always(프로젝트 `.agents/rules/`에 `description:`만 있는
    rule이 링크돼 있어도 동작이 바뀌지 않게).
- **파일**: `~/.agents/rules-optional/{architecture,bun}.md`에서 `applyTo` 줄 제거(프로젝트는 심링크로 공유),
  `property-portal/.agents/rules/project-name.md`, `tools/stash/.agents/rules/stash-ui.md` 동일.
- **문서**: pi `docs/agent-rules.md`, pi `extensions/AGENTS.md`, `~/.agents/AGENTS.md`,
  `write-a-rule/SKILL.md` + `references/rule-vs-skill.md`.
- `rules-archive/`와 decision `docs/`의 날짜 박힌 기록은 과거 사실이므로 건드리지 않았다.

### 검증

```
cd ~/.pi/agent && bun test extensions/lib/agent-rules.test.ts   # 10 pass
```

실제 프로젝트로 로더 확인(always 2개만 시스템 프롬프트):

```
kkumi: clarity, pc-spec → always=true
       bun, cmd.executor, stack-svelte → always=false, paths 파싱됨
```

## 2. `skill-flags/`를 decision repo로 이전 + 프로젝트 스킬 관리

### 결정

| 질문 | 선택 |
| --- | --- |
| 프로젝트 범위 | 설정된 루트 전체 스캔 + 현재 프로젝트. 워처는 현재 프로젝트만 |
| 이전 형태 | 파일 전체를 decision repo로. 단 pi·Claude가 함께 쓰는 코어 구조 |

### 구조

```
~/.local/share/scripts/dev/decision/skill-flags/
├── core.ts        # harness-agnostic. node builtin만. 루트 결정·스캔·플래그·결과 포맷
├── core.test.ts   # bun:test 12개
├── index.ts       # pi glue: factory sync, watcher, /sync-hidden-skills (pi API는 로컬 인터페이스로만)
└── sync.ts        # one-shot CLI. Claude SessionStart 훅이 `bun sync.ts --cwd <project>`로 호출
```

- **루트**: `~/.agents/skills`, `~/.agents/skills-optional`, 현재 프로젝트의 `.agents/skills`,
  그리고 `~/.config/decision/skill-flags.json`의 `projectRoots`(기본 `~/dev`) 아래 모든 `.agents/skills`.
  realpath 기준 dedupe, `node_modules`/`target`/`dist`/점 디렉터리 제외.
- **설정**: `~/.config/decision/skill-flags.json`
  ```json
  { "projectRoots": ["~/dev"], "maxDepth": 2 }
  ```
  없거나 깨져 있으면 위 기본값. `~/dev/<category>/<project>`가 2단계라 `maxDepth: 2`.
- **pi**: `~/.pi/agent/settings.json`의 `extensions`에 디렉터리 경로 추가.
  overlay의 `extensions/hidden-skills.ts`·`extensions/lib/hidden-skills.test.ts` 삭제,
  `scripts/check-baseline.json` 항목 2개 제거.
- **Claude**: `agents-rules` SessionStart 훅이 링크 동기화 후 `sync.ts`를 fail-open(5s timeout, stdio ignore)으로 실행.
  플러그인 1.2.0.
- `_manual/`의 의미는 그대로: find_skill이 추천하지 않는다. frontmatter 구분자 역할은 없어졌다.

### 비용

| 측정 | 값 |
| --- | --- |
| `skillRoots()` (`~/dev` 루트 탐색 포함) | ~25ms (`maxDepth: 2`) |
| `syncSkillFlags()` 파일 124개 스캔·비교 | ~11ms |
| `bun sync.ts` 프로세스 포함 | ~300ms (세션 시작 1회) |
| 참고: `maxDepth: 6` | 루트 수는 동일(24), 탐색만 ~164ms |

서브에이전트도 factory를 타므로 시작 비용을 25ms로 억제했다.

## 3. 검증

| 항목 | 결과 |
| --- | --- |
| decision `bun test` | **169 pass / 0 fail** (신규 12 포함) |
| 플래그 감사 | 28 roots · **124개 스캔, 미적용 0** |
| pi 실기동 | 무효 모델(`--model none/none`)로 기동해도 factory가 먼저 돌아 새 프로젝트 스킬에 플래그 적용 |
| pi 워처 | `session_start` 후 새 스킬 생성 → 800ms 내 플래그 |
| Claude 훅 | exit 0, stdout 0바이트, 링크 동기화 + 플래그 적용, 2회 실행 멱등 |
| `claude plugin validate` / `list` | ✔ Validation passed / `agents-rules@skills-dir` 1.2.0 ✔ loaded |
| pi `bun run check` | 실패 — 새 lint 9건은 **변경 전부터 있던 것**(decision/config.ts, skills.ts, model-picker 등 다른 작업분). 새 test 실패 0 |

재현:

```
cd ~/.local/share/scripts/dev/decision && bun test
bun skill-flags/sync.ts --cwd ~/dev/product/kkumi          # 미적용 0이면 변경 없음
cd ~/.pi/agent && bun run check
```

## 4. 남은 일 / 위험

- **커밋 안 함.** 변경 repo: `~/.pi/agent`(settings·baseline·파서·문서), `~/.agents`(문서·rule·스킬 문서),
  `~/.local/share/scripts`(`skill-flags/` 신규 + decision `AGENTS.md`), `~/dev` 프로젝트 2곳 rule,
  `~/.claude/skills/agents-rules`(git 미관리).
- **pi `bun run check`가 실패 중**이다. 원인은 이 작업과 무관한 미포맷 파일 9개. 베이스라인을 갱신해
  덮지 않았다(다른 세션 작업 중일 수 있음).
- **overlay 자체 스킬 4개**(`~/.pi/agent/.agents/skills/*`)가 이제 플래그된다. 프로젝트 범위 확장의
  직접 결과이고 overlay repo에 +4줄 diff가 생긴다. 다음 pi 기동 때 재적용되므로 되돌리려면
  코어에 `exclude` 옵션을 추가해야 한다.
- **`projectRoots` 밖 프로젝트**는 그 프로젝트에서 pi를 열 때만 플래그된다(현재 프로젝트 규칙).
  `~/.pi/agent`·`~/.local/share/scripts`가 그렇게 처리됐다(cmd-links 포함).
- **decision에는 lint 게이트가 없다.** 이동한 파일은 overlay의 `bun run check` 대상에서 빠지므로
  `bun test`만이 회귀 방어선이다.
