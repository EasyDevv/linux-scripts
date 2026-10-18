# 프로젝트 rule 라우팅 지정

## 결론

| 질문 | 답 |
| --- | --- |
| 무엇을 옮겼나 | 공유 `applyTo: "*"` 8개 전부 + 프로젝트 전용 9개 → **rules-routed** |
| 무엇을 남겼나 | 글롭 rule(`architecture`, `bun`, `project-name`, `stash-ui`) + 저장소 전체 사실(`setting-book`, dashboard `design-themes`) |
| 상시 로드 감소 | 16개 프로젝트 합계 약 **85 KB**(프로젝트당 1.1–11.9 KB) |
| 새 프로젝트 | dashboard 템플릿이 `description:` 있는 rule을 `.agents/rules-routed/`에 링크 |
| 검증 | dashboard `projects::` 테스트 **92/92 통과**(이전 74/92), 실 daemon 7건 중 7건 기대 rule 선택 |
| 다음 | eval 6건 반영, `/`로 시작하는 경로 프롬프트 skip 수정, Claude Code의 `applyTo` 처리 확인 |

## 2. 공유 템플릿 (`~/.agents/rules-optional`)

공유 rule은 symlink라 원본 frontmatter 한 번으로 모든 프로젝트가 바뀐다.

| rule | 이전 | 이후 | 이유 |
| --- | --- | --- | --- |
| `stack-svelte` | 상시 | routed, `skills: [build-frontend]`, `paths: src/**` 등 | 코드 작업에만 필요 |
| `stack-svelte-rust` | 상시 | routed, `skills: [build-frontend, build-backend]`, `paths: apps/client/**, apps/server/**` | 같은 이유, 2.2 KB |
| `stack-svelte-tauri` | 상시 | routed, `paths: apps/native/**` | 네이티브 작업에만 필요 |
| `stack-svelte-wxt` | 상시 | routed, `skills: [build-frontend]`, `paths: src/**, entrypoints/**` | 코드 작업에만 필요 |
| `cmd.executor` | 상시 | routed | 서비스 제어·로그 작업에만 |
| `cmd.db-owl` | 상시 | routed | DB 조회·수정에만 |
| `browser-extension` | 상시 | routed, `paths: src/entrypoints/**` | 확장 API·팝업 작업에만 |
| `doc` | 상시 | routed | 문서 조회에만(현재 링크한 프로젝트 없음) |
| `architecture` | 글롭 | **유지** | 이미 코드 파일 글롭으로 붙음 |
| `bun` | 글롭 | **유지** | 같은 이유 |

`paths`는 이번에 추가하는 하이브리드 트리거 필드다. daemon이 프롬프트 속 경로와 만진 파일로 먼저 매칭한다.

## 3. 프로젝트별 결과

```text
프로젝트            routed로 이동                                   남은 상시/글롭
postdock          stack-svelte-rust cmd.executor                 architecture
novel-writer      stack-svelte-rust cmd.executor cmd.db-owl      architecture setting-book
                  draft-logic-tests prompt-assembly
jegap             stack-svelte-rust cmd.executor cmd.db-owl      architecture
property-portal   stack-svelte-rust stack-svelte-tauri           architecture project-name
                  cmd.executor cmd.db-owl ovh-vps units-list
                  vite-api-proxy
my-voice          stack-svelte-rust stack-svelte-tauri           architecture
                  cmd.executor cmd.db-owl
quant/research    stack-svelte-rust cmd.executor cmd.db-owl      architecture
sns-publisher     stack-svelte cmd.executor                      architecture skill(깨진 링크)
my-blog           stack-svelte cmd.executor                      architecture
dev-selector      stack-svelte-wxt                               architecture
ebook-scroller    stack-svelte-wxt browser-extension             architecture bun skill(깨진 링크)
scroll-detox      stack-svelte-wxt                               architecture
capture           stack-svelte-wxt                               architecture
private/quant     stack-svelte-rust cmd.executor cmd.db-owl      architecture
stash             stack-svelte-rust cmd.executor cmd.db-owl      architecture stash-ui
dashboard         stack-svelte-tauri cmd.executor cmd.db-owl     architecture design-themes
                  design-preview product-loop→product-loop-dashboard
tampermonkey      userscript-buttons userscript-observers        architecture
scripts, pi       변화 없음(이미 글롭 또는 routed)
```

그래서 Svelte+Rust 프로젝트는 매 턴 약 4.5–6 KB를 덜 싣는다.

## 4. 프로젝트 전용 rule 판정

| 프로젝트 | rule | 판정 | 이유 |
| --- | --- | --- | --- |
| novel-writer | `draft-logic-tests` | routed, `paths: .product/lib/**, tests/unit/**` | 초안 로직·단위 테스트 작업에만 |
| novel-writer | `prompt-assembly` | routed, `paths: apps/server/src/prompt/**` | 2.5 KB, 프롬프트 조립 작업에만 |
| novel-writer | `setting-book` | **상시 유지** | 350 B, 모든 문구 작성에 적용 |
| property-portal | `ovh-vps` | routed, `paths: scripts/deploy/**` | 배포·호스트 작업에만 |
| property-portal | `units-list` | routed, `paths: apps/server/src/handlers/units.rs` | 한 API에만 |
| property-portal | `vite-api-proxy` | routed, `paths: apps/client/vite.config.ts` | 개발 프록시 문제에만 |
| property-portal | `project-name` | **글롭 유지** | 이미 `applyTo` 파일 글롭 |
| stash | `stash-ui` | **글롭 유지** | 이미 `applyTo: apps/client/**` |
| dashboard | `design-preview` | routed | 2.3 KB, `/design` 프리뷰 작업에만 |
| dashboard | `product-loop` | routed, **이름 변경** `product-loop-dashboard`, `skills: [shape-product-loop]` | 같은 이름이면 전역 routed `product-loop`를 가림 |
| dashboard | `design-themes` | **상시 유지** | 전역 routed와 같은 이름 + learn의 theme 게이트가 이 경로를 확인 |
| tampermonkey | `userscript-buttons`, `userscript-observers` | routed | 각자 버튼·옵저버 작업에만 |

본문은 그대로 두고 frontmatter만 바꿨다.

## 5. dashboard 템플릿

```text
set-rules.json (변경 없음) ─► link_instructions
                              │ 원본 frontmatter에 description: ?
                              ├─ 예 ─► .agents/rules-routed/<name>
                              └─ 아니오 ─► .agents/rules/<name>
```

- `template.rs`: `rule_link_dir()` 추가. 라우팅 여부의 출처는 rule 파일 하나다.
- `catalog.rs`: 기본 경로 `rules-ready`·`skills-ready`(삭제됨) → `rules-optional`·`skills-optional`. 이전 18개 테스트 실패의 원인이었다.
- `tests.rs`: 경로 상수와 routed 위치 기대값 갱신.

`cargo test -p dashboard --lib projects::` → `92 passed; 0 failed`.

## 6. 실 daemon 확인

| cwd | 프롬프트 요지 | 선택 |
| --- | --- | --- |
| property-portal | executor 재시작·로그 | `cmd.executor` 0.99 |
| property-portal | ovh-vps Caddy 서브도메인 | `ovh-vps` 0.98 |
| tampermonkey | MutationObserver 재바인딩 | `userscript-observers` 0.99, `userscript-buttons` 0.95 |
| ebook-scroller | Firefox Android 옵션 페이지 | `browser-extension` 0.90, `stack-svelte-wxt` 0.63 |
| stash | apps/server API 추가 | `stack-svelte-rust` 0.97 + skill `build-backend` |
| dashboard | 디자인 프리뷰 iframe 깜빡임 | `design-preview` 0.98 |
| jegap | README 오타 | 없음 |

## Backlog

- 가정: routed로 바꾼 stack rule이 코드 작업에서 빠지지 않는다. 확인: 제안 eval 6건(`scratchpad/fork-a-evals.jsonl`)을 `evals/find_skill.jsonl`에 넣고 `decision eval --feature find_skill --all`.
- 발견: `/design/draft …`처럼 `/`로 시작하는 경로 프롬프트가 `skipReason`에서 slash command로 skip된다. 확인: 같은 프롬프트를 curl로 보내 `skipped slash command`.
- 발견: dashboard는 `stack-svelte-tauri`만 있고 `stack-svelte-rust` 링크가 없다(tauri rule은 rust rule 전체 적용을 전제). 템플릿은 둘 다 링크한다.
- 발견: sns-publisher, ebook-scroller의 `.agents/rules/skill.md`가 없는 `rules-optional/skill.md`를 가리킨다. 손대지 않았다.
- 열린 질문: Claude Code는 `.claude/rules`의 `applyTo`가 아니라 `paths`를 읽는다. `architecture` 등 글롭 rule이 Claude Code에서 상시 로드되는지 확인 필요.
- 바이트는 routed 파일 크기 합(새 frontmatter 포함)이라 실제 감소량보다 약간 크다.
