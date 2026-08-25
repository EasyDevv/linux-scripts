# CrowdSec · Falco · auditd 통합 관리 스택 조사

웹 검색과 공식 문서 기준으로, 세 도구를 한 제품으로 설치·정책·알림까지 묶는 스택이 있는지 평가한다. 비밀번호, API 키, Discord webhook은 쓰지 않는다.

관련 운영 문서: [260821-early-warning-study.md](260821-early-warning-study.md). 이 호스트의 알림 버스는 `early-warning`의 `vps-alert`다.

검색일: 2026-08-21.

## 결론

**그런 공식 통합 제품은 없다.** 업계 관행은 역할이 다른 도구를 로그로 이어 붙인 레이어다.

| 도구 | 하는 일 | 하지 않는 일 |
|---|---|---|
| CrowdSec | 로그/HTTP 행동 → IP 결정 → nft/bouncer | 커널 런타임 HIDS가 아님 |
| Falco | eBPF syscall 규칙 → 실시간 탐지 | 방화벽/커뮤니티 블록리스트가 아님 |
| auditd | 커널 감사 로그 (파일/설정 변경 등) | 상관·차단 엔진이 아님 |

“통합 관리 스택”이라고 불리는 것들은 보통 **SIEM이 세 소스의 로그를 받는 구성**이지, 세 데몬을 대체하는 제품이 아니다.

## 이름이 헷갈리는 것들

### CrowdSec Security Stack

CrowdSec 자사 제품군이다. Console + Security Engine + Remediation(bouncer) + AppSec(WAF). 공식 페이지에 Falco/auditd는 없다.

신뢰도 **높음**. 출처: [crowdsec.net/security-engine](https://www.crowdsec.net/security-engine)

### CrowdSec Hub `crowdsecurity/auditd`

CrowdSec이 auditd 로그를 파서/시나리오로 **소비**하는 컬렉션이다. Falco 관리가 아니다. `cscli collections install crowdsecurity/auditd`. CrowdSec 1.5+ 필요. `cscli setup`의 auditd 감지 PR도 있다.

신뢰도 **높음**. 출처: [Hub auditd collection](https://app.crowdsec.net/hub/author/crowdsecurity/collections/auditd), [crowdsecurity/crowdsec#3917](https://github.com/crowdsecurity/crowdsec/pull/3917)

### Falcosidekick

Falco 알림 팬아웃이다. Discord, syslog, Elasticsearch, webhook, Falco Talon 등. 공식 output 목록에 **CrowdSec은 없다**.

신뢰도 **높음**. 출처: [Falco forwarding docs](https://falco.org/docs/concepts/outputs/forwarding/), [falcosecurity/falcosidekick](https://github.com/falcosecurity/falcosidekick)

## 가장 가까운 “통합” 후보

### Wazuh (SIEM/XDR)

- Falco: 공식 블로그. JSON 파일 → agent `localfile` → 커스텀 룰. 네이티브 플러그인이 아니라 **로그 수집 글루**.
  신뢰도 **높음**. 출처: [wazuh.com/blog/cloud-native-security-with-wazuh-and-falco](https://wazuh.com/blog/cloud-native-security-with-wazuh-and-falco)
- auditd: 공식 syscall 모니터링 문서.
  신뢰도 **높음**. 출처: [Wazuh audit configuration](https://documentation.wazuh.com/current/user-manual/capabilities/system-calls-monitoring/audit-configuration.html)
- CrowdSec: 홈랩 글에서 “Wazuh가 관제, CrowdSec이 차단”으로 병행. Wazuh 1st-party가 아님.
  신뢰도 **중간**. 출처: [swatto.co.uk](https://swatto.co.uk/articles/self-hosting-with-wazuh-and-crowdsec/), [pichler.dev](https://pichler.dev/blog/enterprise-monitoring-siem/)

Wazuh Docker 권장 대략 4코어/6GB. 단일 VPS 얼리워닝보다 무겁다.

### Security Onion

Zeek/Suricata 중심 NSM. 스탠드얼론 최소 RAM 24GB 급. CrowdSec+Falco 통합 제품이 아니다.

신뢰도 **높음** (요구 스펙) / **이 VPS에는 부적합**. 출처: [Wazuh vs Security Onion 비교 글](https://tech.breakingcube.com/2026/05/03/wazuh-vs-security-onion-open-source-siem-comparison/)

### Elastic Security

Falco는 Falcosidekick → Elasticsearch가 공식. CrowdSec+auditd를 한 제품으로 관리하지는 않는다.

출처: [Elastic CNCF Falco integration](https://www.elastic.co/docs/solutions/security/integrations/cncf-falco)

### Sysdig

Falco 상용 쪽. Falco vs auditd 비교는 있어도 CrowdSec 통합 스택은 아니다.

출처: [sysdig.com/blog/falco-vs-auditd-hids](https://www.sysdig.com/blog/falco-vs-auditd-hids)

## 신뢰도 요약

| 주장 | 평가 |
|---|---|
| CrowdSec+Falco+auditd를 한 벤더가 관리하는 제품은 없다 | **높음** — 공식 문서에 그런 제품이 없고, 모두 ingest/forward 글루 |
| CrowdSec 브랜드 “Security Stack”은 CrowdSec 전용 | **높음** |
| CrowdSec은 auditd 로그를 먹을 수 있다 | **높음** |
| Falco를 CrowdSec이 네이티브로 관리한다 | **낮음/없음** — Hub/Falcosidekick에 없음 |
| Wazuh가 Falco+auditd 상관 평면이 될 수 있다 | **높음** (공식). CrowdSec까지는 **중간** |
| 홈랩 글의 “Wazuh+CrowdSec+Falco”는 레퍼런스 아키텍처 | **중간** — 재현 가능하나 제품 보증 없음 |

## 이 호스트에 대한 함의

`early-warning`은 이미 그 글루다. CrowdSec 결정, Falco HTTP, auditd watch, journal을 `vps-alert` 정책(즉시/스로틀/ERROR+ 멘션)으로 Discord에 모은다.

Wazuh/Elastic로 바꾸면 대시보드·검색·상관은 생기고, 설치 면적·RAM·룰 유지비가 커진다. 차단은 여전히 CrowdSec bouncer 몫이다. 단일 ovh-vps + Discord 채널이면 벤더 통합 스택으로 갈아탈 근거는 약하다.

## 추가 검색 출처

- [github.com/crowdsecurity/crowdsec](https://github.com/crowdsecurity/crowdsec/)
- [falco.org](https://falco.org/), [github.com/falcosecurity/falco](https://github.com/falcosecurity/falco)
- [ossalt.com Wazuh vs CrowdSec vs Suricata](https://ossalt.com/guides/wazuh-vs-crowdsec-vs-suricata-2026)
- [krvtz.net Wazuh vs CrowdSec](https://krvtz.net/en/posts/comparison-between-wazuh-and-crowdsec.html)
- [safeguard.sh Falco 2026 deploy](https://safeguard.sh/resources/blog/falco-runtime-security-deploy-2026)
