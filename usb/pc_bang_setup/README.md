# PC방 세션 키트 (Tailscale + Orca, 다운로드 불필요)

| 항목 | 값 |
|---|---|
| Tailscale | 1.102.4 stable (amd64) — `tailscale-setup-1.102.4-amd64.msi`, size=38390272, sha256=`80eb007e…75b7ef6` |
| Orca | 1.4.205, 데스크탑과 동일 (pairing 호환용) — `orca-windows-setup-1.4.205.exe`, size=186990072, sha256=`602cd4fc…d8d86f` |
| 데스크탑 | cachyos-x8664 (`cachyos-dev.tail494a71.ts.net` / `100.126.89.8`) |

## 구성

```text
pc_bang_setup/
  SETUP.cmd / CLEANUP.cmd   시동·정리 (우클릭→관리자 권한으로 실행)
  README.md                 이 파일
  .env.txt                  비밀 2종 (KEY=value 한 줄에 하나)
  .env.example              .env 작성 예시 (복사해서 값 입력)
  remote-server.txt         연결 대상(원격 Orca 서버) 정보 — 데스크탑에서 미리 생성, 스크립트가 읽음
  orca/                     Orca 설치파일·통합 스크립트
  tailscale/                Tailscale MSI·개별 설치/삭제 스크립트
```

왜 PowerShell인가: cmd 배치보다 종료코드·서비스 대기·정리·로그가 정확함.
PowerShell 7 문법 없음 (Win10/11 기본 5.1 동작). 실행정책 우회는 프로세스 한정.

## 출발전 준비 (데스크탑에서, 2분)

1. 데스크탑 Orca 실행 + Tailscale 연결 확인.
2. Orca → Settings → Remote Orca Servers → New Link →
   Connection address에서 Tailscale 주소(100.x) 선택 → Generate Access Link.
3. `.env.example`을 `.env.txt`로 복사해 2줄 입력 (따옴표 불필요):

```text
TAILSCALE_AUTH_KEY=tskey-auth-xxxx   # 콘솔 Settings > Keys 발급
ORCA_CLIENT_URL=orca://pair?code=xxxx  # 위 2번 링크
```

키 우선순위: 실행 파라미터 > `.env.txt` > 환경변수.

## PC방에서 (Windows PC, 관리자 권한 필요)

1. `SETUP.cmd` 우클릭 → 관리자 권한으로 실행.
   순서: Tailscale 설치·접속 → Orca 무인설치 → 실행 → 데스크탑에 페어링.
   옵션 예: `SETUP.cmd -Hostname "my-pc" --accept-routes`
2. 종료코드 `0` = 연결 완료. 파일·터미널·에이전트는 데스크탑에서 실행되고
   이 PC는 UI만 담당 (꺼도 데스크탑 작업은 계속됨).
3. 종료코드 `7` = 설치됐지만 페어링 미완료. 화면 안내대로 수동 연결
   (Orca → Settings → Remote Orca Servers → Add Server → 링크 붙여넣기).
4. 로그: `orca/orca-session.log`, `tailscale/tailscale-*.log`.

## 작업 종료 후 (같은 PC에서)

1. `CLEANUP.cmd` 우클릭 → 관리자 권한으로 실행.
   순서: Orca 종료·삭제 → 전 사용자 데이터 삭제 →
   Tailscale 완전삭제 → 잔류 검증. `0`이면 찌꺼기 없음.
2. 집 데스크탑에서: Orca → Settings → Remote Orca Servers →
   Shared Server Access → 이 PC grant revoke (필수).

## 주의

- 설치/삭제 모두 관리자 권한 필요. 설치파일은 오프라인, 접속·동작은 인터넷 필요.
- Orca 첫 실행 시 업데이트 확인 가능. 버전 불일치 시 pairing 오류 가능.
- `.env.txt`가 든 USB 분실 주의. CLEANUP은 `.env.txt`를 자동 삭제하지 않음.
