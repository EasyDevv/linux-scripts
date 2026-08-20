# netbird-setup

직원 PC·모바일을 NetBird에 붙이는 순서입니다.

1. 관리자 PC에서 setup key 발급
2. USB에 설치 스크립트와 키 파일을 담기
3. Windows에서 USB 스크립트 실행
4. `netbird up` 이 끝나면 그 키는 사용한 것으로 표시

키 값은 화면에 출력하지 않습니다. 파일도 git에 넣지 않습니다.

## 1. setup key 발급

관리자 PAT를 한 번만 넣습니다.

```sh
cp ~/.local/share/scripts/dev/netbird/.env.netbird.example \
   ~/.local/share/scripts/dev/netbird/.env.netbird
```

`.env.netbird` 의 `NETBIRD_API_KEY` 를 채웁니다.  
management URL과 `employees` 그룹 기본값은 그대로 두면 됩니다.

```sh
netbird-setup issue GREEN_HOME_PC
netbird-setup issue GREEN_HOME_MOBILE
netbird-setup list
```

- 이름은 `GREEN_HOME_PC` 처럼 대문자·숫자·밑줄만 씁니다. `NETBIRD_SETUP_KEY_` 접두사는 붙이지 않습니다.
- 발급되는 키는 one-off, 1회, 7일, `employees` 그룹입니다.
- 저장 파일은 `.env.netbird.setup-keys` 입니다.
- 같은 이름이 있으면 확인 후 덮어씁니다. 비-TTY는 `--replace` 가 필요합니다.

```sh
netbird-setup issue GREEN_HOME_PC --replace
```

## 2. USB로 이전

키를 하나 고르지 않습니다. 키 파일 전체와 Windows 설치 스크립트를 USB에 복사합니다.

```sh
netbird-setup usb
netbird-setup usb --dest /run/media/$USER/USB
```

마운트된 USB가 있으면 화살표로 고릅니다. 터미널이 아니면 `--dest` 가 필요합니다.

USB의 `netbird-setup/` 폴더:

| 파일 | 역할 |
| --- | --- |
| `.env.netbird.setup.keys` | 발급된 키 목록. 스크립트가 이 파일을 읽습니다 |
| `install-netbird.cmd` | 더블클릭용 |
| `install-netbird.ps1` | 실제 설치·접속 스크립트 |
| `netbird_installer_windows_amd64.msi` | 있으면 오프라인 설치. 없으면 winget |
| `README.md` | 이 설명 |

호스트의 `.env.netbird.setup-keys` 가 USB에서는 `.env.netbird.setup.keys` 로 복사됩니다.

## 3. Windows에서 USB 스크립트 실행

1. USB의 `netbird-setup` 폴더를 엽니다.
2. `install-netbird.cmd` 를 더블클릭합니다.
3. 아직 쓰지 않은 키를 고릅니다.  
   `↑` `↓` 또는 `j` `k` 이동, Enter 선택, `q` 취소.
4. 이미 `netbird up` 이 끝난 키는 목록에 취소선·흐린 글씨로 보이고 선택할 수 없습니다.
5. 관리자 허용이 뜨면 예를 누릅니다.
6. NetBird를 설치한 뒤 고른 키로 `netbird up` 합니다.

PowerShell에서 직접 실행:

```powershell
.\install-netbird.ps1
.\install-netbird.ps1 -Name GREEN_HOME_PC
.\install-netbird.ps1 -DryRun -Name GREEN_HOME_PC
```

`-DryRun` 은 설치와 `netbird up` 을 하지 않고 실행할 명령만 보여 줍니다.  
SSH나 파이프처럼 키가 없는 환경에서는 `-Name` 이 필요합니다.

## 4. netbird up 완료

접속이 성공하면 USB의 `.env.netbird.setup.keys` 에서 그 키 줄을 주석 처리합니다.

```
# GREEN_HOME_PC=...
```

다음에 스크립트를 다시 열면 해당 이름은 보이되 취소선이고 고를 수 없습니다.  
one-off 키는 한 기기에서만 쓰면 됩니다. 다른 기기는 아직 주석이 아닌 키를 고르면 됩니다.
