# PC방 세션 키트 (Tailscale 고정 + Moonlight/Orca 선택, 브라우저는 Windows 내장 Edge)

| 항목 | 값 |
|---|---|
| Tailscale | 1.102.4 stable (amd64) — `tailscale-setup-1.102.4-amd64.msi` (고정 설치, 오프라인) |
| 브라우저 | Windows 내장 Microsoft Edge (`msedge.exe`) — 설치하지 않는다 |
| Moonlight | `moonlight/MoonlightSetup-6.1.0.exe` (v6.1.0, 선택 설치, 오프라인. 없으면 winget `MoonlightGameStreamingProject.Moonlight`) |
| Orca | 1.4.205, 데스크탑과 동일 (pairing 호환용) — `orca-windows-setup-1.4.205.exe` (선택 설치, 오프라인) |
| 데스크탑 | cachyos-x8664 (`cachyos-dev.tail494a71.ts.net` / `100.126.89.8`) |
| Sunshine 등록 페이지 | `https://100.126.89.8:47990` (SETUP이 Edge로 자동 오픈) |

## 구성

```text
pc_bang_setup/
  SETUP.cmd / CLEANUP.cmd   시동·정리 (우클릭→관리자 권한으로 실행)
  README.md                 이 파일
  .env.txt                  비밀 2종 (KEY=value 한 줄에 하나)
  .env.example              .env 작성 예시 (복사해서 값 입력)
  remote-server.txt         연결 대상 정보 — 데스크탑에서 미리 생성, 스크립트가 읽음
                            (ip로 Sunshine URL https://<ip>:47990을 만든다)
  moonlight-settings.txt    Moonlight 프리셋 (4K·30fps·테두리 없는 창·원격데스크톱 마우스)
                            루트에서 바로 수정, 다음 SETUP에 반영.
                            SETUP을 실행한 관리자 계정의 Moonlight에 적용된다
  orca/                     Orca 설치파일·통합 스크립트
  tailscale/                Tailscale MSI·개별 설치/삭제 스크립트
  moonlight/                MoonlightSetup-*.exe 오프라인 설치파일 (없으면 winget)
```

브라우저 설치 파일은 두지 않는다. Windows 10/11에 기본 포함된 Microsoft Edge를
그대로 쓰므로 브라우저 설치 단계가 없다 (Brave 설치·삭제 로직 제거).

왜 PowerShell인가: cmd 배치보다 종료코드·서비스 대기·정리·로그가 정확함.
PowerShell 7 문법 없음 (Win10/11 기본 5.1 동작). 실행정책 우회는 프로세스 한정.

## 출발전 준비 (데스크탑에서, 2분)

1. 데스크탑 Sunshine 실행 + Tailscale 연결 확인.
2. Orca를 쓸 때만: Orca → Settings → Remote Orca Servers → New Link →
   Connection address에서 Tailscale 주소(100.x) 선택 → Generate Access Link.
3. `.env.example`을 `.env.txt`로 복사해 입력 (따옴표 불필요):

```text
TAILSCALE_AUTH_KEY=tskey-auth-xxxx   # 콘솔 Settings > Keys 발급 (항상 필요)
ORCA_CLIENT_URL=orca://pair?code=xxxx  # Orca를 쓸 때만 필요
```

키 우선순위: 실행 파라미터 > `.env.txt` > 환경변수.

## PC방에서 (Windows PC, 관리자 권한 필요)

1. `SETUP.cmd` 우클릭 → 관리자 권한으로 실행. 설치 선택창이 뜬다:
   Moonlight·Orca 복수선택 ([위/아래] 이동, [Space] 선택/해제, [Enter] 진행.
   Moonlight만 기본 선택).
   Tailscale은 항상 설치된다. 브라우저는 설치하지 않고 내장 Edge를 쓴다.
   비대화형(ssh/테스트)은 `-NonInteractive`.
   옵션 예: `SETUP.cmd -WithMoonlight -Hostname "my-pc" --accept-routes`
2. 순서: Tailscale 설치·접속 → Sunshine 등록 페이지를 Edge로 오픈
   → Moonlight 설치+프리셋 적용+실행(선택 시) → Orca 무인설치+페어링(선택 시)
   → 마지막에 PIN 등록 안내 재출력.
3. 접속 구성 (PIN 등록, 손으로 하는 부분):
   1) Edge에 뜬 자가서명 인증서 경고는 고급 > 계속 진행 (정상).
   2) Moonlight > 우상단 + > 호스트 추가 > `100.126.89.8` 입력 → PIN이 뜬다.
   3) 이미 열려 있는 Sunshine 페이지의 PIN 입력란에 그 PIN을 넣으면 완료.
4. 종료코드: `0` = 완료. `7` = 설치됐지만 Orca 페어링 미완료
   (Moonlight/Sunshine은 바로 사용 가능. 화면 안내대로 수동 연결).
   `9` = Moonlight 설치/설정 실패.
5. 로그: `orca/orca-session.log`, `tailscale/tailscale-*.log`.

## 작업 종료 후 (같은 PC에서)

1. `CLEANUP.cmd` 우클릭 → 관리자 권한으로 실행.
   순서: 클라이언트 종료 → Orca 삭제(있으면) → Moonlight 삭제+설정 삭제(있으면)
   → Tailscale 완전삭제 → 잔류 검증. `0`이면 찌꺼기 없음.
   Edge는 Windows 내장이므로 설치·삭제 대상이 아니다 (프로세스도 건드리지 않음).
2. Orca를 썼다면 집 데스크탑에서: Orca → Settings → Remote Orca Servers →
   Shared Server Access → 이 PC grant revoke (필수).

## 주의

- 설치/삭제 모두 관리자 권한 필요. Tailscale은 오프라인, Moonlight는 오프라인
  설치파일이 없을 때 winget 다운로드 (인터넷 필요).
- ssh로 실행하면 설치는 정상 동작하지만 Edge·Moonlight 창은 원격(비대화형)
  세션에 뜨므로 PC 화면에는 보이지 않는다. PIN 등록은 화면이 있는 PC에서 직접 실행.
- Edge는 설치하지 않으므로 브라우저 프로필이 PC방 PC에 남는다. Sunshine 웹
  로그인 세션까지 남기기 싫으면 Edge 창을 InPrivate로 열거나
  (`msedge.exe -inprivate https://<ip>:47990`), 세션 종료 시 Sunshine에서 로그아웃.
- Orca 첫 실행 시 업데이트 확인 가능. 버전 불일치 시 pairing 오류 가능.
- `.env.txt`가 든 USB 분실 주의. CLEANUP은 `.env.txt`를 자동 삭제하지 않음.
