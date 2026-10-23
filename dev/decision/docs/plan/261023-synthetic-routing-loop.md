# 합성 시나리오 라우팅 자가개선 루프

## Intent

- **Problem**: find_skill 과 find_tool 은 라벨 eval 63+26 건으로만 튜닝돼 왔다. 실제 에이전트가 무엇을 받고 무엇을 썼는지, 놓친 것과 불필요했던 것을 여러 상황에서 본 적이 없다.
- **Outcome**: 합성 시나리오를 실제 에이전트 세션으로 돌린다. 세션마다 "주입됨/안 됨 × 실제로 필요했음/불필요했음"을 판정하고, 일반화되는 개선만 다음 프롬프트 버전(find_skill v8, find_tool 다음 버전)에 반영한다. holdout 에서 회귀가 없음을 보인다.
- **Affected**: `prompts/find_skill/`, `prompts/find_tool/`, `evals/*.jsonl`, 새 `evals/synthetic/`, `docs/eval/`. 이 루프에서 스킬 description 은 수정하지 않는다(AGENTS.md: 라우팅 지식은 라우터 쪽).
- **Constraints**:
  - [AGENTS.md](../../AGENTS.md) "Design intent" 를 따른다. 놓침이 과잉보다 나쁘고, 품질이 우선이며, find_skill 지연은 약 3초까지다.
  - 라이브 데몬(`decision.service`, 45130)과 `~/.config/decision/config.json` 은 건드리지 않는다. 그림자 데몬으로만 돌린다(아래 참고).
  - 프롬프트 승격, 커밋, 서비스 재시작은 하지 않는다. 최종 승격은 사용자가 결정한다.
  - **과적합 방지**:
    - 시나리오를 train/holdout 으로 6:4 나누고, holdout 은 개선 중에 보지 않는다.
    - 개선은 일반 규칙(criteria 문구, limits)으로만 한다. 특정 스킬 이름이나 시나리오 문구를 프롬프트에 넣지 않는다.
    - 같은 실패가 서로 다른 시나리오 2개 이상에서 나와야 개선 대상으로 삼는다.
    - 기존 `evals/find_skill.jsonl`, `evals/find_tool.jsonl` 에서도 회귀가 없어야 한다.
  - 실제 세션의 부작용 금지:
    - 시나리오 세션은 일회용 복사본(`git worktree` 나 스크래치 디렉터리 복제)에서만 돌린다.
    - dashboard dispatch, executor, 실제 배포처럼 공유 상태를 바꾸는 명령은 금지한다.
- **Out of scope**: model_route, guard, loop. 스킬 본문 수정.
- **Confirmed** (261023, 사용자): find_skill·find_tool 대상, 실제로 부른/부르지 않은 내용으로 필요·불필요를 판정, 과적합 유의, sonnet 오케스트레이션.

## 환경

- **그림자 데몬.**
  - `S=<스크래치>/shadow` 아래 `cfg/decision/config.json` 을 만든다. 내용은 `{"port": 45131, "prompts": {"find_skill": "v7"}}` 이고, `~/.config/decision/tiers.json` 도 같은 곳에 복사한다.
  - 실행: `XDG_CONFIG_HOME=$S/cfg XDG_STATE_HOME=$S/state bun main.ts serve` 를 백그라운드로 띄운다.
  - 인증은 `~/.pi/agent/auth.json` 과 `~/.config/fish/.env` 에서 그대로 읽는다.
- **클라이언트 연결.** 시나리오 세션에 `DECISION_URL=http://127.0.0.1:45131` 을 준다.
  - Claude: `claude -p --model sonnet --max-turns 6`, 프롬프트는 stdin 으로 넣는다.
  - pi: `pi -p`. find_tool 은 pi 에서만 동작한다.
- **판정 근거.**
  - `XDG_STATE_HOME=$S/state bun main.ts audit` 로 그림자 로그와 트랜스크립트를 잇는다(injected, used, missed).
  - 세션 트랜스크립트에서 실제로 Read 한 SKILL.md, 호출한 도구, 질문했는지를 확인한다.

## 절차

1. **시나리오 생성.** find_skill 약 40개, find_tool 약 20개를 `evals/synthetic/` 에 jsonl 로 만든다(eval case 형식, CONTRACTS.md "Eval case"). 다양성 축(각 축이 최소 3개씩 나오게):
   - 한국어/영어/혼용
   - 짧은 후속 답변, 질문 도구에 대한 답
   - 붙여 넣은 페이로드(JSON, 로그, 스택트레이스)
   - 스킬 2개가 필요한 작업, 해당 스킬이 없는 일반 질문
   - 실행 중 앱 오류, 프로젝트 경로 언급
   - 주제만 겹치는 함정

   라벨은 "이 작업에 실제로 필요한 것"이다. 카탈로그(`~/.agents/skills-routed`, `~/.agents/rules-routed`)를 읽고 정하되, 애매한 라벨에는 `note` 를 단다. 그 뒤 6:4 로 나누어 `train.jsonl`, `holdout.jsonl` 을 만든다.
2. **오프라인 기준선.**
   - `bun main.ts eval --feature find_skill --version v7 --cases evals/synthetic/train.jsonl --all`
   - find_tool 도 현재 버전으로 같은 방식으로 돌린다.
3. **실제 세션.** train 에서 대표 시나리오 약 12개를 골라 그림자 데몬에 연결된 sonnet 세션(read 위주, max-turns 6)으로 돌린다. 시나리오마다 주입된 것, 실제로 읽거나 쓴 것, 필요했는데 없던 것, 주입됐지만 불필요했던 것을 표로 정리한다. 라벨이 틀렸으면 라벨을 고친다(이유는 note 에).
4. **개선.** 여러 시나리오에 반복되는 실패 패턴만 일반 규칙으로 바꿔 v8(find_skill), 다음 버전(find_tool)에 반영한다. 프롬프트 파일의 `source` 에 근거를 남긴다.
5. **검증.**
   - holdout, 기존 eval 전체, train 에서 각각 `--against v7`(find_tool 은 현재 버전) 비교를 돌린다.
   - 채택 조건: holdout recall 무회귀, 기존 eval recall 무회귀, p95 ≤ 3000 ms. precision 하락은 보고만 한다.
   - 채택 조건을 못 맞추면 해당 변경을 버리고, 왜 버렸는지 기록한다.
6. **보고.** `docs/eval/261023-synthetic-loop.md` 에 다음을 남긴다.
   - 시나리오 분포
   - 실제 세션 표
   - 채택하거나 버린 변경과 근거
   - holdout 수치
   - 승격 권고. 승격 자체는 하지 않는다.

   마지막으로 그림자 데몬을 종료한다.

## 멈춤 조건

- 그림자 데몬이 Jev 에 연결되지 못하면, 2회 재시도 후 원인을 보고하고 멈춘다.
- 시나리오 세션이 공유 상태를 바꾸려 하면 즉시 중단하고 보고한다.
- 개선 2회 반복 후에도 holdout 이 나아지지 않으면 거기서 멈추고 보고한다.

## Changelog

- 261023: 작성(사용자 요청: 합성 시나리오, 자가개선, 과적합 유의, sonnet 오케스트레이션).
