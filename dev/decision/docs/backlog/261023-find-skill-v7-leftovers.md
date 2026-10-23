# find_skill v7 남은 약점

## 결론

라이브는 find_skill v7, find_tool v6 이다(261023 승격). 아래 네 가지는 확인했지만 고치지 않았다. 각 항목의 확인 방법으로 재현한 뒤 다음 버전에서 다룬다. 경위는 [261023-design-intent](../plan/261023-design-intent.md) Changelog 에 있다.

| # | 약점 | 영향 | 확인 방법 |
|---|---|---|---|
| 1 | #0 `$effect가 리셋돼`: svelte-effects 가 0.40↔0.64 로 흔들린다 | 실행마다 주입 여부가 바뀐다 | `decision eval --feature find_skill --version v7 --all` 3회, 케이스 #0 의 svelte-effects p |
| 2 | 키워드 폴백은 한↔영 동의어를 매칭하지 않는다 | Jev 장애 중 한국어 프롬프트는 힌트가 거의 없다 | `features/find-skill.test.ts` 에 한국어 프롬프트 폴백 케이스 추가 |
| 3 | `decision eval` 출력의 `got` 이 잘린다 | 케이스별 분석을 로그(`log-YYMMDD.jsonl`, `harness: eval`)로 우회해야 한다 | `eval --json` 으로 전체 got 을 내보내는지 확인 |
| 4 | seed eval 1–4번 라벨이 일반 Svelte 화면 작업에 svelte-effects 를 기대한다 | `skills:` 연결을 끊은 뒤에는 라벨과 라우팅 정책이 어긋난다(recall 영향은 미측정) | 라벨 정책 결정: "$effect 를 다룰 때만" 이면 라벨을 고친다 |

## 근거

- **1.** v8 시도 두 가지(규칙 전용 apply 질문, 증상 일반화 문구)는 recall 을 −0.011 ~ −0.031 낮춰 버렸다.
- **4.** svelte-effects 과잉의 원인은 프롬프트가 아니라 `rules-routed/svelte-effects.md` 의 `skills: [build-frontend]` 였다. 연결을 끊었으므로 라벨과 정책이 어긋난다.

## Backlog

- 4번 라벨 정책을 사용자에게 확인한다.
- 3번은 eval 출력 폭 수정(작은 코드 변경)이다.
- 2번은 동의어 표를 둘지, 폴백에서도 description 임베딩을 쓸지 정한다.
