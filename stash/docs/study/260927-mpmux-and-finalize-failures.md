# segment 100%인데 failed / MPMux 확장 분석

기준일: 2026-09-27. `http://stash.localhost/`에서 HLS segment가 전부 다운로드된 상태로
`failed` 처리되는 아이템이 다수 발견되어 원인을 분석하고 수정했다. 겸해서 사용자가
다운로드에 쓰는 확장프로그램 MPMux의 구조를 분석해 "다운로드와 동시에 영상화되는지"
확인했다. [[hls-streaming-mux.md]]의 후속/보강 문서.

관련 코드:

- `src/downloads.rs`: `sanitize_filename`, `truncate_filename_bytes`, `run_ffmpeg_mux`
- `src/main.rs`: `sanitize_browser_filename`, `complete_browser_hls_job`,
  `contiguous_segment_prefix_count`
- `src/worker.rs`: CDP 기반 browser-hls 워커

## 한 줄 결론

segment 100% failed의 실제 원인은 재배포 타이밍 문제가 아니라 **파일명 바이트 길이
제한 누락**이었다. `sanitize_filename`류 함수에 길이 캡이 아예 없어서, 중국어/일본어
제목(글자당 UTF-8 3바이트)이 `NAME_MAX`(255바이트)를 넘으면 ffmpeg가 매 재시도마다
동일하게 `File name too long`으로 죽었다 — 결정론적 버그라 5회 재시도로도 해결되지
않았다. MPMux 확장은 실제로 "다운로드와 동시에 영상화"하지만, 그 방식(브라우저
`hls.js`의 fMP4 트랜스먹싱을 MediaSource 버퍼에서 가로채기)은 서버 쪽에 그대로 이식할
수 없다 — 이미 [[hls-streaming-mux.md]]에서 이 시도가 실패한 이유가 기록되어 있다.

## 1. "100% failed" 재조사

### 증상

지난 세션에서 ffmpeg stderr를 캡처하도록 고쳐둔 덕분에, 이번엔 실패 원인이 로그에
그대로 남았다:

```
HLS remux failed: exit status: 220; ffmpeg stderr:
Error opening output /mnt/shared/.e273aab7-...-d7094be2651c.NIMA-059 銷量達 39_000 冊的
熱門同人漫畫 FANZA 被改編成電影了...(중략)...菊野蘭.mp4.staged: File name too long
```

바이트 계산:

```python
>>> len(".e273aab7-....mp4.staged".encode("utf-8"))
322
```

`/mnt/shared`(NFS4, `namlen=255`)와 로컬 ext4 모두 `NAME_MAX=255`. 확인 결과
`sanitize_filename`(downloads.rs) / `sanitize_browser_filename`(main.rs) **둘 다
길이 제한 로직이 전혀 없었다** — 금지 문자만 `_`로 치환하고 truncate는 안 함.

DB 조회 결과 이 패턴으로 확정 종료된 job이 8건, 전부 `retry_count`가 max까지
소모된 상태(결정론적 실패라 재시도로 해결 안 됨).

지난 세션의 "SIGTERM/재배포 충돌" 가설은 틀린 게 아니라 — 실제로 재배포 중
mux가 죽는 걸 라이브로 관측했었다 — **당시엔 stderr가 없어서 진짜 원인(파일명)을
볼 수 없었을 뿐**이다. 두 메커니즘은 별개로 공존한다.

### 부수 발견: CDP 워커 브라우저 다운

`browser-hls` 트랜스포트(익스텐션이 쓰는 경로) job 중 33건이 `uploaded_segments=0`
상태로 실패해 있었는데, 전부 2026-08-19에 생성되고 2026-09-27 11:54:36에 일괄
`failed` 처리됐다. `control-chrome status --port 12345` → unreachable. 즉
워커용 CDP 브라우저가 꺼져 있어서 확장 기반 다운로드 파이프라인 전체가 진행이
안 되는 상태였다(단, 이건 "0%에서 멈춤"이라 사용자가 본 "100% failed" 증상과는
다른 별개 이슈).

## 2. 수정: 파일명 바이트 길이 캡

`downloads.rs`에 `truncate_filename_bytes(name, max_bytes)` 추가:

```rust
pub(crate) const MAX_FILENAME_BYTES: usize = 200;

pub(crate) fn truncate_filename_bytes(name: &str, max_bytes: usize) -> String {
    if name.len() <= max_bytes { return name.to_string(); }
    let (stem, ext) = match name.rfind('.') {
        Some(idx) if idx > 0 && name.len() - idx <= 10 => (&name[..idx], &name[idx..]),
        _ => (name, ""),
    };
    let budget = max_bytes.saturating_sub(ext.len());
    let mut cut = budget.min(stem.len());
    while cut > 0 && !stem.is_char_boundary(cut) { cut -= 1; }
    // ...trim, reattach ext, "download" fallback if empty
}
```

예산 산출: staged 파일명은 `.{uuid36}.{name}.staged` (오버헤드 45바이트) 형태가
가장 타이트하므로 `255 - 45 = 210`에서 여유를 두고 200바이트로 캡. UTF-8 char
boundary에서 자르고, 확장자(`.mp4` 등)는 보존한다. `sanitize_filename` /
`sanitize_browser_filename` 둘 다 이 함수를 거치도록 연결.

## 3. MPMux 확장 분석 — "다운로드와 동시 영상화"는 사실

확장 경로: `~/dev/tampermonkey/.user-data/chrome-tampermonkey/Default/Extensions/mbflpfaamifmmmkdjkcmpofpccfmlmap/1.2_0`

manifest 확인 결과 정체는 **"MPMux" (mpmux.com)**, manifest v3, `webRequest` +
`declarativeNetRequest` 권한.

### 구조

1. `background.js`가 `webRequest.onResponseStarted`로 미디어/`m3u8` 응답을 감지.
2. 감지되면 `mpmux.com/hlsdownloader` 또는 `/buffermuxer` 페이지를 새 탭으로 연다.
3. 그 페이지가 번들된 `hls.js`(374KB, `mux.js` 트랜스먹서 포함)로 세그먼트를 직접
   fetch → **브라우저 안에서 TS를 fMP4로 변환하며 MediaSource 버퍼에 append**.
4. `js/proxy.js`가 `window.MediaSource.prototype.addSourceBuffer` /
   `SourceBuffer.appendBuffer`를 프록시로 감싸 가로챈다.
5. 가로챈 데이터(**이미 변환된 fMP4 fragment**)를
   `MEDIA_SOURCE_ON_DATA`/`RECORDER_SUCCESS` 메시지로 background.js에 전달,
   그대로 순서대로 이어 붙여 저장.

즉 확장은 미디어 처리를 하나도 하지 않는다. `hls.js`가 **재생 준비 과정에서 이미
다 해놓은** TS→fMP4 변환 결과를 그대로 가로채 직렬화할 뿐이라, "다운로드 완료"
시점에 이미 재생 가능한 파일이 존재한다 — 별도의 "다운로드 끝난 후 remux" 단계가
아키텍처상 존재하지 않는다. 사용자 추정이 정확했다.

### 왜 이 방식을 stash(서버 프로세스)에 그대로 옮길 수 없는가

`hls.js`/`mux.js`는 세그먼트 하나하나를 **개별 입력**으로 취급해 PTS 불연속을
보정하면서 fMP4로 변환한다(MSE에 붙이려면 필수 — SourceBuffer는 timestampOffset로
이 보정을 한다). 이 프로젝트도 서버 쪽에서 같은 효과를 내려고 이미 시도한 적이
있다: [[hls-streaming-mux.md]]의 "1차 시도"가 정확히 "세그먼트를 하나의 연속
스트림으로 취급"하는 방식이었고, **세그먼트 경계에서 PTS가 초기화되는 MissAV/surrit
TS 특성 때문에 duration이 1/20로 깨졌다**(1,786-segment 파일이 13초로 표시).

### 직접 재현 확인

이번 조사 중 원래 이 문서에 쓸 다른 개선안(세그먼트 raw byte 이어붙이기)을 시도했다가
같은 문제에 부딪혀서 되돌렸다. 재현:

```bash
# 4개를 각각 독립 인코딩(세그먼트마다 PTS가 0 부근에서 리셋 — 실제 HLS와 동일 조건)
ffmpeg -f lavfi -i testsrc=duration=15... -f mpegts real-0.ts   # x4, 총 60초 분량

cat real-0.ts real-1.ts real-2.ts real-3.ts > raw-concat.ts
ffprobe -show_entries format=duration raw-concat.ts
# duration=15.023222   ← 60초여야 하는데 15초로 깨짐 (문서의 사례와 동일 현상)
```

같은 세그먼트를 `-f concat -safe 0 -i segments.ffconcat`(파일별 입력) 경로로
합치면 정상:

```bash
ffprobe -show_entries format=duration smoke-realistic.mp4
# duration=60.092971   ← 정상
```

**결론: raw byte concat은 이 프로젝트의 실제 컨텐츠(MissAV/surrit)에 대해 안전하지
않다.** 확장의 "동시 영상화" 효과는 브라우저 밖에서 재현하려면 기존에 이미 구현된
"세그먼트별 named pipe + concat demuxer" 방식(`should_stream_hls_mux`,
`STREAMING_MUX_MAX_SEGMENTS=128`)을 거쳐야 하고, raw concat으로 지름길을 만들
수 없다.

## 4. `browser-hls` 경로(확장이 쓰는 경로) 보강

`complete_browser_hls_job`(main.rs)은 세그먼트를 모두 업로드받은 뒤
`fs::read_dir` + 정렬로 파일 목록을 만들어 concat 리스트를 짰다 — **gap(중간
세그먼트 누락) 검사가 전혀 없어서**, 업로드가 하나 빠져도 조용히 잘린 영상을
만들어냈다. `contiguous_segment_prefix_count`를 추가해 `segment-000000.ts`부터
연속으로 존재하는 개수만 세고, `total_segments`가 알려져 있으면 그 값과 비교해
불일치 시 명시적으로 실패시키도록 고쳤다:

```rust
if job.total_segments > 0 && contiguous < job.total_segments as u64 {
    return Err(bad_request(&format!(
        "incomplete: {}/{} contiguous segments uploaded (a middle segment is still missing)",
        contiguous, job.total_segments
    )));
}
```

mux 자체는 원래대로 concat 리스트 + `-f concat -safe 0` 유지(위 3번 이유로
raw concat 금지).

### 검증

실제 서버(포트 45122)에 대해 synthetic HLS job으로 종단 검증:

1. **파일명 truncation**: 270바이트 CJK 제목 → 198바이트로 잘려 job 생성 성공.
2. **정상 완료**: 4-segment(약 3MB) job 업로드 → `complete` → mp4 3,054,829
   bytes, `ffprobe duration=60.02` 정상 재생 확인.
3. **gap 검출**: segment 2를 빼고 업로드 → `complete` 호출 시
   `"incomplete: 2/4 contiguous segments..."` 에러로 즉시 실패(예전엔 조용히
   2-segment짜리 잘린 영상을 만들었을 상황).
4. **자가 복구**: 빠진 segment 2를 나중에 업로드하고 `complete` 재호출 →
   정상 완료, 이전과 바이트까지 동일한 결과물.
5. 재현 테스트(위 3번 raw-concat 대조군)로 duration=60.09 정상 확인.

`cargo test` 116개 전체 통과. `executor reload stash`로 배포 완료.

## 5. 남은 것 / 하지 않은 것

- **CDP 워커(port 12345) 재기동은 보류.** 사용자 지시로 테스트는 이미 열려 있던
  12346을 사용했고, 프로덕션 워커가 붙는 12345는 이번에 손대지 않았다 — 별도로
  기동 필요.
- `browser-hls`(확장 경로)에는 여전히 진짜 스트리밍 mux가 없다(4번 참고, 배치
  concat 유지). 6번에서 reqwest-HLS 경로에 적용한 걸 이쪽에도 이식할 수 있는지는
  별도 과제.

## 6. 큰 segment 수(1,600~1,900개)에 대한 진짜 스트리밍 mux — 후속 작업

처음엔 "기존 named-pipe 방식은 세그먼트마다 pipe를 미리 만들어야 해서
`STREAMING_MUX_MAX_SEGMENTS=128`이 이미 상한"이라고 이 문서에 썼는데, 틀렸다.
`feed_segment_pipes`를 다시 읽어보면 pipe는 **한 번에 하나씩만 연다**(concat
demuxer가 입력을 순차로 열기 때문) — `mkfifo`로 만들어두는 건 특수 파일 생성일
뿐 fd를 소비하지 않는다. 즉 세그먼트 개수 자체는 named pipe 방식의 한계가
아니었다.

### 진짜 원인: pipe 디렉터리가 NFS 위에 있었다

`pipe_dir = temp_dir.join("mux-pipes")` — `temp_dir`는 `temp_root`(NFS4,
`/mnt/shared`) 아래. `mkfifo` 1번마다 NFS round-trip이 든다. 실측(이 머신, 같은
Tailscale 경로):

```
NFS(/mnt/shared)에서 mkfifo x200:   1.563s (~7.8ms/call)
로컬(/var/tmp)에서 mkfifo x200:     0.132s (~0.66ms/call, ~12배 빠름)
```

1,900 세그먼트면 NFS에서 pipe 준비만 ~15초가 든다 — `STREAMING_MUX_MAX_SEGMENTS`를
128로 낮게 잡아둔 진짜 이유로 보인다(커밋 메시지에 근거는 없음, 코드 정황상
추정). pipe는 mux가 끝나면 다시 읽지 않는 순수 IPC라 NFS(공유 스토리지)에 있을
필요가 전혀 없다 — 재시작 시 재사용해야 하는 건 `segment-*.ts` 원본 파일뿐이고,
그건 그대로 NFS temp_dir에 남는다.

### 수정

```rust
// downloads.rs
const MUX_PIPE_LOCAL_ROOT: &str = "/var/tmp/stash-mux-pipes";
const STREAMING_MUX_MAX_SEGMENTS: usize = 8192; // was 128

let pipe_dir = Path::new(MUX_PIPE_LOCAL_ROOT).join(&job_id);
```

`STREAMING_MUX_MAX_SEGMENTS`는 "짧은 클립만" 상한이 아니라 기형 playlist를 막는
안전장치로 재정의했다. 6s/segment 기준 8,192는 13시간 분량까지 커버한다 — 실제
실패 사례(1,600~1,900)는 이제 전부 스트리밍 경로를 탄다.

### 검증

로컬 HTTP 서버로 300-segment 합성 HLS(각 세그먼트 독립 인코딩이라 PTS가
세그먼트마다 리셋 — 3번의 재현 조건과 동일)를 서빙하고 실서버(`/stash/jobs/static`)에
job으로 등록해 종단 검증:

```
job dad27723...: streaming HLS segments through concat pipes   ← 300개인데 스트리밍 진입(구 cap=128이면 배치로 빠졌을 것)
job dad27723...: saved to .../streaming-test-300seg.mp4, bytes=11.3 MB,
  transfer_wall=201.75s, finalize_wall=4.31ms, total_wall=201.75s
```

- `finalize_wall=4.31ms` — 300 세그먼트인데도 Finalizing이 사실상 0. 다운로드가
  끝나는 순간 이미 mux도 끝나 있다(named pipe가 다운로드와 병행 소비하므로).
- `ffprobe duration=600.043356` — 300×2초 = 정확히 600초. 3번에서 확인한
  PTS-리셋 버그(raw concat이었다면 여기서도 깨졌을 것)가 concat demuxer로는
  발생하지 않음을 대규모로도 재확인.
- 실제 프로덕션 job들(`03aed226`, `2a405513`, `8b173a4a`, `e3d533a3`,
  `f8be8ae0` 등)도 배포 직후 곧바로 `/var/tmp/stash-mux-pipes/`를 쓰기 시작한 걸
  확인 — 이 수정으로 즉시 혜택을 받는 실사용 job이 존재했다.
- `cargo test` 116개 통과(`should_stream_hls_mux`의 "장편은 배치로 빠진다" 단언을
  "1,900세그먼트도 스트리밍, 8,192 초과만 배치"로 재작성).
