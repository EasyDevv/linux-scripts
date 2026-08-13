# HLS streaming mux study (다운로드 완료 직후 바로 시청)

기준일: 2026-08-14

## 주제

브라우저 확장프로그램(MPMux)은 HLS 다운로드가 끝나자마자 영상을 볼 수 있다.
어떤 원리인지 분석하고, 같은 효과를 Rust 기반 `stash`에 어떻게 반영했는지 정리한다.

관련 코드:

- `src/downloads.rs`: streaming mux, named pipe feeder, ffmpeg monitor
- `src/hls.rs`: `download_segments` 의 segment 스트리밍 알림

## 한 줄 결론

"다운로드 중에 이미 MP4를 만들어 두고, 마지막 조각이 도착하면 컨테이너만 마무리한다."
stash 에서는 **segment 별 named pipe + ffmpeg concat demuxer**로 이를 구현했다.
기존 방식의 "전체 TS 재읽기 → MP4 재작성" 단계가 사라져, 마지막 segment 후 수분이 걸리던
Finalizing 이 수 초로 줄었다.

## 확장프로그램은 왜 즉시 시청이 가능한가

MPMux(MPV3, manifest v3)는 HLS를 직접 다운로드하지 않는다. **재생 중인 브라우저의
출력을 가로채는** 구조다.

흐름:

1. 사용자가 플레이어 페이지에서 영상을 재생한다.
2. 페이지에 포함된 `hls.js`가 TS segment를 받아서 **이미 복호화·TS→fMP4 변환**을 한다.
3. `js/proxy.js`가 `window.MediaSource`를 Proxy로 감싸 `SourceBuffer.appendBuffer(data)` 를 가로챈다.
4. 가로챈 데이터는 **이미 변환된 fMP4 fragment**이므로 순서대로 이어 붙이기만 하면 된다.
5. `sourceended` 이벤트가 오면("스트림 끝") 파일이 사실상 완성된 상태로 저장된다.

즉 확장프로그램은 미디어 처리를 하나도 하지 않는다. hls.js가 재생 중에 다 해놓은
**준비된 byte stream을 serialize** 하는 것뿐이다. 그래서 완료 판정 순간 이미
재생 가능한 MP4가 존재한다.

이 원리를 stash에 그대로 옮길 수는 없다(브라우저 밖이므로). 대신
"다운로드와 mux를 병행한다"는 같은 구조를 서버 쪽 ffmpeg로 재현한다.

## stash 구현: segment 별 named pipe streaming mux

### 동작 방식

1. `EXT-X-MAP`가 없는 순수 TS HLS라면, segment 다운로드를 시작하기 전에
   ffmpeg를 먼저 띄운다.
2. segment 개수만큼 **named pipe**(`mkfifo`)를 만들고, pipe 목록으로
   `segments.ffconcat`(concat demuxer manifest)를 작성한다.
3. ffmpeg는 concat demuxer로 pipe들을 열고 `.staged` MP4를 쓰기 시작한다.
4. segment 하나가 다운로드되면(기존 `segment-*.ts` 파일 보존 유지)
   `UnboundedSender<PathBuf>`로 feeder 태스크에 알리고, feeder가 해당 pipe에
   파일 내용을 쓴다.
5. 모든 segment를 공급하면 concat 입력이 끝나고 ffmpeg는 trailer만 기록 후 종료한다.
6. 기존과 동일하게 atomic rename으로 완료 처리한다.

### 왜 concat demuxer + 표준 MP4인가

이 결정은 실험을 통해 나왔다. 자세한 시행착오는 아래 "시행착오" 절 참고.

- **concat demuxer**: 각 입력 파일을 개별 입력으로 열어 재조립하므로
  segment 경계의 timestamp/PTS 초기화를 보정한다. segment마다 PTS가 0부터
  시작하는 TS 스트림도 전체 duration이 정확하게 합산된다.
- **표준 MP4 (moov가 끝에)**: ffmpeg가 끝에 `moov`를 쓴다. 완료 시점에는
  moov가 항상 존재하므로 재생·seek·duration이 정상이다. fragmented MP4
  (`-movflags frag_keyframe+...`)는 완료 후 Chrome에서 duration이 첫
  fragment만큼만 표시되는 문제가 있어 폐기했다.

### ffmpeg 인자

```text
ffmpeg -y -nostdin -loglevel error \
  -f concat -safe 0 -i <pipe_dir>/segments.ffconcat \
  -c copy -bsf:a aac_adtstoasc \
  -f mp4 <staged_path>
```

- `-bsf:a aac_adtstoasc`: TS의 ADTS AAC를 MP4의 ASC 형식으로 변환.
  없으면 `Malformed AAC bitstream` 오류로 mux가 실패한다.
- `-nostdin`: concat manifest는 파일 경로로 주므로 stdin이 필요 없다.
  (파이프로 직접 주입하던 초기 버전에서는 `-nostdin`과 stdin 사용이 충돌해
  broken pipe가 났다.)

### feeder: blocking pipe open의 함정

named pipe의 `open(O_WRONLY)`는 **reader(ffmpeg)가 열 때까지 블록**된다.
ffmpeg가 일찍 죽으면 feeder가 pipe open에서 무한 대기할 수 있으므로
`MUX_PIPE_TIMEOUT`(120초)으로 open과 copy를 감싼다.

```rust
tokio::time::timeout(MUX_PIPE_TIMEOUT, OpenOptions::new().write(true).open(&pipe_path))
tokio::time::timeout(MUX_PIPE_TIMEOUT, tokio::io::copy(&mut segment, &mut pipe))
```

채널이 닫히면(`drop(tx)`) feeder는 남은 pipe 개수와 일치하지 않으면 오류를
반환하고, 이 오류는 retry로 전파된다.

### resume / 재시작 복구

기존 segment 파일(`segment-*.ts`)을 그대로 남겨두므로 재시작 시
`downloaded_hls_progress` 로 진행률을 복원하고, 이미 있는 segment는 디스크에서
읽어 pipe로 다시 공급한다. mux가 다운로드 단계에서 이미 진행되므로
"resume 후에도 다시 전체를 mux"하는 비용이 들지 않는다.

### watchdog·heartbeat

`monitor_ffmpeg_mux`가 기존 mux 감시를 그대로 수행한다.

- `kill_on_drop(true)`: backend가 죽으면 ffmpeg child도 함께 종료(orphan 방지)
- 1초 폴링으로 staged 파일 크기 증가 감시, 120초 무증가 시 kill → retry
- 15초마다 `set_job_phase("mux")` heartbeat → stale watchdog이 실수로
  작업을 재취소하지 않도록 함
- cancel flag 확인, DB에서 job이 finalizing 이탈 시 child kill

### `EXT-X-MAP`(fMP4 HLS)는?

TS가 아니라 init segment + fMP4 조각이면 concat pipe 방식이 맞지 않으므로
기존 방식(전체 다운로드 후 사후 concat mux)으로 fallback한다.

## 시행착오 (왜 이 형태가 되었나)

### 1차 시도: 단일 MPEG-TS pipe

```text
ffmpeg -f mpegts -i pipe:0 -c copy -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 out.mp4
```

- `-nostdin` + stdin 주입 조합에서 ffmpeg가 조기 종료 → `Broken pipe`(수정: `-nostdin` 제거)
- TS의 AAC는 `aac_adtstoasc` 없이 mp4 mux 불가 → Malformed AAC(수정: filter 추가)
- 근본 문제: **segment 경계의 PTS/timestamp 정보가 단일 pipe에서 소실**.
  모든 segment가 PTS 0부터 시작하는 스트림이라도 하나의 연속 TS로 보여서
  duration이 실제의 1/20 수준으로 잘못 계산된다.
  실제 MissAV 1,786-segment 파일이 Chrome에서 `duration=13s`로 나온 것이 이 원인.

### 2차: fragmented MP4

concat pipe + `frag_keyframe+empty_moov+default_base_moof`로 만들면
ffprobe는 전체 fragment duration을 합산해 정확하지만,
**Chrome은 초기 moov의 첫 fragment duration만 읽는다**.
완료된 파일도 76초짜리가 10초로 표시되어 재생 UX가 깨진다.

### 결론

- segment 경계 보정 → **concat demuxer(파일별 입력)**
- 완료 후 올바른 duration/seek → **표준 MP4(moov는 마지막에)**
- 다운로드 중 재생 가능은 원래 목표가 아니므로 fragment 출력은 포기

### 추가: progress channel 병목

resume 시 이미 완료된 수천 개 segment가 한 번에 progress channel로 들어와
DB update가 순차 처리되며 `updated_at`이 멈추고 watchdog이 작업을 재취소하는
문제가 있었다. 처리 루프에서 `try_recv`로 burst를 최신 값 하나로 합치고,
DB에는 `MAX(기존, 현재)` 값을 기록하도록 바꿔 해결했다.

## 검증 결과

실제 MissAV 1080p TS로 end-to-end 검증(5 segment 샘플):

```text
Downloading → Finalizing/Muxing → Completed
전체 소요 ≈ 7.6초
Finalizing 구간 ≈ 2.3초
```

- 파일: H.264 1920×1080 + AAC 48kHz, 6,917,302 bytes
- ffprobe duration: `20.021333`초
- Chrome 재생: `readyState=4`, `duration=20.021333`, 재생 오류 없음,
  currentTime 정상 증가
- 회귀 테스트 56개 통과 (신규: `queues_existing_segments_in_playlist_order`)

기존 방식 대비: 마지막 segment 이후 "전체 TS 재읽기 + MP4 재작성"이
없어지므로 Finalizing이 수 분 → 수 초가 됐고, 그 시간이 다운로드 기간으로
흡수되어 완료 즉시 재생 가능해졌다.

## 실무 메모

1. TS HLS의 timestamp는 segment마다 초기화된다. 연속 바이트로 이어 붙이면
   duration/seek가 깨진다. ffmpeg concat demuxer는 파일 단위로 열어 보정한다.
2. `-f mp4` 출력에 `movflags`를 주지 않으면 moov가 끝에 오고, 완료 시점에
   정상 재생이 보장된다. fragmented MP4는 "다운로드 중 재생"이 필요할 때만 쓴다.
3. ADTS AAC → MP4는 `-bsf:a aac_adtstoasc` 필수.
4. named pipe 쓰기측 `open(O_WRONLY)`은 reader가 열 때까지 블록한다.
   자식 프로세스가 일찍 죽는 경우를 대비해 반드시 timeout을 걸어야 한다.
5. ffmpeg를 오래 살려두는 경로에서는 `kill_on_drop` + stall 감시 +
   DB heartbeat가 함께 있어야 orphan/재취소 오판이 없다.
6. progress burst는 합쳐서 기록한다. 수천 건의 단위 DB update는
   watchdog과 성능 양쪽에 해가 된다.
