# executor 학습노트: localhost 가 안 열릴 때

## 1. 이 문서는 왜 만들었을까?

`executor reload sns-publisher`를 하면 서버가 켜진다고 나오는데, 브라우저에서 `http://localhost:5180/publish`를 열면 아무것도 안 나오는 문제가 있었다.

이 문서는 같은 문제를 다시 마주했을 때 "아, 이거 IPv6/IPv4 바인드 문제구나" 하고 바로 떠올릴 수 있게, 12세 친구도 이해할 수 있도록 남기는 기록이다.

---

## 2. 증상: "켜졌는데 왜 안 열리지?"

### 2-1. 어떤 일이 일어났을까?

터미널에서 아래 명령을 실행했다.

```bash
executor reload sns-publisher
```

그러면 이런 메시지가 나왔다.

```
VITE v8.0.0  ready in 721ms
➜  Local:   http://localhost:5180/
```

"서버 켜졌어! 5180 번 포트로 와!"라고 말하는 것 같았다.

근데 브라우저에서 `http://localhost:5180/publish`를 열면... **아무것도 안 나왔다.**

`executor status`를 보면 `runtime: active`라고 나오는데, `ports:`는 `(none)`이었다.

> **`active`인데 `ports`가 없다?**
>
> 이건 마치 "가게 영업 중"이라고 간판은 걸어놨는데, 실제로 문은 잠겨 있는 것과 비슷하다.

---

## 3. 탐색 과정: "도대체 어디에 있는 거야?"

### 3-1. 먼저 생각한 것들

1. **`bunx --bun vite dev`가 문제일까?**
   - 최근에 `package.json`의 `dev` 스크립트를 `bunx --bun vite dev`로 바꿨다.
   - 혹시 이 변경 때문에 서버가 안 켜지는 걸까?

2. **`executor.json` 설정이 잘못됐을까?**
   - `~/.config/systemd/user/executor.json`에서 명령어를 확인했다.
   - `moon run desktop:web -- --port 5180`으로 적혀 있었다. 맞는 것 같다.

3. **`moon.yml`이 문제일까?**
   - `apps/desktop/moon.yml`에서 `desktop:web` 태스크를 확인했다.
   - `command: 'bun run dev'`로 적혀 있었다. 이것도 맞는 것 같다.

### 3-2. 직접 열어보기: "서버가 정말 켜졌을까?"

가장 먼저 한 일은 **서버가 정말 켜졌는지 확인**하는 것이었다.

```bash
curl -I --max-time 10 "http://localhost:5180/publish"
```

결과: **실패** (연결할 수 없다)

그런데 이상한 것을 발견했다.

```bash
curl -I --max-time 10 "http://[::1]:5180/publish"
```

결과: **성공!** (200 OK)

> **`[::1]`이 뭐지?**
>
> 컴퓨터에는 두 종류의 "내 주소"가 있다.
>
> - `127.0.0.1` → IPv4 (옛날 주소 체계)
> - `[::1]` → IPv6 (새로운 주소 체계)
>
> `localhost`는 보통 둘 다를 가리키는데, 어떤 프로그램은 둘 중 하나에만 연결될 수 있다.

### 3-3. 리스너 확인: "누가 5180 번을 듣고 있을까?"

```bash
ss -ltnp '( sport = :5180 )'
```

결과:

```
LISTEN  0  512  [::1]:5180  [::]:*  users:(("node", pid=..., fd=17))
```

**서버는 `[::1]:5180`에만 연결되어 있었다.** `127.0.0.1`에는 아무도 없었다.

> **이게 바로 문제였다!**
>
> Vite dev 서버가 IPv6 (`[::1]`) 에만 문을 열어둔 것이다.
>
> 브라우저가 `localhost`를 `127.0.0.1`로 해석하면 문이 닫혀 있어서 들어갈 수 없다.
>
> 반면 `[::1]`로 해석되면 문이 열려 있어서 들어갈 수 있다.

### 3-4. `bunx`가 원인일까?

의심스러워서 두 가지 명령을 직접 비교해 봤다.

```bash
# 방법 1: bun 직접 실행
timeout 15s bun --bun vite dev --port 5181

# 방법 2: bunx 로 실행
timeout 15s bunx --bun vite dev --port 5182
```

둘 다 **똑같이 `[::1]`에만 연결**되었다.

> **결론: `bunx`가 문제가 아니었다.**
>
> Vite dev 서버의 기본 동작이 원래 이렇게 되어 있었던 것이다.
>
> `package.json`을 `bunx --bun vite dev`로 바꾼 것은 이번 문제의 원인이 아니다.

---

## 4. 진짜 원인: "왜 `[::1]`에만 연결됐을까?"

### 4-1. Vite 의 기본 동작

Vite dev 서버는 `host` 옵션을 지정하지 않으면, OS 에 따라 다르게 연결된다.

- 어떤 OS 는 `127.0.0.1`에만 연결
- 어떤 OS 는 `[::1]`에만 연결
- 어떤 OS 는 둘 다 연결

이 프로젝트가 돌아가는 CachyOS 에서는 **`[::1]`에만 연결**되는 것이었다.

### 4-2. 왜 이게 문제가 될까?

브라우저나 `curl`이 `localhost`를 열 때:

1. 먼저 `127.0.0.1`로 시도 → **실패** (문이 닫혀 있음)
2. 그 다음 `[::1]`로 시도 → **성공** (문이 열려 있음)

그런데 어떤 프로그램은 1 번에서 멈추거나, 순서가 반대일 수 있다. 그래서 **간헐적으로 안 열리는 것처럼 보이는 것**이다.

> **우편 배달로 비유해보자**
>
> - 너의 집 주소가 두 개 있다: "옛날 주소"와 "새 주소"
> - 배달부는 옛날 주소로 먼저 배달하려고 한다
> - 그런데 가게 문은 새 주소 쪽에만 열려 있다
> - 배달부가 옛날 주소에서 "문 닫혔네?" 하고 돌아가 버린다
> - 결과: 배달 실패!

---

## 5. 해결 방법: "문을 두 곳 다 열자"

### 5-1. 가장 간단한 방법

`vite.config.ts`에 `host: "127.0.0.1"`을 추가하면 된다.

```diff
  server: {
+   host: "127.0.0.1",
    strictPort: true,
    watch: {
      ignored: ["**/.user-data/**", ...],
    },
  },
```

이렇게 하면 Vite 가 **무조건 `127.0.0.1`에만 연결**된다.

> **왜 `[::1]`이 아니라 `127.0.0.1`일까?**
>
> - 대부분의 브라우저와 도구는 `localhost`를 `127.0.0.1`로 먼저 시도한다
> - `127.0.0.1`에 연결하면 거의 항상 잘 된다
> - 개인용 데스크톱 앱이라서 LAN 에 공개할 필요도 없다

### 5-2. 다른 방법도 있을까?

| 방법 | 결과 | 비고 |
|---|---|---|
| `host: "127.0.0.1"` | ✅ `127.0.0.1`에만 연결 | **추천** (가장 안전) |
| `host: true` 또는 `--host` | ✅ `0.0.0.0`에 연결 (LAN 공개) | 필요 없으면 보안상 비추천 |
| `host: "::"` | ✅ IPv6 + IPv4 듀얼스택 | OS 설정에 따라 다름 |
| `host` 옵션 없음 | ❌ OS 따라 다름 | **지금 문제의 원인** |

---

## 6. 검증: "정말 고쳐졌을까?"

### 6-1. 깨끗하게 재시작

```bash
executor stop sns-publisher
sleep 3
executor start sns-publisher
sleep 15
```

### 6-2. 상태 확인

```bash
executor status sns-publisher
```

결과:

```
▶ localhost:5180
  dir: ~/dev/marketing/sns-publisher
  cmd: moon run desktop:web -- --port 5180
  enabled: true
  runtime: active
  ports:
    127.0.0.1:5180
```

이제 `ports:`에 `127.0.0.1:5180`이 보인다!

### 6-3. 리스너 확인

```bash
ss -ltnp '( sport = :5180 )'
```

결과:

```
LISTEN  0  512  127.0.0.1:5180  0.0.0.0:*  users:(("node", pid=..., fd=13))
```

`127.0.0.1:5180`에 연결되었다!

### 6-4. 직접 접속

```bash
curl -I --max-time 20 "http://localhost:5180/publish"
curl -I --max-time 10 "http://127.0.0.1:5180/publish"
```

둘 다:

```
HTTP/1.1 200 OK
Content-Type: text/html
```

**성공!** 🎉

### 6-5. reload 도 잘 될까?

```bash
executor reload sns-publisher
sleep 15
curl -I --max-time 20 "http://localhost:5180/publish"
```

결과: **성공!** (200 OK)

---

## 7. 부록: 알아두면 좋은 것들

### 7-1. `executor status`의 `runtime: active`는 무슨 뜻일까?

`executor`는 **프로세스가 살아 있는지**만 확인한다. HTTP 서버가 실제로 요청을 받을 수 있는지는 확인하지 않는다.

그래서 `runtime: active`라고 나오더라도, 실제로는 아직 준비 중일 수 있다.

> **비유: "가게 영업 중" 간판**
>
> - 사장님이 간판만 걸어놨을 뿐, 실제로 문을 열고 진열을 다 끝낸 건 아니다
> - `runtime: active` = 간판 걸림
> - `ports: 127.0.0.1:5180` = 문 열고 진열 완료

### 7-2. 왜 첫 접속은 느릴까?

`/publish`에 처음 접속하면 **9 초 정도** 걸릴 수 있다.

이유: SvelteKit 이 페이지를 처음 컴파일하기 때문이다. 두 번째부터는 빠르다.

> **비유: 첫 주문**
>
> - 식당에서 처음 주문하면 요리사가 레시피를 찾아보고 재료를 준비한다 (느림)
> - 두 번째 주문하면 이미 다 준비되어 있어서 바로 나온다 (빠름)

### 7-3. `bunx` vs `bun`

| 명령 | 뜻 |
|---|---|
| `bun run dev` | `package.json`의 `dev` 스크립트 실행 |
| `bun --bun vite dev` | Bun 런타임으로 Vite 직접 실행 |
| `bunx --bun vite dev` | Bun 런타임으로 Vite 실행 (npm 실행 방식과 비슷) |

이 프로젝트에서는 `bunx --bun vite dev`를 쓰고 있다. 둘 다 같은 Vite 서버를 띄우므로, 이번 문제와는 관계없다.

---

## 8. 요약

| 항목 | 내용 |
|---|---|
| 증상 | `executor reload` 후 `http://localhost:5180/publish`가 안 열림 |
| 발생 조건 | CachyOS 에서 Vite dev 서버 실행 시 |
| 근본 원인 | Vite 가 `[::1]`(IPv6) 에만 연결되고 `127.0.0.1`(IPv4) 는 닫혀 있음 |
| 수정 | `vite.config.ts`에 `host: "127.0.0.1"` 추가 |
| 영향 범위 | `apps/desktop/vite.config.ts` 한 파일만 수정 |
| 검증 방법 | `executor reload` 후 `curl http://localhost:5180/publish`로 200 OK 확인 |

---

## 9. 핵심 교훈

1. **"켜진 것처럼 보여도 실제로는 아닐 수 있다"**
   - `runtime: active`는 프로세스 기준, `ports`가 있어야 진짜 켜진 것

2. **`localhost`는 두 개의 주소를 가진다**
   - `127.0.0.1`(IPv4) 와 `[::1]`(IPv6)
   - 둘 중 하나에만 연결되면 문제가 생길 수 있다

3. **의심되면 직접 확인하자**
   - `curl`로 직접 접속해보기
   - `ss`나 `lsof`로 리스너 확인하기
   - 로그만 보지 말고, 실제로 열어보기

4. **가장 간단한 해결책이 종종 정답이다**
   - `host: "127.0.0.1"` 한 줄 추가가 모든 문제를 해결했다
