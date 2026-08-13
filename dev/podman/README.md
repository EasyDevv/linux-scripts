# podman

Podman 컨테이너 프로젝트를 Tailscale 노드에 배포, 초기화, 제거한다.

## Usage

```bash
podman-deploy                    # 배포/업데이트
podman-deploy --init             # 원격 호스트 초기화
podman-deploy --init --host-only # 호스트 수준(Caddy/Tailscale/sudo)만 초기화, 프로젝트 경로 미동기
podman-deploy --remove           # 프로젝트 제거
```

## Files

| 파일 | 역할 |
|---|---|
| `common.sh` | 컨텍스트 로딩, SSH 전송, Caddy snippet 생성 공유 함수 |
| `deploy.sh` | 이미지 빌드, OCI 전송, Quadlet/Caddy 동기화 |
| `init.sh` | 원격 호스트 패키지, Caddy, Tailscale cert, sudo helper 1회 설치 |
| `remove.sh` | Quadlet, 컨테이너, OCI 디렉터리, Caddy snippet 제거 |
