# 캐시 비용 계산식과 호출 시점

## 결론

| 질문 | 답 |
|---|---|
| 캐시가 깨지면 더 비싼가 | **그렇다.** DeepSeek V4.1 Flash는 캐시 읽기가 입력가의 2%라, 한 번 깨질 때 그 길이만큼 **50배** 비싸게 낸다 |
| 구독이라도 상관있나 | **있다.** OpenCode Go 한도는 모델별 달러(월, 5시간 20%, 주 50%)라 토큰 비용이 곧 한도 소모 |
| 측정 기준선 (7일) | 캐시 적중 **96.3%** · break 167건 · break 초과 비용 **$18.8 (9.6%)** · 모델 전환 7건 ~$1.2 |
| 이번에 고친 것 | rule·skill은 **턴 메시지·tool 결과로만** 전달, skill 카탈로그는 **세션 첫 턴에 한 번 고정**, find_tool auto는 **30k 토큰 위에서 보류** |
| 검증 | 3턴 세션에서 turn 2→3 system prompt **바이트 동일**(새 rule을 받았는데도), turn 3 비용 $0.0002 vs 깨진 turn 2 $0.0034 |
| prefix를 바꿔도 되는 때 | 세션 첫 턴, compaction 직후, premium → 하위 모델 하향(즉시 이득) |
| 정기 개선 | 주 1회 `bun cache-report.ts --days 7`, 목표 적중 ≥ 96%·break 초과 ≤ 5% |

## 2. 요청 한 번의 비용

pi 세션 `usage`가 요청마다 `input`(캐시 안 됨), `cacheRead`, `cacheWrite`, `output`과 달러 비용을 남긴다. 한 요청의 한도 소모는:

```text
c = (U·p_in + R·p_cr + W·p_cw + O·p_out) / 1e6

U  캐시 안 된 입력 토큰     p_in   입력 단가 ($/1M)
R  캐시 읽기 토큰           p_cr   캐시 읽기 단가
W  캐시 쓰기 토큰           p_cw   캐시 쓰기 단가 (표에 없으면 0)
O  출력 토큰                p_out  출력 단가
r = p_cr / p_in             캐시 할인율
```

| 모델 (Go) | p_in | p_cr | r | 1/r − 1 | 월 한도 | 5시간 한도 |
|---|---|---|---|---|---|---|
| DeepSeek V4.1 Flash, Off-Peak | 0.15 | 0.003 | 0.02 | 49 | $80 | $16 |
| DeepSeek V4.1 Flash, Peak | 0.30 | 0.006 | 0.02 | 49 | $80 | $16 |
| Grok 4.7 (≤ 200K) | 2.00 | 0.50 | 0.25 | 3 | $15 | $3 |
| Qwen3.8 Flash | 0.15 | 0.016 | 0.107 | 8.4 | $30 | $6 |

`1/r − 1`이 클수록 캐시가 깨질 때의 손해가 크다. 지금 기본 사다리(quick/standard/high)는 전부 DeepSeek V4.1 Flash라 손해 배율이 가장 크다.

## 3. 캐시가 깨질 때의 비용

prefix 순서는 tool 정의 → system prompt → 대화다. 앞쪽이 한 글자라도 바뀌면 그 뒤 전체가 미스다.

```text
깨짐 비용     ΔC_break = N · (p_in − p_cr) / 1e6        N: 바뀐 지점 뒤의 토큰(대개 컨텍스트 전체)
축소 이득     ΔC_trim  = ΔS · p_cr / 1e6  (요청마다)    ΔS: 줄인 토큰
본전 요청 수  k* = ΔC_break / ΔC_trim = (N / ΔS) · (1/r − 1)
```

| 상황 (ΔS = 3.2k, skill 카탈로그 축소분) | N | DeepSeek k* | Grok k* |
|---|---|---|---|
| 세션 첫 턴 | ~0 (캐시 없음) | **0, 즉시 이득** | 0 |
| 대화 중 | 10k | 153 요청 | 9 |
| 대화 중 | 30k | 459 요청 | 28 |
| 대화 중 | 100k | 1,531 요청 | 94 |

대화 도중 system prompt를 바꾸는 것은 DeepSeek에서 사실상 손해만 본다. 그래서 스킬 목록은 첫 턴에 한 번만 줄이고, 그 뒤로 고른 rule과 skill은 메시지로만 보낸다. 메시지로 보내면 비용은 본문 토큰 × p_in 한 번이고, 다음 요청부터는 캐시된다.

## 4. 모델 전환 비용

model_route가 tier를 바꾸면 새 모델의 캐시는 비어 있다.

```text
전환 비용     N · p_in(B) / 1e6
요청당 차이   N · (p_cr(A) − p_cr(B)) + O · (p_out(A) − p_out(B))
본전 요청 수  ≈ p_in(B) / (p_cr(A) − p_cr(B))        (출력이 작을 때)
```

| 전환 | 본전 | 판단 |
|---|---|---|
| Grok → DeepSeek (하향) | 0.15 / 0.497 ≈ **0.3 요청** | 컨텍스트가 커도 **즉시 하향이 이득** |
| DeepSeek → Grok (상향) | 회수 안 됨 (Grok 캐시가 더 비쌈) | 품질 때문일 때만. N=50k면 첫 요청 $0.10 = Grok 5시간 한도 3.3% |
| DeepSeek 사이 thinking 변경 | 모델 동일 | prefix 영향 없음으로 가정 (Backlog에서 확인) |

지금 `models.route.holdDowngradeAboveTokens: 30000`은 30k 위에서 하향을 보류한다. 이 설정은 같은 가격대 모델끼리 오갈 때만 맞고, Grok → DeepSeek 하향에는 오히려 손해다. 가격을 보고 판단하는 규칙으로 바꾸는 일은 Backlog에 넣었다.

## 5. decision 호출 자체의 비용

decision의 Jev 호출은 구독이 아니라 OpenRouter 종량제다. 비용은 다음과 같다.

| 항목 | 값 |
|---|---|
| find_skill eval 59건 | $0.0076 → 프롬프트당 약 $0.00013 |
| 프롬프트당 Jev 호출 | find_skill 1–2 + model_route 1 + find_tool 1 ≈ $0.0004–0.0005 |
| 비교: DeepSeek 요청 1회 (30k 캐시, 1k 신규, 300 출력) | ≈ $0.0004 |

decision 오버헤드는 대략 "메인 요청 1회분/프롬프트"이다. 건너뛰기 규칙(slash, ack, 짧은 후속)과 스크립트 우선 매칭(touch는 Jev 0회)이 이 비용을 줄인다.

## 6. 언제 바꿔야 최적인가

| 변경 | 최적 시점 | 금지·보류 |
|---|---|---|
| skill 카탈로그 축소 | **세션 첫 사용자 턴** (구현됨) | 대화 중 재축소 |
| routed rule 전달 | **언제든**, 턴 메시지·tool 결과로 (구현됨) | system prompt 주입 |
| compaction 후 rule 재전달 | **compaction 직후 첫 턴** (구현됨) | — |
| find_tool auto 도구 추가 | 컨텍스트 ≤ 30k (구현됨) | 30k 초과는 보류, 모델이 `find_tool`을 직접 부를 때만 |
| premium → 하위 하향 | **즉시** | 토큰 기준 보류 (현행, Backlog) |
| 상향 | 품질이 필요할 때만 | 같은 세션 왕복 |
| 대량 작업 (eval, 긴 리팩터) | DeepSeek **Off-Peak**: 평일 KST 13–15시, 19시–다음날 10시, 주말 종일 | Peak (평일 KST 10–13시, 15–19시)는 단가 2배 |

## 7. 검증

```text
3턴 세션 (opencode-go/deepseek-v4.1-flash, thinking off)
turn  system prompt     cacheRead   input    비용
1     16,553 B          2,048       21,342   $0.00321   첫 턴, 캐시 없음
2     16,806 B (+tool)  2,048       22,293   $0.00343   web_enable 도구가 생겨 깨짐*
3     turn 2와 동일     24,320         292   $0.00020   새 rule(provider-errors)을 받았지만 동일
```

\* turn 2의 차이는 decision이 아니라 pi-web-access의 `web_enable` 도구다. 새 `pi -p` 프로세스로 세션을 이어 열 때 생겼다(아래 Backlog 참고).

touch 경로도 확인했다. `docs/agent-rules.md`를 `read`하자 tool 결과 끝에 `docs-archive` rule이 붙었고, Jev는 호출하지 않았다. daemon 응답 시간은 3 ms였다.

## 8. 정기 개선 계획

```text
주 1회 (decision audit 7d와 같은 날)
  bun ~/.local/share/scripts/dev/decision/cache-report.ts --days 7
    → 적중률, break 수·초과 비용, 모델별 순위, 모델 전환 비용
  목표: 적중 ≥ 96%, break 초과 ≤ 5% (기준선 9.6%)
  초과 시: 상위 모델의 break 직전 entry(decision-*, setActiveTools, model_change, compaction)를 보고 원인 분류

월 1회
  opencode.ai/docs/go 단가표 갱신 → §2, §3, §4 표 다시 계산
  holdDowngradeAboveTokens, findTool.holdAboveTokens를 k* 기준으로 재조정
```

| 기준선 상위 (7일) | break | 초과 비용 | 다음에 볼 것 |
|---|---|---|---|
| openai-codex/gpt-5.6-sol | 28 | $10.52 | compaction인지 prefix 변경인지 |
| openai-codex/gpt-6-astra | 10 | $5.58 | 같음 |
| xai/grok-4.6 | 8 | $2.08 | 같음 |
| opencode-go/muse-spark-1.3-contributor | 112 | $0.61 | 건수가 가장 많음: 서브에이전트·짧은 세션 패턴 |
| opencode-go/deepseek-v4.1-flash | 3 | $0.03 | — |

## Backlog

- **가정: 같은 모델에서 thinking 수준만 바꾸면 prefix 캐시가 유지된다.** 확인: tier quick→high 전환이 있는 세션에서 `cache-report`가 전환 직후 요청의 `cacheRead`를 유지하는지 본다.
- **가정: break에는 compaction이 섞여 있다.** compaction은 피할 수 없는 break다. 확인: `cache-report`가 break 직전 entry 종류를 함께 출력하게 만든다.
- **가정: `web_enable`이 생긴 것은 `pi -p`로 세션을 다시 열 때만 생기는 일이다.** 확인: 인터랙티브 세션 3턴의 capture를 비교한다.
- **할 일: 하향 보류 규칙을 가격 기준으로 바꾼다.** `holdReason`이 토큰 수 대신 §4의 본전 요청 수로 판단하게 한다. Grok → DeepSeek은 보류하지 않는다.
- **할 일: Claude Code 쪽 측정.** Claude Code 구독은 단가가 다르고, 세션 기록에 cache 필드가 따로 있다. 같은 방식의 리포트가 필요한지 정한다.
- **열린 질문:** decision 오버헤드(프롬프트당 Jev 약 $0.0004)를 줄이려고 find_tool auto를 기본으로 끌 것인가.

## Sources

- OpenCode Go 사용 한도와 단가표: https://opencode.ai/docs/go (2026-10-18 조회)
- 기준선: `cache-report.ts --days 7` (2026-10-18, pi 세션 90개)
- 검증 세션: scratchpad `sess/` 아래 3턴 세션과 touch 세션, `decision-find-skill` entry
- 구현: `~/.pi/agent/extensions/decision/{index,skills,config}.ts`, `~/.agents/plugins/decision/hooks/`
