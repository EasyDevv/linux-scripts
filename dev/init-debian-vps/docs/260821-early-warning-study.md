# early-warning를 처음부터 이해하기

이 문서는 리눅스와 보안 자동화를 처음 배우는 성인을 위한 학습 문서다. 설명은 12세 학생도 따라올 수 있을 만큼 쉽게 썼지만, 실제 운영 서버에서 지켜야 할 규칙은 가볍게 다루지 않는다.

목표는 명령을 외우는 것이 아니다. **어떤 로그가 생기고, 누가 판단하고, 왜 Discord에 어떤 모양으로 도착하는지**를 이해하는 것이다.

> 주의: 이 문서에는 비밀번호, API 키, Discord webhook 주소를 쓰지 않는다. 그런 값은 저장소와 Discord 메시지에 남기면 안 된다.

---

## 1. early-warning은 무엇인가

VPS는 여러 프로그램이 함께 사는 리눅스 서버다.

- SSH는 원격 터미널 접속을 받는다.
- Caddy는 웹 요청을 받는다.
- CrowdSec은 공격 패턴을 찾는다.
- auditd는 중요한 파일이 바뀌었는지 기록한다.
- Falco는 이상한 프로세스 행동을 찾는다.
- journald는 여러 프로그램의 로그를 모은다.

로그가 많다고 모두 사람에게 보내면 알림이 금방 시끄러워진다. 그러면 정말 중요한 알림도 놓치게 된다.

`early-warning`은 다음 일을 하는 작은 방어 모듈이다.

1. 로그를 읽는다.
2. 로그의 종류를 이름 붙인다.
3. 심각도와 사건 종류를 보고 보낼지 결정한다.
4. 너무 자주 반복되는 알림을 줄인다.
5. 선택한 사건을 읽기 쉬운 Discord Rich Embed로 보낸다.

---

## 2. 전체 흐름

각 로그 공급자는 자기 역할만 한다. 최종 Discord 전송과 정책 판단은 `vps-alert`가 맡는다.

```text
+-------------------+       +-----------------------+
| SSH, Caddy,       |       | journald              |
| CrowdSec, NetBird | ----> | system log collector |
+-------------------+       +-----------+-----------+
                                         |
                                         v
                              +----------+-----------+
                              | vps-journal-watch   |
                              | classify + aggregate|
                              +----------+-----------+
                                         |
+-------------------+                     |
| auditd            | ---> vps-audit-plugin       |
+-------------------+                     |
                                         v
+-------------------+          +---------+----------+
| Falco             | -------> | /usr/local/sbin/   |
+-------------------+          | vps-alert          |
                              | policy + throttle  |
                              | Rich Embed builder |
                              +---------+----------+
                                        |
                                        v
                              +---------+----------+
                              | Discord webhook    |
                              | #audit channel     |
                              +--------------------+
```

CrowdSec decision은 HTTP 요청으로 `vps-journal-watch`의 작은 수신 창구에도 들어온다.

```text
+----------+       POST 127.0.0.1:8766       +---------------------+
| CrowdSec | ------------------------------> | CrowdsecHandler     |
+----------+                                 | event=decision      |
                                             +----------+----------+
                                                        |
                                                        v
                                             +----------+----------+
                                             | vps-alert -> Discord|
                                             +---------------------+
```

`127.0.0.1`은 서버 자기 자신을 뜻한다. CrowdSec의 알림 창구를 인터넷에 공개하지 않는 것이 중요하다.

---

## 3. 파일을 읽는 순서

처음에는 모든 파일을 한 번에 읽지 말고 다음 순서로 읽으면 된다.

| 파일 | 쉬운 설명 |
|---|---|
| `early-warning/files/vps-alert` | 모든 알림이 마지막에 거치는 중앙 모듈. 정책, throttle, Discord Rich Embed를 담당한다. |
| `early-warning/files/vps-journal-watch` | journald에서 SSH 성공, SSH 거절 burst, 서비스 장애를 분류한다. |
| `early-warning/files/vps-audit-plugin` | `authorized_keys`, sshd 설정, nftables 같은 민감한 변경만 고른다. |
| `early-warning/files/vps-falco-alert` | Falco에서 ERROR 이상만 중앙 모듈로 넘긴다. |
| `early-warning/install.sh` | 서버에 파일을 설치하고 systemd를 재시작한다. |
| `early-warning/verify.sh` | 설치 후 포트, 정책, Caddy 격리 상태를 읽기 전용으로 확인한다. |
| `test_alert_policy.py` | 네트워크 없이 알림 정책과 Rich Embed 모양을 검사한다. |

설치 뒤에는 저장소의 파일이 다음 운영 경로로 복사된다.

```text
repository/early-warning/files/vps-alert
                    |
                    | install -m 0755
                    v
          /usr/local/sbin/vps-alert
```

따라서 저장소 파일을 바꿨다고 서버가 즉시 바뀌는 것은 아니다. `apply.sh` 또는 설치 과정을 거쳐야 한다.

---

## 4. 세 가지 서로 다른 개념

### 4.1 severity: 로그의 표준 심각도

severity는 로그가 얼마나 심각한지 나타낸다. `SUCCESS`는 표준 severity가 아니다.

```text
DEBUG       자세한 개발 정보
INFO        정상 동작 정보
NOTICE      알려 둘 만한 정상 상태
WARNING     이상하지만 당장 멈추지는 않음
ERROR       작업 실패
CRITICAL    매우 심각한 실패
ALERT       즉시 사람이 확인해야 함
EMERGENCY   시스템 전체가 위험함
```

### 4.2 outcome: 결과

로그가 성공했는지 실패했는지는 severity와 별도다.

```text
severity=info      outcome=success
severity=critical  outcome=success   <- 성공했지만 허가받지 않은 로그인
severity=error     outcome=failure
severity=error     outcome=denied
```

예를 들어 허가된 사용자의 정상 로그인은 다음처럼 표현한다.

```text
severity=info outcome=success
```

허가되지 않은 계정이 로그인에 성공했다면 결과는 성공이지만 보안 사건이므로 `critical`로 분류한다.

### 4.3 event: 사건의 이름

`event`는 “무슨 일이 일어났는가”를 설명한다.

```text
ssh-login                 허가된 SSH 로그인 성공
ssh-unauthorized-login    허가되지 않은 계정의 로그인 성공
ssh-deny-burst            SSH 거절이 짧은 시간에 많이 발생
crowdsec-decision         CrowdSec이 차단 결정을 냄
firewall-change           방화벽 설정 변경
recovery-path-failure     SSH와 NetBird 복구 경로가 함께 실패
```

세 값을 함께 보면 사람이 판단하기 쉽다.

```text
[event] ssh-login
[severity] info
[outcome] success
```

---

## 5. 알림을 버리는 이유

인터넷에 공개된 SSH에는 봇이 계속 들어온다. 개별 거절을 모두 Discord로 보내면 다음처럼 된다.

```text
봇 1회 -> 알림 1개
봇 2회 -> 알림 1개
봇 3회 -> 알림 1개
...
```

이것은 감시가 아니라 소음이다. 그래서 개별 거절은 모으고, 일정한 크기가 되었을 때만 알린다.

```text
                         +----------------------+
SSH 로그 --------------> | SSH denial tracker   |
                         | 5분 창에 기록        |
                         +----------+-----------+
                                    |
                +-------------------+-------------------+
                |                                       |
       5개 이상의 서로 다른 IP?                전체 20회 이상?
                |                                       |
                +-------------------+-------------------+
                                    |
                              +-----v------+
                              | burst 알림  |
                              | error       |
                              +------------+
```

현재 burst 조건은 다음과 같다.

- 5분 안에 서로 다른 source IP가 5개 이상이거나
- 5분 안에 전체 거절이 20회 이상이면
- `ssh-deny-burst` 하나를 보낸다.
- 같은 burst 알림은 10분 동안 다시 보내지 않는다.

일반적인 낮은 심각도의 Falco WARNING과 서비스 INFO/NOTICE/WARNING도 기본적으로 버린다. ERROR 이상은 중앙 모듈의 표준 정책을 통과한다.

반대로 다음 사건은 severity가 낮아도 중요한 사건이므로 즉시 알림 목록에 들어간다.

- 허가된 SSH 로그인 성공
- 허가되지 않은 계정의 SSH 로그인 성공
- CrowdSec decision
- `authorized_keys`, sshd, nftables 변경
- SSH와 NetBird의 복구 경로 동시 실패

---

## 6. 중앙 정책 모듈

모든 공급자가 Discord webhook 주소와 throttle 규칙을 각각 알면 실수가 늘어난다. 그래서 중앙 모듈인 `vps-alert`를 둔다.

```text
+-------------------+
| event             |
| severity          |
| outcome           |
| body              |
+---------+---------+
          |
          v
+---------+---------+
| vps-alert          |
| 1. should_notify   | -- drop --> 끝
| 2. allow/throttle  | -- drop --> 끝
| 3. build embed     |
| 4. POST webhook    |
+---------+---------+
          |
          v
       Discord
```

여기서 중요한 것은 **drop이 실패가 아니라 정책 결과**라는 점이다. 보낼 필요가 없는 로그를 조용히 끝내는 정상 동작이다.

### throttle

짧은 시간에 똑같은 알림이 반복되지 않도록 사건별로 시간을 둔다.

- SSH 로그인 성공: 별도 throttle 없음. 성공 로그는 고신호 사건이다.
- 설정 변경과 CrowdSec decision: 기본 30초 중복 억제.
- 복구 경로 장애: 5분.
- SSH denial burst: 10분.
- 비중요 알림의 전체 창: 10분에 최대 20개.
- ERROR 이상은 비중요 알림 quota 때문에 막히지 않는다.

상태는 `/var/lib/vps-alert/throttle.json`에 저장되고, 동시 실행 충돌은 `throttle.lock`으로 막는다. 이 파일에는 webhook 주소를 저장하지 않는다.

---

## 7. Discord Rich Embed는 어떻게 보이는가

예전의 평범한 문자열은 다음처럼 한 줄씩 이어져 읽기 어려웠다.

```text
[vps-host] ssh-login severity=info outcome=success
Accepted publickey for debian from 203.0.113.10 port 22 ssh2
```

이제 `vps-alert`는 Discord webhook에 `embeds` payload를 보낸다. Discord가 제목, 색, 필드, 설명을 묶어서 표시한다.

```text
+------------------------------------------------------+
|  [green/blue]  SSH login succeeded                   |
|                                                      |
|  Host       vps-host                                 |
|  Event      ssh-login                                |
|  Severity   INFO          Outcome   SUCCESS          |
|                                                      |
|  Details                                             |
|  +-----------------------------------------------+   |
|  | Accepted publickey for debian ...            |   |
|  | ED25519 fingerprint ...                       |   |
|  +-----------------------------------------------+   |
|                                                      |
|  vps-alert - standard severity + outcome             |
+------------------------------------------------------+
```

색은 severity를 따른다. 제목 아이콘은 event를 빠르게 찾도록 돕는다.

- 성공 로그인: `✅`
- 허가되지 않은 로그인: `🚨`
- CrowdSec: `🛡️`
- SSH burst: `🌊`
- 설정 변경: `🔑`, `⚙️`, `🧱`
- 복구 경로 실패: `🆘`

로그 본문은 `text` 코드 블록 안에 넣는다. 이렇게 하면 로그 안의 괄호나 명령어가 제목처럼 오해되지 않는다. `allowed_mentions`도 비워서 로그 안의 `@everyone` 같은 문자열이 알림을 만들지 못하게 한다.

Rich Embed는 예쁘게 보이기 위한 장식만이 아니다. 제목은 사건을 요약하고, 필드는 판단에 필요한 값을 고정된 위치에 보여 주며, 본문은 원래 로그를 보존한다.

---

## 8. 한 개의 SSH 로그가 처리되는 과정

```text
(1) sshd writes a log
          |
          v
(2) journald stores JSON entry
          |
          v
(3) vps-journal-watch reads MESSAGE
          |
          +--> Accepted publickey?
          |       |
          |       +--> allowed user -> ssh-login / info / success
          |       +--> other user  -> ssh-unauthorized-login / critical / success
          |
          +--> denial?
          |       |
          |       +--> tracker only, until burst threshold
          |
          v
(4) /usr/local/sbin/vps-alert
          |
          +--> policy says drop? -> stop
          +--> throttle says wait? -> stop
          +--> create Discord embed
          |
          v
(5) Discord #audit
```

각 단계가 한 가지 일을 하므로 문제를 찾기 쉽다.

- 로그가 없으면 sshd 또는 journald를 본다.
- 사건 이름이 잘못되면 `vps-journal-watch`를 본다.
- 사건은 생겼지만 메시지가 없으면 `vps-alert`의 정책과 throttle을 본다.
- webhook 요청이 실패하면 서버의 Discord 설정과 네트워크를 확인한다.

---

## 9. 보안상 꼭 지킬 것

### webhook은 비밀번호처럼 다룬다

Discord webhook 주소를 아는 사람은 그 채널에 메시지를 보낼 수 있다. 다음 장소에 절대 남기지 않는다.

- Git 저장소
- Markdown 문서
- 명령행 인자
- 디버그 로그
- Discord 알림 본문
- 화면 캡처

설정 확인이 필요하면 값 자체가 아니라 존재 여부만 확인한다.

```bash
# 값은 출력하지 않고 키 이름만 확인하는 예
sudo grep -q '^DISCORD_WEBHOOK=https://' /etc/vps-alert/.env.sender
```

### 로그도 완전히 믿지 않는다

로그 본문에는 사용자 이름, IP, 명령어, 파일 경로가 들어올 수 있다. 따라서 Rich Embed는 다음 보호를 사용한다.

1. Discord mention을 허용하지 않는다.
2. 본문 길이를 제한한다.
3. 본문을 코드 블록으로 묶는다.
4. webhook 주소를 payload나 로그에 넣지 않는다.

---

## 10. 확인 명령

변경 후에는 가장 좁은 테스트부터 실행한다.

```bash
# 알림 정책과 embed 구조
python3 -m unittest test_alert_policy.py -v

# 전체 Python 테스트
python3 -m unittest discover -p 'test_*.py'

# 셸 문법
bash -n early-warning/install.sh early-warning/apply.sh early-warning/verify.sh
```

서버에 적용하는 명령은 profile을 사용한다.

```bash
early-warning/apply.sh ovh-vps
```

적용이 끝나면 서버에서 읽기 전용 검증을 실행한다.

```bash
ssh ovh-vps 'sudo bash /home/debian/vps-early-warning/verify.sh'
```

성공 기준은 마지막에 다음 문구가 나오는 것이다.

```text
early-warning-verify-ok
```

실제 Discord 화면에서는 `#audit` 채널에서 새 메시지가 다음을 갖는지 확인한다.

- 사건을 설명하는 제목
- host, event, severity, outcome 필드
- 색이 있는 embed
- 원래 로그를 담은 `Details` 코드 블록
- 예상하지 않은 mention이나 webhook 주소가 없음

---

## 11. 문제가 생겼을 때 생각하는 순서

```text
알림이 안 보인다
       |
       v
+------+--------------------------------+
| 1. 그 사건이 drop 정책인가?         |
+------+--------------------------------+
       | 아니오
       v
+------+--------------------------------+
| 2. throttle 상태에 걸렸는가?        |
+------+--------------------------------+
       | 아니오
       v
+------+--------------------------------+
| 3. vps-alert가 실행되었는가?        |
+------+--------------------------------+
       | 예
       v
+------+--------------------------------+
| 4. Discord webhook 요청이 성공했나? |
+------+--------------------------------+
       | 예
       v
Discord 채널 또는 화면을 다시 확인
```

개별 SSH 거절 하나가 안 보이는 것은 고장이 아닐 수 있다. 먼저 burst 조건을 만족했는지 확인한다. 반대로 허가되지 않은 로그인 성공이나 설정 변경이 안 보이면 drop으로 생각하지 말고 즉시 원인을 찾는다.

---

## 12. 핵심 요약

```text
많은 로그
   |
   v
분류(event) + 표준 심각도(severity) + 결과(outcome)
   |
   v
중앙 정책(vps-alert)
   |
   +--> 필요 없음: drop
   +--> 필요 있음: Rich Embed + throttle
   |
   v
Discord #audit
```

기억할 문장은 세 개다.

1. **모든 로그를 알리면 중요한 알림을 놓친다.**
2. **severity와 성공/실패 결과는 서로 다른 값이다.**
3. **Rich Embed는 장식이 아니라 사람이 빠르게 판단하도록 만든 운영 인터페이스다.**
