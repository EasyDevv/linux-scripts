# Skill 도구가 routed 스킬을 "built-in CLI command"로 거절하던 문제

## 결론

| 질문 | 답 |
|---|---|
| 무엇이 났나 | `Skill(improve-skill)` → `improve-skill is a built-in CLI command, not a skill. Ask the user to run /improve-skill themselves` |
| 원인 | decision 플러그인이 routed 스킬을 `$.command.register`로 `/<name>` 명령으로 등록함. Skill 도구는 플러그인 명령을 호출하지 못하고 built-in으로 판정함. `CommandSpec`(`name`, `description`, `argumentHint`, `immediate`)에는 model-invocable 옵션이 없음 |
| 범위 | 등록된 routed 스킬 전부: 전역 38개 + 각 프로젝트 `.agents/skills-routed`. Claude 스킬·명령과 이름 충돌 0건 |
| 고친 것 | `hooks/register.ts`의 `tool.call { tool: "Skill" }` 훅이 `routedCommands`에 있는 이름이면 `loadRouted`로 본문을 context로 싣고 `{ success, commandName, status: "inline" }`로 답함. `args`는 `Follow the <name> skill for:` 줄로 붙임. 나머지 이름은 core가 처리 |

## 증거

- 세션 `f6403b38` `/learn` 6단계: `Skill({skill: "improve-skill"})` 거절
- 같은 세션 프롬프트 힌트는 "not in the Skill tool: Read the SKILL.md"라고 했지만, 다른 스킬 본문(learn의 "load improve-skill")은 Skill 호출을 유도함

## 검사

- `claude plugin test ~/.agents/plugins/decision`: 64 pass / 0 fail. 새 테스트 `the Skill tool loads a routed skill instead of refusing it as a built-in command` 포함
- `claude plugin validate`: passed with warnings(README/directory 경고만)
- `tsc -p`: `register.ts`의 새 훅에는 오류 없음. 테스트 mock 타입 오류는 기존 테스트와 같은 패턴

## Backlog

- 적용하려면 `claude plugin update decision@agents-local` 필요. 설치 경로가 캐시 `~/.claude/plugins/cache/agents-local/decision/0.3.5`임
- 적용 후 확인: 새 세션에서 `Skill(improve-skill)`이 본문을 싣는지, `decision audit`에서 `used` 신호가 붙는지
- 프롬프트 힌트 문구 "not in the Skill tool: … Read the SKILL.md"는 업데이트 뒤 "Skill 도구나 Read로" 같이 고칠 수 있음(지금은 그대로 둬도 Read 경로가 동작함)
